import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { SessionNotFoundError, SessionStore } from "../src/session-store.ts";

const createdRoots: string[] = [];
const pdf = new TextEncoder().encode("%PDF-1.7\nlocal session fixture\n%%EOF\n");

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ultra-learner-session-"));
  createdRoots.push(root);
  return root;
}

describe("local PDF session store", () => {
  test("defaults to the requested home-directory location without creating it", () => {
    expect(new SessionStore().root).toBe(join(homedir(), ".ultra-learner"));
  });

  test("creates immutable session files and lists newest sessions first", async () => {
    const root = await temporaryRoot();
    const ids = ["session-older", "session-newer"];
    const times = [new Date("2026-08-25T10:00:00.000Z"), new Date("2026-08-26T10:00:00.000Z")];
    const store = new SessionStore({
      root,
      createId: () => ids.shift() ?? "unexpected-id",
      clock: () => times.shift() ?? new Date(0),
    });

    const older = await store.createSession("older.pdf", pdf);
    const newer = await store.createSession("讲义.pdf", pdf);

    expect(older.id).toBe("session-older");
    expect(await store.listSessions()).toEqual([newer, older]);
    expect(await readFile(join(root, "sessions", newer.id, "document.pdf"))).toEqual(Buffer.from(pdf));
    expect(JSON.parse(await readFile(join(root, "sessions", newer.id, "metadata.json"), "utf8"))).toEqual({
      version: 1,
      ...newer,
    });
    expect((await store.getSessionDocument(newer.id)).summary).toEqual(newer);
  });

  test("rejects invalid uploads and inaccessible identifiers", async () => {
    const store = new SessionStore({ root: await temporaryRoot(), createId: () => "session-01" });
    await expect(store.createSession("notes.pdf", new TextEncoder().encode("not a PDF"))).rejects.toThrow("PDF header");
    await expect(store.createSession("../notes.pdf", pdf)).rejects.toThrow("filename is invalid");
    await expect(store.getSessionDocument("../session-01")).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  test("omits corrupt or incomplete entries from history", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root, createId: () => "valid-session" });
    const valid = await store.createSession("valid.pdf", pdf);
    const corrupt = join(root, "sessions", "corrupt-session");
    await mkdir(corrupt);
    await writeFile(join(corrupt, "metadata.json"), "not JSON\n");

    expect(await store.listSessions()).toEqual([valid]);
    await expect(store.getSessionDocument("corrupt-session")).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});

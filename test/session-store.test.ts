import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { SessionNotFoundError, SessionStore, SessionTooLargeError } from "../src/session-store.ts";

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

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
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

    const { session: older } = await store.createSession("older.pdf", pdf);
    const { session: newer } = await store.createSession("讲义.pdf", pdf);

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

  test("deletes a complete session directory without affecting other sessions", async () => {
    const root = await temporaryRoot();
    const ids = ["session-delete", "session-keep"];
    const store = new SessionStore({ root, createId: () => ids.shift() ?? "unexpected-id" });
    const { session: deleted } = await store.createSession("delete.pdf", pdf);
    const { session: kept } = await store.createSession("keep.pdf", pdf);

    await store.deleteSession(deleted.id);

    expect(await store.listSessions()).toEqual([kept]);
    await expect(store.getSessionDocument(deleted.id)).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(store.deleteSession(deleted.id)).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(store.deleteSession("../session-keep")).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  test("stores an upload that arrives in pieces", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root, createId: () => "streamed" });

    const { session, reused } = await store.createSession(
      "streamed.pdf",
      streamOf(pdf.subarray(0, 3), pdf.subarray(3, 20), pdf.subarray(20)),
    );

    expect(reused).toBe(false);
    expect(session.fileSize).toBe(pdf.byteLength);
    expect(await readFile(join(root, "sessions", "streamed", "document.pdf"))).toEqual(Buffer.from(pdf));
    expect((await store.getSessionDocument("streamed")).summary).toEqual(session);
  });

  test("reuses the stored session when the same PDF is opened again", async () => {
    const root = await temporaryRoot();
    const ids = ["first", "renamed", "revised", "unexpected"];
    const store = new SessionStore({ root, createId: () => ids.shift() ?? "exhausted" });
    const revised = new TextEncoder().encode("%PDF-1.7\nlocal session FIXTURE\n%%EOF\n");
    expect(revised.byteLength).toBe(pdf.byteLength);

    const first = await store.createSession("notes.pdf", pdf);
    const again = await store.createSession("notes.pdf", streamOf(pdf.subarray(0, 10), pdf.subarray(10)));
    expect(first.reused).toBe(false);
    expect(again).toEqual({ session: first.session, reused: true });

    // The same bytes under another name, and other bytes under the same name, are different documents.
    const renamed = await store.createSession("notes-copy.pdf", pdf);
    const edited = await store.createSession("notes.pdf", revised);
    expect([renamed.reused, renamed.session.id]).toEqual([false, "renamed"]);
    expect([edited.reused, edited.session.id]).toEqual([false, "revised"]);

    expect((await readdir(join(root, "sessions"))).sort()).toEqual(["first", "renamed", "revised"]);
    expect(await store.createSession("notes.pdf", revised)).toEqual({ session: edited.session, reused: true });
    expect(ids).toEqual(["unexpected"]);

    await store.deleteSession("first");
    expect((await store.createSession("notes.pdf", pdf)).reused).toBe(false);
  });

  test("leaves nothing behind when an upload is rejected or interrupted", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root });
    const limited = new SessionStore({ root, maximumFileSize: pdf.byteLength + 8 });
    const interrupted = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });

    await expect(limited.createSession("large.pdf", streamOf(pdf, new Uint8Array(16))))
      .rejects.toBeInstanceOf(SessionTooLargeError);
    await expect(store.createSession("empty.pdf", new Uint8Array())).rejects.toThrow("empty");
    await expect(store.createSession("zeros.pdf", streamOf(new Uint8Array(4_096)))).rejects.toThrow("PDF header");
    await expect(store.createSession("cut.pdf", interrupted)).rejects.toThrow("connection lost");

    expect(await readdir(join(root, "sessions"))).toEqual([]);
    expect(await store.listSessions()).toEqual([]);
  });

  test("clears stale leftovers of interrupted uploads and nothing else", async () => {
    const root = await temporaryRoot();
    const sessions = join(root, "sessions");
    const { session: valid } = await new SessionStore({ root, createId: () => "valid-session" })
      .createSession("valid.pdf", pdf);
    const leftovers: Array<[directory: string, file: string, contents: string | Uint8Array]> = [
      [".incoming-abandoned", "document.pdf", pdf],
      ["document-without-metadata", "document.pdf", pdf],
      ["corrupt-session", "metadata.json", "not JSON\n"],
      ["unrelated-folder", "notes.txt", "keep me"],
    ];
    for (const [directory, file, contents] of leftovers) {
      await mkdir(join(sessions, directory));
      await writeFile(join(sessions, directory, file), contents);
    }

    // A reader started moments later has to assume those uploads are still running.
    expect(await new SessionStore({ root }).listSessions()).toEqual([valid]);
    expect((await readdir(sessions)).sort()).toEqual([
      ".incoming-abandoned",
      "corrupt-session",
      "document-without-metadata",
      "unrelated-folder",
      "valid-session",
    ]);

    const startedLater = new SessionStore({ root, clock: () => new Date(Date.now() + 2 * 60 * 60 * 1000) });
    expect(await startedLater.listSessions()).toEqual([valid]);
    expect((await readdir(sessions)).sort()).toEqual(["corrupt-session", "unrelated-folder", "valid-session"]);
  });

  test("omits corrupt or incomplete entries from history", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root, createId: () => "valid-session" });
    const { session: valid } = await store.createSession("valid.pdf", pdf);
    const corrupt = join(root, "sessions", "corrupt-session");
    await mkdir(corrupt);
    await writeFile(join(corrupt, "metadata.json"), "not JSON\n");

    expect(await store.listSessions()).toEqual([valid]);
    await expect(store.getSessionDocument("corrupt-session")).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});

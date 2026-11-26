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

  test("remembers the last page of a session without touching its metadata", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root, createId: () => "reading" });
    const { session } = await store.createSession("notes.pdf", pdf);
    const metadataPath = join(root, "sessions", "reading", "metadata.json");
    const metadata = await readFile(metadataPath, "utf8");
    expect(session.lastPage).toBeUndefined();

    await store.saveProgress("reading", 12);
    expect(await store.listSessions()).toEqual([{ ...session, lastPage: 12 }]);
    await store.saveProgress("reading", 3);
    expect((await store.getSessionDocument("reading")).summary).toEqual({ ...session, lastPage: 3 });

    expect(await readFile(metadataPath, "utf8")).toBe(metadata);
    expect((await readdir(join(root, "sessions", "reading"))).sort())
      .toEqual(["document.pdf", "metadata.json", "progress.json"]);
    // Opening the same file again finds the session together with its position.
    expect(await store.createSession("notes.pdf", pdf)).toEqual({ session: { ...session, lastPage: 3 }, reused: true });
  });

  test("applies position updates in the order a reader made them", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root, createId: () => "reading" });
    await store.createSession("notes.pdf", pdf);
    const lastPage = async (): Promise<number | undefined> => (await store.listSessions())[0]?.lastPage;

    // Requests issued together are applied one after another, never interleaved.
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      store.saveProgress("reading", index + 1, { writer: "tab-a", sequence: index + 1 })));
    expect(await lastPage()).toBe(12);

    // An update that left the page earlier but arrived later must not win.
    await store.saveProgress("reading", 2, { writer: "tab-a", sequence: 5 });
    expect(await lastPage()).toBe(12);
    await store.saveProgress("reading", 20, { writer: "tab-a", sequence: 13 });
    expect(await lastPage()).toBe(20);

    // Another tab numbers its own updates, and an unnumbered update always applies.
    await store.saveProgress("reading", 7, { writer: "tab-b", sequence: 1 });
    expect(await lastPage()).toBe(7);
    await store.saveProgress("reading", 3);
    expect(await lastPage()).toBe(3);
  });

  test("keeps one session when identical uploads arrive together", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root });

    const results = await Promise.all(Array.from({ length: 6 }, () =>
      store.createSession("notes.pdf", streamOf(pdf.subarray(0, 12), pdf.subarray(12)))));

    expect(results.filter((result) => !result.reused)).toHaveLength(1);
    expect(new Set(results.map((result) => result.session.id)).size).toBe(1);
    expect(await store.listSessions()).toHaveLength(1);
    expect(await readdir(join(root, "sessions"))).toHaveLength(1);
  });

  test("rejects impossible positions and opens at the first page when a position is unreadable", async () => {
    const root = await temporaryRoot();
    const store = new SessionStore({ root, createId: () => "reading" });
    const { session } = await store.createSession("notes.pdf", pdf);

    for (const page of [0, -1, 1.5, Number.NaN]) {
      await expect(store.saveProgress("reading", page)).rejects.toThrow("reading position");
    }
    await expect(store.saveProgress("missing", 2)).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(store.saveProgress("../reading", 2)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(await store.listSessions()).toEqual([session]);

    for (const corrupt of ["not JSON", '{"version":1,"page":0}', '{"version":2,"page":5}', "[]"]) {
      await writeFile(join(root, "sessions", "reading", "progress.json"), corrupt);
      expect(await store.listSessions()).toEqual([session]);
    }
    await store.deleteSession("reading");
    await expect(store.saveProgress("reading", 2)).rejects.toBeInstanceOf(SessionNotFoundError);
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

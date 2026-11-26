import { describe, expect, test } from "bun:test";

import {
  deleteSession,
  formatSessionDate,
  listSessions,
  loadSessionPdf,
  saveSession,
  saveSessionProgress,
  sessionMeta,
} from "../src/web/session-history.ts";
import type { SessionFetch } from "../src/web/session-history.ts";

const session = {
  id: "session-01",
  filename: "notes.pdf",
  fileSize: 1_536,
  createdAt: "2026-08-26T03:00:00.000Z",
};

describe("browser session transport", () => {
  test("lists validated session summaries", async () => {
    const fetcher = async () => Response.json({ sessions: [session, { filename: "broken" }] });
    expect(await listSessions(fetcher as SessionFetch)).toEqual([session]);
  });

  test("uploads PDF bytes with the encoded source filename", async () => {
    const data = new TextEncoder().encode("%PDF-1.7\n");
    const file = new File([data], "讲义.pdf", { type: "application/pdf" });
    let request: Request | undefined;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === "string" && input.startsWith("/") ? `http://local.test${input}` : input;
      request = new Request(target, init);
      return Response.json({ session }, { status: 201 });
    };

    expect(await saveSession(file, fetcher as SessionFetch)).toEqual(session);
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("x-ultra-learner-filename")).toBe(encodeURIComponent(file.name));
    expect(new Uint8Array(await request!.arrayBuffer())).toEqual(data);
  });

  test("retrieves persisted bytes and exposes useful server errors", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n");
    expect(await loadSessionPdf(session, async () => new Response(pdf))).toEqual(pdf);
    await expect(loadSessionPdf(session, async () => new Response("", { status: 404 })))
      .rejects.toThrow("no longer available");
    await expect(listSessions(async () => Response.json({ error: { message: "Disk unavailable" } }, { status: 500 })))
      .rejects.toThrow("Disk unavailable");
    await expect(listSessions(async () => new Response("<html>proxy error</html>", { status: 502 })))
      .rejects.toThrow("Unable to load your PDF history.");
  });

  test("deletes a persisted session and reports missing sessions", async () => {
    let request: Request | undefined;
    await deleteSession(session, async (input, init) => {
      const target = typeof input === "string" && input.startsWith("/") ? `http://local.test${input}` : input;
      request = new Request(target, init);
      return new Response(null, { status: 204 });
    });

    expect(request?.method).toBe("DELETE");
    expect(new URL(request!.url).pathname).toBe(`/api/sessions/${session.id}`);
    await expect(deleteSession(session, async () => new Response("Not found", { status: 404 })))
      .rejects.toThrow("no longer available");
  });

  test("sends the reading position and keeps a session's last page from the list", async () => {
    let request: Request | undefined;
    await saveSessionProgress(session.id, 14, async (input, init) => {
      const target = typeof input === "string" && input.startsWith("/") ? `http://local.test${input}` : input;
      request = new Request(target, init);
      expect(init?.keepalive).toBe(true);
      return new Response(null, { status: 204 });
    });
    expect(request?.method).toBe("PUT");
    expect(new URL(request!.url).pathname).toBe(`/api/sessions/${session.id}/progress`);
    expect(await request!.json()).toEqual({ page: 14 });

    await expect(saveSessionProgress(session.id, 14, async () => new Response("Not found", { status: 404 })))
      .rejects.toThrow("no longer available");
    await expect(saveSessionProgress(session.id, 0, async () =>
      Response.json({ error: { message: "The reading position must be a page number of 1 or more." } }, { status: 400 })))
      .rejects.toThrow("page number of 1 or more");

    const listed = async () => Response.json({
      sessions: [{ ...session, lastPage: 14 }, { ...session, id: "session-02", lastPage: 0 }],
    });
    expect(await listSessions(listed as SessionFetch))
      .toEqual([{ ...session, lastPage: 14 }, { ...session, id: "session-02" }]);
  });

  test("formats local session metadata for the history list", () => {
    expect(formatSessionDate("invalid", "en-US")).toBe("Unknown date");
    expect(sessionMeta(session, "en-US")).toContain("1.5 KB · Aug 26, 2026");
  });
});

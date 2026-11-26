import { describe, expect, test } from "bun:test";

import {
  SESSION_STORAGE_VERSION,
  hasPdfHeader,
  isSessionId,
  isSessionMetadata,
  isSessionSummary,
  parseSessionProgress,
  parseSessionSummary,
  sessionFilenameValidationError,
} from "../src/lib/sessions.ts";

describe("session metadata helpers", () => {
  test("accepts opaque session IDs and rejects path-like values", () => {
    expect(isSessionId("018f5d7a-1b2c-7d8e-9f10-123456789abc")).toBe(true);
    expect(isSessionId("session_01")).toBe(true);
    expect(isSessionId("../session")).toBe(false);
    expect(isSessionId("session/name")).toBe(false);
    expect(isSessionId("")).toBe(false);
  });

  test("validates persisted filenames, sizes, and PDF headers", () => {
    expect(sessionFilenameValidationError("notes.pdf", 128)).toBeNull();
    expect(sessionFilenameValidationError("../notes.pdf", 128)).toBe("The PDF filename is invalid.");
    expect(sessionFilenameValidationError("notes.pdf", 0)).toBe("That PDF is empty.");
    expect(hasPdfHeader(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(hasPdfHeader(new TextEncoder().encode("not a PDF"))).toBe(false);
  });

  test("recognizes the versioned metadata contract", () => {
    const metadata = {
      version: SESSION_STORAGE_VERSION,
      id: "session-01",
      filename: "notes.pdf",
      fileSize: 128,
      createdAt: "2026-08-26T03:00:00.000Z",
    };
    expect(isSessionMetadata(metadata)).toBe(true);
    expect(isSessionMetadata({ ...metadata, version: 2 })).toBe(false);
    expect(isSessionMetadata({ ...metadata, createdAt: "not-a-date" })).toBe(false);
  });

  test("accepts an optional last page and rejects impossible positions", () => {
    const summary = { id: "session-01", filename: "notes.pdf", fileSize: 128, createdAt: "2026-08-26T03:00:00.000Z" };
    expect(isSessionSummary(summary)).toBe(true);
    expect(parseSessionSummary(summary)).toEqual(summary);
    expect(parseSessionSummary({ ...summary, lastPage: 12, extra: true })).toEqual({ ...summary, lastPage: 12 });
    // A position that cannot be used costs the position, not the session.
    for (const lastPage of [0, -3, 2.5, "4", null, Number.NaN, Number.MAX_VALUE]) {
      expect(parseSessionSummary({ ...summary, lastPage })).toEqual(summary);
    }
    expect(parseSessionSummary({ ...summary, id: "../escape", lastPage: 3 })).toBeNull();
    expect(parseSessionSummary(null)).toBeNull();

    expect(parseSessionProgress({ page: 7, zoom: 2 })).toEqual({ page: 7 });
    for (const body of [{ page: 0 }, { page: "7" }, { page: 1.5 }, {}, null, 7, "7"]) {
      expect(() => parseSessionProgress(body)).toThrow("reading position");
    }
  });

  test("accepts a numbered position update only when its writer and sequence are both usable", () => {
    expect(parseSessionProgress({ page: 7, writer: "mabc12-x9", sequence: 4 }))
      .toEqual({ page: 7, order: { writer: "mabc12-x9", sequence: 4 } });
    for (const order of [
      { writer: "tab" },
      { sequence: 4 },
      { writer: "", sequence: 4 },
      { writer: "has space", sequence: 4 },
      { writer: "x".repeat(65), sequence: 4 },
      { writer: "tab", sequence: -1 },
      { writer: "tab", sequence: 1.5 },
      { writer: "tab", sequence: "4" },
      { writer: 7, sequence: 4 },
    ]) {
      expect(() => parseSessionProgress({ page: 7, ...order })).toThrow("writer and sequence");
    }
  });
});

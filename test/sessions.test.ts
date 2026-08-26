import { describe, expect, test } from "bun:test";

import {
  SESSION_STORAGE_VERSION,
  hasPdfHeader,
  isSessionId,
  isSessionMetadata,
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
});

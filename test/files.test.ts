import { describe, expect, test } from "bun:test";

import { documentTitle, formatFileSize, isPdfFile } from "../src/lib/files.ts";

describe("PDF file helpers", () => {
  test("accepts PDF MIME types and case-insensitive PDF extensions", () => {
    expect(isPdfFile({ name: "notes.bin", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "reading.PDF", type: "" })).toBe(true);
    expect(isPdfFile({ name: "reading.txt", type: "text/plain" })).toBe(false);
  });

  test("formats file sizes for reader metadata", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(850)).toBe("850 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(12 * 1024 * 1024)).toBe("12 MB");
  });

  test("turns filenames into readable document titles", () => {
    expect(documentTitle("the_shape-of-attention.pdf")).toBe("the shape of attention");
    expect(documentTitle(".pdf")).toBe("Untitled document");
  });
});

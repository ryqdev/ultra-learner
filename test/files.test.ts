import { describe, expect, test } from "bun:test";

import {
  MAXIMUM_PDF_FILE_SIZE,
  documentTitle,
  formatFileSize,
  isPdfFile,
  pdfFileValidationError,
  pdfOpenErrorMessage,
} from "../src/lib/files.ts";

describe("PDF file helpers", () => {
  test("accepts PDF MIME types and case-insensitive PDF extensions", () => {
    expect(isPdfFile({ name: "notes.bin", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "reading.PDF", type: "" })).toBe(true);
    expect(isPdfFile({ name: "reading.txt", type: "text/plain" })).toBe(false);
  });

  test("validates a PDF before the reader switches to its loading state", () => {
    expect(pdfFileValidationError({ name: "notes.txt", type: "text/plain", size: 10 })).toBe("Please choose a PDF file.");
    expect(pdfFileValidationError({ name: "notes.pdf", type: "application/pdf", size: 0 })).toBe("That PDF is empty.");
    expect(pdfFileValidationError({
      name: "notes.pdf",
      type: "application/pdf",
      size: MAXIMUM_PDF_FILE_SIZE + 1,
    })).toBe("That PDF is larger than 100 MB.");
    expect(pdfFileValidationError({ name: "notes.pdf", type: "application/pdf", size: 1024 })).toBeNull();
  });

  test("formats file sizes for reader metadata", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(850)).toBe("850 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(12 * 1024 * 1024)).toBe("12 MB");
  });

  test("turns PDF.js failures into actionable reader errors", () => {
    expect(pdfOpenErrorMessage(new Error("hashOriginal.toHex is not a function"))).toBe(
      "This browser is missing features required by the PDF reader. Update the browser and try again.",
    );
    expect(pdfOpenErrorMessage(new Error("PasswordException: No password given"))).toBe(
      "Password-protected PDFs are not supported in this first prototype.",
    );
    expect(pdfOpenErrorMessage(new Error("Invalid PDF structure."))).toBe(
      "This document is not a valid or supported PDF.",
    );
    expect(pdfOpenErrorMessage(new Error("Unexpected renderer failure"))).toBe(
      "The PDF reader reported: Unexpected renderer failure",
    );
    expect(pdfOpenErrorMessage(null)).toBe("The PDF reader stopped before it could display this document.");
  });

  test("turns filenames into readable document titles", () => {
    expect(documentTitle("the_shape-of-attention.pdf")).toBe("the shape of attention");
    expect(documentTitle(".pdf")).toBe("Untitled document");
  });
});

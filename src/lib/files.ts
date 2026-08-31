export const PDF_MIME_TYPE = "application/pdf";
export const MAXIMUM_PDF_FILE_SIZE = 100 * 1024 * 1024;
const MAXIMUM_PDF_ERROR_DETAIL_LENGTH = 240;

export interface PdfCandidate {
  name: string;
  type: string;
}

export interface PdfFileCandidate extends PdfCandidate {
  size: number;
}

export function isPdfFile(file: PdfCandidate): boolean {
  return file.type === PDF_MIME_TYPE || file.name.toLowerCase().endsWith(".pdf");
}

export function pdfFileValidationError(file: PdfFileCandidate): string | null {
  if (!isPdfFile(file)) return "Please choose a PDF file.";
  if (file.size > MAXIMUM_PDF_FILE_SIZE) return "That PDF is larger than 100 MB.";
  if (file.size === 0) return "That PDF is empty.";
  return null;
}

export function pdfOpenErrorMessage(error: unknown): string {
  const detail = (error instanceof Error ? error.message : typeof error === "string" ? error : "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAXIMUM_PDF_ERROR_DETAIL_LENGTH);
  const normalized = detail.toLowerCase();

  if (normalized.includes("password")) {
    return "Password-protected PDFs are not supported in this first prototype.";
  }
  if (["tohex is not a function", "getorinsertcomputed is not a function", "withresolvers is not a function"]
    .some((message) => normalized.includes(message))) {
    return "This browser is missing features required by the PDF reader. Update the browser and try again.";
  }
  if (normalized.includes("invalid pdf") || normalized.includes("missing pdf") || normalized.includes("empty pdf")) {
    return "This document is not a valid or supported PDF.";
  }
  if (detail) return `The PDF reader reported: ${detail}`;
  return "The PDF reader stopped before it could display this document.";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";

  const units = ["B", "KB", "MB", "GB"] as const;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function documentTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.pdf$/i, "");
  return withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled document";
}

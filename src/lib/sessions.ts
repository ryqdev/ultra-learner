import { MAXIMUM_PDF_FILE_SIZE, pdfFileValidationError } from "./files.ts";

export const SESSION_STORAGE_VERSION = 1;
export const MAXIMUM_SESSION_FILENAME_LENGTH = 255;

export interface SessionSummary {
  id: string;
  filename: string;
  fileSize: number;
  createdAt: string;
}

export interface SessionMetadata extends SessionSummary {
  version: typeof SESSION_STORAGE_VERSION;
}

export function isSessionId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}

export function sessionFilenameValidationError(filename: string, fileSize: number): string | null {
  if (!filename || filename !== filename.trim()) return "The PDF filename is invalid.";
  if (filename.length > MAXIMUM_SESSION_FILENAME_LENGTH) return "The PDF filename is too long.";
  if (/[/\\\u0000-\u001f\u007f]/.test(filename)) return "The PDF filename is invalid.";
  return pdfFileValidationError({ name: filename, type: "application/pdf", size: fileSize });
}

export function hasPdfHeader(data: Uint8Array): boolean {
  const header = new TextDecoder("latin1").decode(data.subarray(0, Math.min(data.byteLength, 1_024)));
  return header.includes("%PDF-");
}

export function isSessionMetadata(value: unknown): value is SessionMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionMetadata>;
  return candidate.version === SESSION_STORAGE_VERSION
    && isSessionSummary(candidate);
}

export function isSessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionSummary>;
  return typeof candidate.id === "string"
    && isSessionId(candidate.id)
    && typeof candidate.filename === "string"
    && typeof candidate.fileSize === "number"
    && Number.isInteger(candidate.fileSize)
    && candidate.fileSize > 0
    && candidate.fileSize <= MAXIMUM_PDF_FILE_SIZE
    && sessionFilenameValidationError(candidate.filename, candidate.fileSize) === null
    && typeof candidate.createdAt === "string"
    && Number.isFinite(Date.parse(candidate.createdAt));
}

export function toSessionSummary(metadata: SessionMetadata): SessionSummary {
  const { id, filename, fileSize, createdAt } = metadata;
  return { id, filename, fileSize, createdAt };
}

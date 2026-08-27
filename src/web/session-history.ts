import { formatFileSize } from "../lib/files.ts";
import { isSessionSummary, type SessionSummary } from "../lib/sessions.ts";

interface SessionListResponse {
  sessions?: unknown;
  error?: unknown;
}

interface SessionCreateResponse {
  session?: unknown;
  error?: unknown;
}

interface SessionDeleteResponse {
  error?: unknown;
}

export type SessionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function responseError(data: SessionListResponse | SessionCreateResponse, fallback: string): Error {
  return new Error(typeof data.error === "string" ? data.error : fallback);
}

export async function listSessions(fetcher: SessionFetch = fetch): Promise<SessionSummary[]> {
  const response = await fetcher("/api/sessions", { headers: { Accept: "application/json" } });
  const data = await response.json() as SessionListResponse;
  if (!response.ok) throw responseError(data, "Unable to load your PDF history.");
  if (!Array.isArray(data.sessions)) throw new Error("The PDF history response is invalid.");
  return data.sessions.filter(isSessionSummary);
}

export async function saveSession(
  file: File,
  data: Uint8Array,
  fetcher: SessionFetch = fetch,
): Promise<SessionSummary> {
  const response = await fetcher("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-Ultra-Learner-Filename": encodeURIComponent(file.name),
    },
    body: new Blob([data as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
  });
  const result = await response.json() as SessionCreateResponse;
  if (!response.ok) throw responseError(result, "Unable to save this PDF to your history.");
  if (!isSessionSummary(result.session)) throw new Error("The saved PDF session is invalid.");
  return result.session;
}

export async function loadSessionPdf(
  session: SessionSummary,
  fetcher: SessionFetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(`/api/sessions/${encodeURIComponent(session.id)}/document`);
  if (!response.ok) throw new Error(response.status === 404
    ? "That PDF session is no longer available."
    : "Unable to open this PDF session.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function deleteSession(
  session: SessionSummary,
  fetcher: SessionFetch = fetch,
): Promise<void> {
  const response = await fetcher(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (response.ok) return;

  let data: SessionDeleteResponse = {};
  try {
    data = await response.json() as SessionDeleteResponse;
  } catch {
    // A plain-text or empty error response still receives the useful fallback below.
  }
  throw responseError(data, response.status === 404
    ? "That PDF session is no longer available."
    : "Unable to delete this PDF session.");
}

export function formatSessionDate(value: string, locale?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function sessionMeta(session: SessionSummary, locale?: string): string {
  return `${formatFileSize(session.fileSize)} · ${formatSessionDate(session.createdAt, locale)}`;
}

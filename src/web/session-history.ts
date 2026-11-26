import { formatFileSize } from "../lib/files.ts";
import { isSessionSummary, type SessionSummary } from "../lib/sessions.ts";

interface SessionListResponse {
  sessions?: unknown;
}

interface SessionCreateResponse {
  session?: unknown;
}

export type SessionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Read a JSON body without letting a plain-text or empty error reply mask the real failure. */
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseError(data: Record<string, unknown>, fallback: string): Error {
  const error = data.error;
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  return new Error(typeof message === "string" && message ? message : fallback);
}

export async function listSessions(fetcher: SessionFetch = fetch): Promise<SessionSummary[]> {
  const response = await fetcher("/api/sessions", { headers: { Accept: "application/json" } });
  const data = await responseJson(response);
  if (!response.ok) throw responseError(data, "Unable to load your PDF history.");
  const { sessions } = data as SessionListResponse;
  if (!Array.isArray(sessions)) throw new Error("The PDF history response is invalid.");
  return sessions.filter(isSessionSummary);
}

export async function saveSession(
  file: File,
  fetcher: SessionFetch = fetch,
): Promise<SessionSummary> {
  const response = await fetcher("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-Ultra-Learner-Filename": encodeURIComponent(file.name),
    },
    // The browser streams the File from disk; no copy of its bytes is kept in page memory.
    body: file,
  });
  const result = await responseJson(response);
  if (!response.ok) throw responseError(result, "Unable to save this PDF to your history.");
  const { session } = result as SessionCreateResponse;
  if (!isSessionSummary(session)) throw new Error("The saved PDF session is invalid.");
  return session;
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
  throw responseError(await responseJson(response), response.status === 404
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

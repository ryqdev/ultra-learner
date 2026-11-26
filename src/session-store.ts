import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { MAXIMUM_PDF_FILE_SIZE } from "./lib/files.ts";
import {
  SESSION_STORAGE_VERSION,
  hasPdfHeader,
  isSessionId,
  isSessionMetadata,
  sessionNameValidationError,
  toSessionSummary,
  type SessionMetadata,
  type SessionSummary,
} from "./lib/sessions.ts";

const SESSIONS_DIRECTORY = "sessions";
const METADATA_FILENAME = "metadata.json";
const PDF_FILENAME = "document.pdf";
// The leading dot keeps an upload in progress from ever reading as a session ID.
const INCOMING_PREFIX = ".incoming-";
const PDF_HEADER_WINDOW = 1_024;
/** Entries newer than this may still be written by another running reader. */
const INCOMPLETE_ENTRY_GRACE_MS = 60 * 60 * 1000;

export interface SessionStoreOptions {
  root?: string;
  clock?: () => Date;
  createId?: () => string;
  maximumFileSize?: number;
}

export interface SessionDocument {
  summary: SessionSummary;
  path: string;
}

export interface SavedSession {
  session: SessionSummary;
  /** True when an identical stored document answered the upload and nothing new was kept. */
  reused: boolean;
}

export class SessionNotFoundError extends Error {
  public constructor() {
    super("Session not found");
    this.name = "SessionNotFoundError";
  }
}

export class SessionTooLargeError extends Error {
  public constructor() {
    super("That PDF is larger than 100 MB.");
    this.name = "SessionTooLargeError";
  }
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
  return hash.digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export class SessionStore {
  public readonly root: string;
  private readonly clock: () => Date;
  private readonly createId: () => string;
  private readonly maximumFileSize: number;
  private cleanup: Promise<void> | undefined;

  public constructor(options: SessionStoreOptions = {}) {
    this.root = options.root ?? join(homedir(), ".ultra-learner");
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.maximumFileSize = options.maximumFileSize ?? MAXIMUM_PDF_FILE_SIZE;
  }

  public async listSessions(): Promise<SessionSummary[]> {
    await this.ensureRoot();
    const entries = await readdir(this.sessionsRoot, { withFileTypes: true });
    const sessions = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && isSessionId(entry.name))
      .map(async (entry) => {
        try {
          return (await this.getSessionDocument(entry.name)).summary;
        } catch {
          return null;
        }
      }));

    return sessions
      .filter((session): session is SessionSummary => session !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  }

  /**
   * Store an upload as a session. The bytes are written to a private incoming
   * directory and only renamed into place once the document and its metadata
   * are complete, so an interrupted upload never leaves a session directory
   * that history cannot show or delete. Opening a document that is already
   * stored under the same name returns that session instead of a second copy.
   */
  public async createSession(
    filename: string,
    source: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<SavedSession> {
    const nameError = sessionNameValidationError(filename);
    if (nameError) throw new TypeError(nameError);

    await this.ensureRoot();
    const incoming = join(this.sessionsRoot, `${INCOMING_PREFIX}${crypto.randomUUID()}`);
    await mkdir(incoming, { mode: 0o700 });
    try {
      const fileSize = await this.writeDocument(join(incoming, PDF_FILENAME), source);
      const existing = await this.findIdenticalSession(filename, fileSize, join(incoming, PDF_FILENAME));
      if (existing) {
        await rm(incoming, { recursive: true, force: true });
        return { session: existing, reused: true };
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const id = this.createId();
        if (!isSessionId(id)) throw new Error("The generated session ID is invalid.");
        const directory = this.sessionDirectory(id);
        if (await pathExists(directory)) continue;

        const metadata: SessionMetadata = {
          version: SESSION_STORAGE_VERSION,
          id,
          filename,
          fileSize,
          createdAt: this.clock().toISOString(),
        };
        await writeFile(join(incoming, METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
        try {
          await rename(incoming, directory);
          return { session: toSessionSummary(metadata), reused: false };
        } catch (error) {
          // Another writer claimed this ID between the check and the rename.
          if (!await pathExists(directory)) throw error;
        }
      }
      throw new Error("Unable to allocate a unique session ID.");
    } catch (error) {
      await rm(incoming, { recursive: true, force: true });
      throw error;
    }
  }

  public async getSessionDocument(id: string): Promise<SessionDocument> {
    if (!isSessionId(id)) throw new SessionNotFoundError();
    try {
      const summary = await this.readSummary(id);
      const path = join(this.sessionDirectory(id), PDF_FILENAME);
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink() || file.size !== summary.fileSize) {
        throw new SessionNotFoundError();
      }
      await access(path, constants.R_OK);
      return { summary, path };
    } catch (error) {
      if (error instanceof SessionNotFoundError) throw error;
      throw new SessionNotFoundError();
    }
  }

  public async deleteSession(id: string): Promise<void> {
    if (!isSessionId(id)) throw new SessionNotFoundError();
    await this.getSessionDocument(id);
    try {
      await rm(this.sessionDirectory(id), { recursive: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new SessionNotFoundError();
      }
      throw error;
    }
  }

  private get sessionsRoot(): string {
    return join(this.root, SESSIONS_DIRECTORY);
  }

  private sessionDirectory(id: string): string {
    return join(this.sessionsRoot, id);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.sessionsRoot, { recursive: true, mode: 0o700 });
    this.cleanup ??= this.removeIncompleteEntries();
    await this.cleanup;
  }

  /**
   * Look for a stored session with this name and exactly these bytes. Only
   * sessions that already match on name and size are read, so an ordinary
   * first upload costs a directory listing and no hashing.
   */
  private async findIdenticalSession(
    filename: string,
    fileSize: number,
    documentPath: string,
  ): Promise<SessionSummary | null> {
    const candidates = (await this.listSessions())
      .filter((session) => session.filename === filename && session.fileSize === fileSize);
    if (candidates.length === 0) return null;
    const digest = await fileDigest(documentPath);
    for (const candidate of candidates) {
      try {
        if (await fileDigest(join(this.sessionDirectory(candidate.id), PDF_FILENAME)) === digest) return candidate;
      } catch {
        // A stored document that cannot be read is not a match; the upload is kept instead.
      }
    }
    return null;
  }

  /** Write the upload to disk as it arrives and return its size once it proves to be a PDF. */
  private async writeDocument(path: string, source: Uint8Array | ReadableStream<Uint8Array>): Promise<number> {
    const head = new Uint8Array(PDF_HEADER_WINDOW);
    let headLength = 0;
    let headerAccepted = false;
    let size = 0;
    const requireHeader = (): void => {
      if (!hasPdfHeader(head.subarray(0, headLength))) {
        throw new TypeError("The uploaded file does not contain a PDF header.");
      }
      headerAccepted = true;
    };

    const handle = await open(path, "wx", 0o600);
    try {
      const append = async (chunk: Uint8Array): Promise<void> => {
        size += chunk.byteLength;
        if (size > this.maximumFileSize) throw new SessionTooLargeError();
        if (!headerAccepted) {
          const taken = chunk.subarray(0, PDF_HEADER_WINDOW - headLength);
          head.set(taken, headLength);
          headLength += taken.byteLength;
          // Reject a non-PDF as soon as the header window is full instead of storing all of it first.
          if (headLength === PDF_HEADER_WINDOW) requireHeader();
        }
        for (let written = 0; written < chunk.byteLength;) {
          written += (await handle.write(chunk, written, chunk.byteLength - written)).bytesWritten;
        }
      };

      if (source instanceof Uint8Array) {
        await append(source);
      } else {
        const reader = source.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await append(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          throw error;
        } finally {
          reader.releaseLock();
        }
      }
    } finally {
      await handle.close();
    }

    if (size === 0) throw new TypeError("That PDF is empty.");
    if (!headerAccepted) requireHeader();
    return size;
  }

  /**
   * Remove what an interrupted upload left behind: stale incoming directories
   * and session directories that hold at most a document and no metadata, the
   * state earlier versions could be killed in. Anything else is left untouched.
   */
  private async removeIncompleteEntries(): Promise<void> {
    // Read the clock only when something needs judging, so an ordinary start does not consume it.
    let now: number | undefined;
    const entries = await readdir(this.sessionsRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const directory = join(this.sessionsRoot, entry.name);
      try {
        if (!entry.name.startsWith(INCOMING_PREFIX)) {
          if (!isSessionId(entry.name)) return;
          const contents = await readdir(directory);
          if (contents.some((name) => name !== PDF_FILENAME)) return;
        }
        now ??= this.clock().getTime();
        if (now - (await lstat(directory)).mtimeMs < INCOMPLETE_ENTRY_GRACE_MS) return;
        await rm(directory, { recursive: true, force: true });
      } catch {
        // Cleanup is best-effort and must never keep the history from loading.
      }
    }));
  }

  private async readSummary(id: string): Promise<SessionSummary> {
    const directory = this.sessionDirectory(id);
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new SessionNotFoundError();

    const metadataPath = join(directory, METADATA_FILENAME);
    const metadataStat = await lstat(metadataPath);
    if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) throw new SessionNotFoundError();

    const metadata: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
    if (!isSessionMetadata(metadata) || metadata.id !== id) throw new SessionNotFoundError();
    return toSessionSummary(metadata);
  }
}

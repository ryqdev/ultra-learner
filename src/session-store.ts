import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  SESSION_STORAGE_VERSION,
  hasPdfHeader,
  isSessionId,
  isSessionMetadata,
  sessionFilenameValidationError,
  toSessionSummary,
  type SessionMetadata,
  type SessionSummary,
} from "./lib/sessions.ts";

const SESSIONS_DIRECTORY = "sessions";
const METADATA_FILENAME = "metadata.json";
const PDF_FILENAME = "document.pdf";

export interface SessionStoreOptions {
  root?: string;
  clock?: () => Date;
  createId?: () => string;
}

export interface SessionDocument {
  summary: SessionSummary;
  path: string;
}

export class SessionNotFoundError extends Error {
  public constructor() {
    super("Session not found");
    this.name = "SessionNotFoundError";
  }
}

export class SessionStore {
  public readonly root: string;
  private readonly clock: () => Date;
  private readonly createId: () => string;

  public constructor(options: SessionStoreOptions = {}) {
    this.root = options.root ?? join(homedir(), ".ultra-learner");
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
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

  public async createSession(filename: string, data: Uint8Array): Promise<SessionSummary> {
    const validationError = sessionFilenameValidationError(filename, data.byteLength);
    if (validationError) throw new TypeError(validationError);
    if (!hasPdfHeader(data)) throw new TypeError("The uploaded file does not contain a PDF header.");

    await this.ensureRoot();
    let directory: string | undefined;
    let id: string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidateId = this.createId();
      if (!isSessionId(candidateId)) throw new Error("The generated session ID is invalid.");
      const candidate = this.sessionDirectory(candidateId);
      try {
        await mkdir(candidate, { mode: 0o700 });
        directory = candidate;
        id = candidateId;
        break;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
    if (!directory || !id) throw new Error("Unable to allocate a unique session ID.");
    try {
      const metadata: SessionMetadata = {
        version: SESSION_STORAGE_VERSION,
        id,
        filename,
        fileSize: data.byteLength,
        createdAt: this.clock().toISOString(),
      };
      await writeFile(join(directory, PDF_FILENAME), data, { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      return toSessionSummary(metadata);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
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

  private get sessionsRoot(): string {
    return join(this.root, SESSIONS_DIRECTORY);
  }

  private sessionDirectory(id: string): string {
    return join(this.sessionsRoot, id);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.sessionsRoot, { recursive: true, mode: 0o700 });
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

import { validateChatConfig, type ChatConfig } from "./chat.ts";

export const CHAT_PROFILE_STORAGE_VERSION = 1;
export const CHAT_PROFILE_STORAGE_KEY = "ultra-learner.chat-profiles";
export const MAXIMUM_CHAT_PROFILE_NAME_LENGTH = 80;
export const MAXIMUM_CHAT_PROFILES = 40;

export interface ChatProfile extends ChatConfig {
  id: string;
  name: string;
}

export interface ChatProfileState {
  version: typeof CHAT_PROFILE_STORAGE_VERSION;
  activeProfileId: string | null;
  profiles: ChatProfile[];
}

export interface ChatProfileInput extends ChatConfig {
  id?: string;
  name: string;
}

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function profileId(value: unknown): string {
  if (typeof value !== "string" || !PROFILE_ID_PATTERN.test(value)) {
    throw new TypeError("The saved model identifier is invalid.");
  }
  return value;
}

function profileName(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("A model name is required.");
  const name = value.trim();
  if (!name) throw new TypeError("A model name is required.");
  if (name.length > MAXIMUM_CHAT_PROFILE_NAME_LENGTH) {
    throw new TypeError("The model name is too long.");
  }
  return name;
}

/** Normalize one profile at the persistence boundary. */
export function validateChatProfile(value: unknown): ChatProfile {
  if (!value || typeof value !== "object") throw new TypeError("The saved model is invalid.");
  const candidate = value as Partial<ChatProfile>;
  const config = validateChatConfig({
    apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
    baseUrl: typeof candidate.baseUrl === "string" ? candidate.baseUrl : "",
    model: typeof candidate.model === "string" ? candidate.model : "",
  });
  return {
    id: profileId(candidate.id),
    name: profileName(candidate.name),
    ...config,
  };
}

/** Create a profile from the current form values. */
export function createChatProfile(
  input: ChatProfileInput,
  createId: () => string = () => crypto.randomUUID(),
): ChatProfile {
  return validateChatProfile({ ...input, id: input.id ?? createId() });
}

function emptyState(): ChatProfileState {
  return {
    version: CHAT_PROFILE_STORAGE_VERSION,
    activeProfileId: null,
    profiles: [],
  };
}

/**
 * Parse local storage defensively. A malformed browser value should discard
 * only the saved profile list, never prevent the reader from opening.
 */
export function parseChatProfileState(raw: string | null): ChatProfileState {
  if (!raw) return emptyState();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!value || typeof value !== "object") return emptyState();
  const candidate = value as Partial<ChatProfileState>;
  if (candidate.version !== CHAT_PROFILE_STORAGE_VERSION || !Array.isArray(candidate.profiles)) {
    return emptyState();
  }

  const profiles: ChatProfile[] = [];
  const seenIds = new Set<string>();
  for (const item of candidate.profiles) {
    try {
      const profile = validateChatProfile(item);
      if (seenIds.has(profile.id)) continue;
      seenIds.add(profile.id);
      profiles.push(profile);
      if (profiles.length >= MAXIMUM_CHAT_PROFILES) break;
    } catch {
      // Ignore an individual corrupt entry while retaining valid profiles.
    }
  }
  const activeProfileId = typeof candidate.activeProfileId === "string"
    && seenIds.has(candidate.activeProfileId)
    ? candidate.activeProfileId
    : profiles[0]?.id ?? null;
  return { version: CHAT_PROFILE_STORAGE_VERSION, activeProfileId, profiles };
}

export function serializeChatProfileState(state: ChatProfileState): string {
  const profiles: ChatProfile[] = [];
  const seenIds = new Set<string>();
  for (const item of state.profiles) {
    const profile = validateChatProfile(item);
    if (seenIds.has(profile.id)) continue;
    seenIds.add(profile.id);
    profiles.push(profile);
    if (profiles.length >= MAXIMUM_CHAT_PROFILES) break;
  }
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const activeProfileId = state.activeProfileId && profileIds.has(state.activeProfileId)
    ? state.activeProfileId
    : profiles[0]?.id ?? null;
  return JSON.stringify({
    version: CHAT_PROFILE_STORAGE_VERSION,
    activeProfileId,
    profiles,
  } satisfies ChatProfileState);
}

export function upsertChatProfile(state: ChatProfileState, profile: ChatProfile): ChatProfileState {
  const normalized = validateChatProfile(profile);
  const existingIndex = state.profiles.findIndex((candidate) => candidate.id === normalized.id);
  const profiles = state.profiles.slice();
  if (existingIndex >= 0) {
    profiles.splice(existingIndex, 1, normalized);
  } else {
    profiles.unshift(normalized);
  }
  return {
    version: CHAT_PROFILE_STORAGE_VERSION,
    activeProfileId: normalized.id,
    profiles: profiles.slice(0, MAXIMUM_CHAT_PROFILES),
  };
}

export function removeChatProfile(state: ChatProfileState, id: string): ChatProfileState {
  const profiles = state.profiles.filter((profile) => profile.id !== id);
  const activeProfileId = state.activeProfileId === id
    ? profiles[0]?.id ?? null
    : state.activeProfileId && profiles.some((profile) => profile.id === state.activeProfileId)
      ? state.activeProfileId
      : profiles[0]?.id ?? null;
  return {
    version: CHAT_PROFILE_STORAGE_VERSION,
    activeProfileId,
    profiles,
  };
}

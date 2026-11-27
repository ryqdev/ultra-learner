export interface ChatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Optional provider-specific reasoning intensity. */
  reasoningEffort?: string;
}

export interface ChatProviderCredentials {
  apiKey: string;
  baseUrl: string;
}

export interface ChatModel {
  id: string;
  reasoningEfforts: string[];
}

export const DEFAULT_REASONING_EFFORTS = ["low", "medium", "high"] as const;
export const KNOWN_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const KNOWN_REASONING_EFFORT_SET = new Set<string>(KNOWN_REASONING_EFFORTS);

export type ChatFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ChatTestPayload {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
}

export interface ChatModelsPayload {
  baseUrl: string;
}

export const CHAT_TEST_PATH = "/api/chat/test";
export const CHAT_MODELS_PATH = "/api/chat/models";
export const CHAT_TEST_MESSAGE = "Reply with OK in one short sentence.";
export const MAXIMUM_CHAT_REQUEST_SIZE = 1_000_000;
export const MAXIMUM_CHAT_MODELS = 500;

export const DEFAULT_CHAT_CONFIG: Omit<ChatConfig, "apiKey"> = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

export function normalizeBaseUrl(value: string): string {
  const candidate = value.trim().replace(/\/+$/, "");
  if (!candidate) throw new Error("Base URL is required.");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Base URL must be a valid HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not include credentials.");
  }
  return candidate;
}

/** Normalize the optional effort value before it crosses a request or storage boundary. */
export function normalizeReasoningEffort(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError("Reasoning intensity is invalid.");
  const effort = value.trim();
  if (!effort || effort.toLowerCase() === "default") return undefined;
  if (effort.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(effort)) {
    throw new TypeError("Reasoning intensity is invalid.");
  }
  return effort;
}

function recognizedReasoningEffort(value: unknown): string | undefined {
  const effort = normalizeReasoningEffort(value);
  return effort && KNOWN_REASONING_EFFORT_SET.has(effort.toLowerCase()) ? effort.toLowerCase() : undefined;
}

export function validateChatCredentials(credentials: ChatProviderCredentials): ChatProviderCredentials {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("API key is required.");
  return { apiKey, baseUrl: normalizeBaseUrl(credentials.baseUrl) };
}

export function validateChatConfig(config: ChatConfig): ChatConfig {
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  if (!apiKey) throw new Error("API key is required.");
  if (!model) throw new Error("Model is required.");
  const reasoningEffort = recognizedReasoningEffort(config.reasoningEffort);
  if (config.reasoningEffort && !reasoningEffort) throw new Error("Reasoning intensity is not supported.");
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(config.baseUrl),
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/** Parse the smaller payload accepted by the provider connection test. */
export function parseChatTestPayload(value: unknown): ChatTestPayload {
  if (!value || typeof value !== "object") throw new TypeError("The chat test request is invalid.");
  const candidate = value as Partial<ChatTestPayload>;
  if (typeof candidate.baseUrl !== "string" || typeof candidate.model !== "string") {
    throw new TypeError("The chat provider settings are invalid.");
  }
  const baseUrl = normalizeBaseUrl(candidate.baseUrl);
  const model = candidate.model.trim();
  if (!model) throw new TypeError("Model is required.");
  const rawReasoningEffort = candidate.reasoningEffort
    ?? (candidate as Partial<ChatTestPayload> & { reasoning_effort?: unknown }).reasoning_effort;
  const reasoningEffort = recognizedReasoningEffort(rawReasoningEffort);
  if (rawReasoningEffort && !reasoningEffort) throw new TypeError("Reasoning intensity is not supported.");
  return { baseUrl, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/** Parse and normalize the small payload accepted by the model discovery proxy. */
export function parseChatModelsPayload(value: unknown): ChatModelsPayload {
  if (!value || typeof value !== "object") throw new TypeError("The model list request is invalid.");
  const candidate = value as Partial<ChatModelsPayload>;
  if (typeof candidate.baseUrl !== "string") throw new TypeError("The chat provider settings are invalid.");
  return { baseUrl: normalizeBaseUrl(candidate.baseUrl) };
}

export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = new URL(normalized);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return normalized;
  url.pathname = `${pathname || ""}/chat/completions`;
  return url.toString().replace(/\/$/, "");
}

export function chatModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    // normalizeBaseUrl already validates this; retain a safe fallback for
    // callers that replace URL in a test environment.
    return `${normalized}/models`;
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/models")) return normalized;
  if (pathname.endsWith("/chat/completions")) {
    url.pathname = `${pathname.slice(0, -"/chat/completions".length)}/models`;
    return url.toString().replace(/\/$/, "");
  }
  url.pathname = `${pathname || ""}/models`;
  return url.toString().replace(/\/$/, "");
}

/** Build the browser request for the lightweight same-origin connection test. */
export function createChatTestRequest(config: ChatConfig): RequestInit & { url: string } {
  const valid = validateChatConfig(config);
  const body: ChatTestPayload = {
    baseUrl: valid.baseUrl,
    model: valid.model,
    ...(valid.reasoningEffort ? { reasoningEffort: valid.reasoningEffort } : {}),
  };
  return {
    url: CHAT_TEST_PATH,
    method: "POST",
    headers: {
      Authorization: `Bearer ${valid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

/** Build the same-origin request used to discover a provider's models. */
export function createChatModelsRequest(
  credentials: ChatProviderCredentials,
): RequestInit & { url: string } {
  const valid = validateChatCredentials(credentials);
  return {
    url: CHAT_MODELS_PATH,
    method: "POST",
    headers: {
      Authorization: `Bearer ${valid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ baseUrl: valid.baseUrl } satisfies ChatModelsPayload),
  };
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string } | string;
  message?: string;
  code?: string;
}

interface ChatModelsEnvelope {
  data?: unknown;
  models?: unknown;
}

function providerErrorMessage(payload: ChatCompletionResponse): string | undefined {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  if (payload.error && typeof payload.error === "object" && typeof payload.error.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  return undefined;
}

function modelRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const envelope = payload as ChatModelsEnvelope;
  if (Array.isArray(envelope.data)) return envelope.data;
  if (Array.isArray(envelope.models)) return envelope.models;
  if (envelope.data && typeof envelope.data === "object") {
    const nested = envelope.data as ChatModelsEnvelope;
    if (Array.isArray(nested.models)) return nested.models;
    if (Array.isArray(nested.data)) return nested.data;
  }
  return [];
}

function reasoningMetadata(record: Record<string, unknown>): unknown[] {
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object") return [];
  const nested = metadata as Record<string, unknown>;
  return [
    nested.reasoning_efforts,
    nested.reasoningEfforts,
    nested.supported_reasoning_efforts,
    nested.supportedReasoningEfforts,
    nested.reasoning_levels,
    nested.reasoningLevels,
    nested.reasoning_effort,
    nested.reasoningEffort,
    nested.reasoning,
  ];
}

function effortName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.toLowerCase() === "default") return undefined;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(candidate)) return undefined;
  const normalized = candidate.toLowerCase();
  if (KNOWN_REASONING_EFFORT_SET.has(normalized)) return normalized;
  const withoutPrefix = normalized.startsWith("reasoning_") ? normalized.slice("reasoning_".length) : "";
  return KNOWN_REASONING_EFFORT_SET.has(withoutPrefix) ? withoutPrefix : undefined;
}

function effortValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const direct = effortName(item);
        return direct ? [direct] : effortValues(item);
      })
      .filter((item): item is string => Boolean(item));
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,|]+/)
      .map(effortName)
      .filter((item): item is string => Boolean(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "levels",
      "efforts",
      "values",
      "enum",
      "options",
      "effort",
      "effort_levels",
      "effortLevels",
      "supported",
      "supported_levels",
      "supported_efforts",
      "supportedReasoningEfforts",
      "reasoning_efforts",
      "reasoningEfforts",
      "reasoning_levels",
      "reasoningLevels",
      "reasoning_effort",
      "reasoningEffort",
    ]) {
      const values = effortValues(record[key]);
      if (values.length > 0) return values;
    }
    // Some catalogs represent a level as an object in an array, for example
    // `{ level: "medium" }`. Restrict this fallback to level-like keys so
    // arbitrary model metadata cannot become a fake reasoning option.
    for (const key of ["level", "value", "name"]) {
      const direct = effortName(record[key]);
      if (direct) return [direct];
    }
  }
  return [];
}

// Catalogs spell a capability flag as a boolean or as a word, and the words vary by gateway.
// Unknown words still count as support, as before, but a plain refusal no longer does.
const REFUSED_CAPABILITY_WORDS = new Set([
  "", "0", "false", "no", "none", "null", "off", "disabled", "unavailable", "unsupported",
  "not supported", "not_supported", "not-supported",
]);

function hasReasoningCapability(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return !REFUSED_CAPABILITY_WORDS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && /reason/i.test(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return record.supported === true
      || record.enabled === true
      || record.reasoning_effort === true
      || record.reasoning === true;
  }
  return false;
}

function inferredReasoningEfforts(modelId: string, record: Record<string, unknown>): string[] {
  const parameters = record.supported_parameters;
  if (Array.isArray(parameters) && parameters.some((item) => typeof item === "string" && /reasoning(?:[_-]?effort)?/i.test(item))) {
    return [...DEFAULT_REASONING_EFFORTS];
  }
  const capabilities = record.capabilities;
  if (capabilities && typeof capabilities === "object") {
    const capabilityRecord = capabilities as Record<string, unknown>;
    if (hasReasoningCapability(capabilityRecord.reasoning) || hasReasoningCapability(capabilityRecord.reasoning_effort)) {
      return [...DEFAULT_REASONING_EFFORTS];
    }
  }
  if (hasReasoningCapability(record.reasoning) || hasReasoningCapability(record.reasoning_effort)) {
    return [...DEFAULT_REASONING_EFFORTS];
  }
  if (
    hasReasoningCapability(record.supports_reasoning)
    || hasReasoningCapability(record.supports_reasoning_effort)
    || hasReasoningCapability(record.reasoning_supported)
  ) {
    return [...DEFAULT_REASONING_EFFORTS];
  }
  // A few providers omit capability metadata for well-known reasoning model
  // families. Keep the fallback conservative for ordinary chat models.
  if (/\b(?:o[1-9](?:[-_a-z0-9.]*)?|gpt-5(?:[-_a-z0-9.]*)?|deepseek[-_]?r1(?:[-_a-z0-9.]*)?|qwq(?:[-_a-z0-9.]*)?|reason(?:ing)?|thinking)\b/i.test(modelId)) {
    return [...DEFAULT_REASONING_EFFORTS];
  }
  return [];
}

/** Keep the preferred model when the catalog offers it; otherwise fall back to the catalog's first entry. */
export function selectCatalogModel(models: ChatModel[], preferredModel: string): string {
  return models.some((model) => model.id === preferredModel) ? preferredModel : models[0]?.id ?? "";
}

/** Normalize the varied model-list metadata used by OpenAI-compatible gateways. */
export function parseChatModelsResponse(value: unknown): ChatModel[] {
  const models: ChatModel[] = [];
  const seen = new Set<string>();
  for (const item of modelRecords(value)) {
    const record = typeof item === "string"
      ? { id: item }
      : item && typeof item === "object"
        ? item as Record<string, unknown>
        : null;
    if (!record) continue;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const explicit = [
      record.reasoning_efforts,
      record.reasoningEfforts,
      record.supported_reasoning_efforts,
      record.supportedReasoningEfforts,
      record.reasoning_levels,
      record.reasoningLevels,
      record.reasoning_effort,
      record.reasoningEffort,
      record.reasoning,
      record.reasoning_capabilities,
      record.reasoning_strengths,
      record.reasoningStrengths,
      ...reasoningMetadata(record),
    ].flatMap(effortValues);
    const uniqueEfforts = [...new Set(explicit)];
    const reasoningEfforts = uniqueEfforts.length > 0
      ? uniqueEfforts
      : inferredReasoningEfforts(id, record);
    models.push({ id, reasoningEfforts });
    if (models.length >= MAXIMUM_CHAT_MODELS) break;
  }
  return models;
}

function completionText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
  }
  return "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function networkErrorMessage(url: string): string {
  const service = url === CHAT_MODELS_PATH ? "model discovery service" : "connection test";
  return `Could not reach the local ${service}. Restart Ultra Learner and try again.`;
}

async function responsePayload(response: Response): Promise<ChatCompletionResponse> {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body) as ChatCompletionResponse;
  } catch {
    return {};
  }
}

async function requestCompletionResponse(
  request: RequestInit & { url: string },
  signal: AbortSignal | undefined,
  fetcher: ChatFetcher,
): Promise<ChatCompletionResponse> {
  const { url, ...init } = request;
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(networkErrorMessage(url), { cause: error });
  }
  let payload: ChatCompletionResponse;
  try {
    payload = await responsePayload(response);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Could not read the model provider response.", { cause: error });
  }
  if (!response.ok) {
    throw new Error(providerErrorMessage(payload) || `The model request failed (${response.status}).`);
  }
  return payload;
}

/**
 * Ask the provider for one minimal completion through the same-origin test
 * route, which keeps the provider URL and key on the local boundary.
 */
export async function testChatConnection(
  config: ChatConfig,
  signal?: AbortSignal,
  fetcher: ChatFetcher = fetch,
): Promise<string> {
  const payload = await requestCompletionResponse(createChatTestRequest(config), signal, fetcher);
  const text = completionText(payload);
  if (!text) throw new Error("The provider returned an invalid completion response.");
  return text;
}

/** Fetch and normalize the model catalog through the same-origin proxy. */
export async function fetchChatModels(
  credentials: ChatProviderCredentials,
  signal?: AbortSignal,
  fetcher: ChatFetcher = fetch,
): Promise<ChatModel[]> {
  const request = createChatModelsRequest(credentials);
  const { url, ...init } = request;
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(networkErrorMessage(url), { cause: error });
  }

  let payload: unknown = {};
  try {
    const body = await response.text();
    if (body.trim()) payload = JSON.parse(body) as unknown;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Could not read the model provider response.", { cause: error });
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? providerErrorMessage(payload as ChatCompletionResponse)
      : undefined;
    throw new Error(message || `The model list request failed (${response.status}).`);
  }
  return parseChatModelsResponse(payload);
}

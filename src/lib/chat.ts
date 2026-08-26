export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type ChatFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ChatTransport = "proxy" | "direct";

export interface ChatRequestOptions {
  /** Select the browser transport explicitly; the same-origin proxy is the safe default. */
  transport?: ChatTransport;
}

export interface ChatProxyPayload {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
}

export const CHAT_PROXY_PATH = "/api/chat/completions";
export const MAXIMUM_CHAT_REQUEST_SIZE = 1_000_000;
const MAXIMUM_CHAT_MESSAGES = 100;
const MAXIMUM_CHAT_MESSAGE_LENGTH = 200_000;

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
  return candidate;
}

export function validateChatConfig(config: ChatConfig): ChatConfig {
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  if (!apiKey) throw new Error("API key is required.");
  if (!model) throw new Error("Model is required.");
  return { apiKey, baseUrl: normalizeBaseUrl(config.baseUrl), model };
}

/** Validate the conversation before it crosses either the browser or proxy boundary. */
export function validateChatMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError("At least one chat message is required.");
  }
  if (messages.length > MAXIMUM_CHAT_MESSAGES) {
    throw new TypeError("The chat conversation is too long.");
  }

  let totalLength = 0;
  const normalizedMessages: ChatMessage[] = [];
  for (const message of messages) {
    if (!message || !["system", "user", "assistant"].includes(message.role)) {
      throw new TypeError("The chat message role is invalid.");
    }
    if (typeof message.content !== "string" || !message.content.trim()) {
      throw new TypeError("The chat message cannot be empty.");
    }
    if (message.content.length > MAXIMUM_CHAT_MESSAGE_LENGTH) {
      throw new TypeError("A chat message is too long.");
    }
    totalLength += message.content.length;
    if (totalLength > MAXIMUM_CHAT_REQUEST_SIZE) {
      throw new TypeError("The chat request is too large.");
    }
    normalizedMessages.push({ role: message.role, content: message.content });
  }
  return normalizedMessages;
}

/** Parse the untrusted body accepted by the same-origin chat proxy. */
export function parseChatProxyPayload(value: unknown): ChatProxyPayload {
  if (!value || typeof value !== "object") throw new TypeError("The chat request is invalid.");
  const candidate = value as Partial<ChatProxyPayload>;
  if (typeof candidate.baseUrl !== "string" || typeof candidate.model !== "string") {
    throw new TypeError("The chat provider settings are invalid.");
  }
  const baseUrl = normalizeBaseUrl(candidate.baseUrl);
  const model = candidate.model.trim();
  if (!model) throw new TypeError("Model is required.");
  if (!Array.isArray(candidate.messages)) throw new TypeError("The chat messages are invalid.");
  const messages = validateChatMessages(candidate.messages as ChatMessage[]);
  return {
    baseUrl,
    model,
    messages,
  };
}

export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

export function createChatRequest(config: ChatConfig, messages: ChatMessage[]): RequestInit & { url: string } {
  const valid = validateChatConfig(config);
  const validMessages = validateChatMessages(messages);
  return {
    url: chatCompletionsUrl(valid.baseUrl),
    method: "POST",
    headers: {
      Authorization: `Bearer ${valid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: valid.model, messages: validMessages, stream: false }),
  };
}

/** Build the browser request for the same-origin proxy. The key is sent only in a header. */
export function createChatProxyRequest(config: ChatConfig, messages: ChatMessage[]): RequestInit & { url: string } {
  const valid = validateChatConfig(config);
  const validMessages = validateChatMessages(messages);
  return {
    url: CHAT_PROXY_PATH,
    method: "POST",
    headers: {
      Authorization: `Bearer ${valid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      baseUrl: valid.baseUrl,
      model: valid.model,
      messages: validMessages,
    } satisfies ChatProxyPayload),
  };
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
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
  if (url === CHAT_PROXY_PATH) {
    return "Could not reach the local chat proxy. Restart Ultra Learner and try again.";
  }
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // The URL was already validated, but keep the fallback safe for custom fetchers.
  }
  return `Could not connect to ${host}. Check the Base URL, network connection, and provider availability. A direct browser request may also be blocked by CORS.`;
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

export async function requestChatCompletion(
  config: ChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  fetcher: ChatFetcher = fetch,
  options: ChatRequestOptions = {},
): Promise<string> {
  const request = options.transport === "proxy"
    ? createChatProxyRequest(config, messages)
    : createChatRequest(config, messages);
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
    throw new Error(payload.error?.message || `The model request failed (${response.status}).`);
  }
  const text = completionText(payload);
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

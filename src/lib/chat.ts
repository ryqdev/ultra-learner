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

export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

export function createChatRequest(config: ChatConfig, messages: ChatMessage[]): RequestInit & { url: string } {
  const valid = validateChatConfig(config);
  return {
    url: chatCompletionsUrl(valid.baseUrl),
    method: "POST",
    headers: {
      Authorization: `Bearer ${valid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: valid.model, messages, stream: false }),
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

export async function requestChatCompletion(
  config: ChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  fetcher: ChatFetcher = fetch,
): Promise<string> {
  const request = createChatRequest(config, messages);
  const { url, ...init } = request;
  const response = await fetcher(url, { ...init, signal });
  let payload: ChatCompletionResponse = {};
  try {
    payload = (await response.json()) as ChatCompletionResponse;
  } catch {
    // Some gateways return an empty body for errors; the status still conveys
    // enough information for the user-facing error below.
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || `The model request failed (${response.status}).`);
  }
  const text = completionText(payload);
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

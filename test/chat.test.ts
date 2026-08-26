import { describe, expect, test } from "bun:test";

import {
  CHAT_PROXY_PATH,
  chatCompletionsUrl,
  createChatProxyRequest,
  createChatRequest,
  normalizeBaseUrl,
  parseChatProxyPayload,
  requestChatCompletion,
  validateChatConfig,
} from "../src/lib/chat.ts";
import {
  createSelectionContext,
  normalizeSelectionText,
  selectionPrompt,
} from "../src/lib/selection.ts";

describe("chat configuration and request helpers", () => {
  test("normalizes compatible provider endpoints without leaking credentials", () => {
    expect(normalizeBaseUrl(" https://example.test/v1/// ")).toBe("https://example.test/v1");
    expect(chatCompletionsUrl("https://example.test/v1")).toBe("https://example.test/v1/chat/completions");
    expect(chatCompletionsUrl("https://example.test/v1/chat/completions")).toBe("https://example.test/v1/chat/completions");
    expect(() => normalizeBaseUrl("file:///tmp/model")).toThrow("HTTP or HTTPS");
    expect(() => validateChatConfig({ apiKey: "", baseUrl: "https://example.test/v1", model: "m" })).toThrow("API key");
  });

  test("builds an OpenAI-compatible request and parses a response", async () => {
    const request = createChatRequest(
      { apiKey: "secret", baseUrl: "https://example.test/v1", model: "study-model" },
      [{ role: "user", content: "hello" }],
    );
    expect(request.url).toBe("https://example.test/v1/chat/completions");
    expect(request.headers).toEqual({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      model: "study-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });

    const answer = await requestChatCompletion(
      { apiKey: "secret", baseUrl: "https://example.test/v1", model: "study-model" },
      [{ role: "user", content: "hello" }],
      undefined,
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "  hi there  " } }] }), { status: 200 }),
      { transport: "direct" },
    );
    expect(answer).toBe("hi there");
  });

  test("builds the same-origin proxy request and reports transport failures clearly", async () => {
    const request = createChatProxyRequest(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      [{ role: "user", content: "hello" }],
    );
    expect(request.url).toBe(CHAT_PROXY_PATH);
    expect(request.headers).toEqual({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
      messages: [{ role: "user", content: "hello" }],
    });

    await expect(requestChatCompletion(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      [{ role: "user", content: "hello" }],
      undefined,
      async () => { throw new TypeError("Failed to fetch"); },
      { transport: "proxy" },
    )).rejects.toThrow("local chat proxy");

    await expect(requestChatCompletion(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      [{ role: "user", content: "hello" }],
      undefined,
      async () => { throw new TypeError("Failed to fetch"); },
      { transport: "direct" },
    )).rejects.toThrow("gateway.example");
  });

  test("validates untrusted proxy payloads before forwarding them", () => {
    expect(parseChatProxyPayload({
      baseUrl: " https://gateway.example/v1/ ",
      model: " study-model ",
      messages: [{ role: "user", content: "hello" }],
    })).toEqual({
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(() => parseChatProxyPayload({ baseUrl: "file:///tmp/model", model: "m", messages: [] }))
      .toThrow("HTTP or HTTPS");
    expect(() => parseChatProxyPayload({ baseUrl: "https://gateway.example", model: "m", messages: [] }))
      .toThrow("At least one chat message");
  });
});

describe("PDF selection context", () => {
  test("normalizes and bounds selected text before it reaches the chat", () => {
    expect(normalizeSelectionText("  one\n\t two  ")).toBe("one two");
    expect(createSelectionContext("  one\n two ", 2, "box")).toEqual({ text: "one two", page: 2, source: "box" });
    expect(createSelectionContext("", 2, "text")).toBeNull();
    expect(createSelectionContext("text", 0, "text")).toBeNull();
    expect(selectionPrompt({ text: "one two", page: 2, source: "text" })).toBe("[Selected from page 2]\none two");
  });
});

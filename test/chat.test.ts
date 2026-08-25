import { describe, expect, test } from "bun:test";

import {
  chatCompletionsUrl,
  createChatRequest,
  normalizeBaseUrl,
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
    );
    expect(answer).toBe("hi there");
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

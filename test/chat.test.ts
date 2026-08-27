import { describe, expect, test } from "bun:test";

import {
  CHAT_MODELS_PATH,
  CHAT_PROXY_PATH,
  CHAT_TEST_MESSAGE,
  CHAT_TEST_PATH,
  chatCompletionsUrl,
  chatModelsUrl,
  createChatModelsRequest,
  createChatTestRequest,
  createChatProxyRequest,
  createChatRequest,
  fetchChatModels,
  normalizeBaseUrl,
  parseChatModelsResponse,
  parseChatProxyPayload,
  parseChatTestPayload,
  requestChatCompletion,
  testChatConnection,
  validateChatConfig,
  validateChatCredentials,
} from "../src/lib/chat.ts";
import {
  CHAT_PROFILE_STORAGE_KEY,
  CHAT_PROFILE_STORAGE_VERSION,
  createChatProfile,
  parseChatProfileState,
  removeChatProfile,
  serializeChatProfileState,
  upsertChatProfile,
  type ChatProfileState,
} from "../src/lib/chat-profiles.ts";
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
    expect(chatCompletionsUrl("https://example.test/v1?tenant=demo")).toBe("https://example.test/v1/chat/completions?tenant=demo");
    expect(() => normalizeBaseUrl("file:///tmp/model")).toThrow("HTTP or HTTPS");
    expect(() => normalizeBaseUrl("https://user:password@example.test/v1")).toThrow("credentials");
    expect(() => validateChatConfig({ apiKey: "", baseUrl: "https://example.test/v1", model: "m" })).toThrow("API key");
    expect(validateChatCredentials({ apiKey: " secret ", baseUrl: "https://example.test/v1///" }))
      .toEqual({ apiKey: "secret", baseUrl: "https://example.test/v1" });
    expect(() => validateChatConfig({ apiKey: "secret", baseUrl: "https://example.test/v1", model: "m", reasoningEffort: "bad value" }))
      .toThrow("Reasoning intensity");
    expect(() => validateChatConfig({ apiKey: "secret", baseUrl: "https://example.test/v1", model: "m", reasoningEffort: "turbo" }))
      .toThrow("not supported");
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

    const reasoningRequest = createChatRequest(
      { apiKey: "secret", baseUrl: "https://example.test/v1", model: "reasoning-model", reasoningEffort: "high" },
      [{ role: "user", content: "hello" }],
    );
    expect(JSON.parse(String(reasoningRequest.body)).reasoning_effort).toBe("high");

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

  test("uses the same-origin proxy by default and can test a provider connection", async () => {
    const request = createChatTestRequest({
      apiKey: "secret",
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
    });
    expect(request.url).toBe(CHAT_TEST_PATH);
    expect(JSON.parse(String(request.body))).toEqual({
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
    });

    let requestUrl = "";
    let requestBody: unknown;
    const answer = await requestChatCompletion(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      [{ role: "user", content: "hello" }],
      undefined,
      async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { content: "hello" } }] });
      },
    );
    expect(answer).toBe("hello");
    expect(requestUrl).toBe(CHAT_PROXY_PATH);
    expect(requestBody).toEqual({
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(parseChatTestPayload({ baseUrl: " https://gateway.example/v1/ ", model: " m " }))
      .toEqual({ baseUrl: "https://gateway.example/v1", model: "m" });
    expect(() => parseChatTestPayload({ baseUrl: "file:///tmp/model", model: "m" })).toThrow("HTTP or HTTPS");

    const testAnswer = await testChatConnection(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      undefined,
      async (input, init) => {
        expect(String(input)).toBe(CHAT_TEST_PATH);
        expect(JSON.parse(String(init?.body))).toEqual({
          baseUrl: "https://gateway.example/v1",
          model: "study-model",
        });
        return Response.json({ choices: [{ message: { content: ` ${CHAT_TEST_MESSAGE} ` } }] });
      },
    );
    expect(testAnswer).toBe(CHAT_TEST_MESSAGE);

    await expect(testChatConnection(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      undefined,
      async () => Response.json({ message: "invalid key" }, { status: 401 }),
    )).rejects.toThrow("invalid key");
  });

  test("forwards a selected reasoning intensity to proxy and provider test requests", async () => {
    const proxy = createChatProxyRequest(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "reasoning-model", reasoningEffort: "high" },
      [{ role: "user", content: "hello" }],
    );
    expect(JSON.parse(String(proxy.body)).reasoningEffort).toBe("high");
    const testRequest = createChatTestRequest({
      apiKey: "secret",
      baseUrl: "https://gateway.example/v1",
      model: "reasoning-model",
      reasoningEffort: "low",
    });
    expect(JSON.parse(String(testRequest.body))).toMatchObject({ reasoningEffort: "low" });
  });

  test("builds and parses model discovery requests with reasoning capabilities", async () => {
    expect(chatModelsUrl(" https://gateway.example/v1/// ")).toBe("https://gateway.example/v1/models");
    expect(chatModelsUrl("https://gateway.example/v1/chat/completions")).toBe("https://gateway.example/v1/models");

    const request = createChatModelsRequest({ apiKey: "secret", baseUrl: "https://gateway.example/v1" });
    expect(request.url).toBe(CHAT_MODELS_PATH);
    expect(request.headers).toEqual({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({ baseUrl: "https://gateway.example/v1" });

    expect(parseChatModelsResponse({
      data: [
        { id: "ordinary-model" },
        { id: "reasoning-model", supported_parameters: ["reasoning_effort"] },
        { id: "explicit-model", reasoning_efforts: ["low", "high", "low"] },
        { id: "explicit-model", reasoning_efforts: ["medium"] },
        { id: "named-model", name: "Named model" },
        { name: "display-only-name" },
        { id: "ignored", reasoning_effort: { levels: ["minimal", "high"] } },
        { id: "invalid-efforts", reasoning_efforts: ["fast", "slow"] },
      ],
    })).toEqual([
      { id: "ordinary-model", reasoningEfforts: [] },
      { id: "reasoning-model", reasoningEfforts: ["low", "medium", "high"] },
      { id: "explicit-model", reasoningEfforts: ["low", "high"] },
      { id: "named-model", reasoningEfforts: [] },
      { id: "ignored", reasoningEfforts: ["minimal", "high"] },
      { id: "invalid-efforts", reasoningEfforts: [] },
    ]);
    expect(parseChatModelsResponse({ data: { models: [{ id: "nested-model" }] } }))
      .toEqual([{ id: "nested-model", reasoningEfforts: [] }]);

    const models = await fetchChatModels(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1" },
      undefined,
      async (input, init) => {
        expect(String(input)).toBe(CHAT_MODELS_PATH);
        expect(init?.headers).toEqual({ Authorization: "Bearer secret", "Content-Type": "application/json" });
        expect(JSON.parse(String(init?.body))).toEqual({ baseUrl: "https://gateway.example/v1" });
        return Response.json({ data: [{ id: "model-a", supported_parameters: ["reasoning"] }] });
      },
    );
    expect(models).toEqual([{ id: "model-a", reasoningEfforts: ["low", "medium", "high"] }]);
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

describe("saved chat provider profiles", () => {
  const config = { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" };

  test("validates, serializes, selects, and removes profiles", () => {
    expect(CHAT_PROFILE_STORAGE_KEY).toBe("ultra-learner.chat-profiles");
    const first = createChatProfile({ name: "Gateway", ...config, reasoningEffort: "medium" }, () => "profile-one");
    const second = createChatProfile({ name: "Backup", ...config, model: "backup-model" }, () => "profile-two");
    let state: ChatProfileState = { version: CHAT_PROFILE_STORAGE_VERSION, activeProfileId: null, profiles: [] };
    state = upsertChatProfile(state, first);
    state = upsertChatProfile(state, second);
    expect(state.activeProfileId).toBe("profile-two");
    const restored = parseChatProfileState(serializeChatProfileState(state));
    expect(restored.profiles.map((profile) => profile.name)).toEqual(["Backup", "Gateway"]);
    expect(restored.profiles.find((profile) => profile.id === "profile-one")?.reasoningEffort).toBe("medium");
    expect(removeChatProfile(restored, "profile-two").activeProfileId).toBe("profile-one");
  });

  test("ignores malformed local storage entries without throwing", () => {
    expect(parseChatProfileState("not json").profiles).toEqual([]);
    expect(parseChatProfileState(JSON.stringify({
      version: CHAT_PROFILE_STORAGE_VERSION,
      activeProfileId: "bad",
      profiles: [{ id: "ok", name: "valid", ...config }, { id: "bad", name: "", ...config }],
    }))).toMatchObject({ activeProfileId: "ok", profiles: [{ id: "ok" }] });
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

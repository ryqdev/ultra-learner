import { describe, expect, test } from "bun:test";

import {
  CHAT_MODELS_PATH,
  CHAT_TEST_MESSAGE,
  CHAT_TEST_PATH,
  chatCompletionsUrl,
  chatModelsUrl,
  createChatModelsRequest,
  createChatTestRequest,
  fetchChatModels,
  normalizeBaseUrl,
  parseChatModelsResponse,
  parseChatTestPayload,
  selectCatalogModel,
  testChatConnection,
  validateChatConfig,
  validateChatCredentials,
} from "../src/lib/chat.ts";
import {
  CHAT_PROFILE_STORAGE_KEY,
  CHAT_PROFILE_STORAGE_VERSION,
  createChatProfile,
  editableProfileName,
  parseChatProfileState,
  profileModelCatalog,
  removeChatProfile,
  resolveProfileName,
  serializeChatProfileState,
  upsertChatProfile,
  type ChatProfileState,
} from "../src/lib/chat-profiles.ts";

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

  test("tests a provider connection through the same-origin route", async () => {
    const request = createChatTestRequest({
      apiKey: "secret",
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
    });
    expect(request.url).toBe(CHAT_TEST_PATH);
    expect(request.headers).toEqual({ Authorization: "Bearer secret", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      baseUrl: "https://gateway.example/v1",
      model: "study-model",
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
    await expect(testChatConnection(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      undefined,
      async () => Response.json({ choices: [{ message: { content: "  " } }] }),
    )).rejects.toThrow("invalid completion response");
  });

  test("reports an unreachable local server instead of a bare fetch failure", async () => {
    const unreachable = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
    await expect(testChatConnection(
      { apiKey: "secret", baseUrl: "https://gateway.example/v1", model: "study-model" },
      undefined,
      unreachable,
    )).rejects.toThrow("local connection test");
    await expect(fetchChatModels({ apiKey: "secret", baseUrl: "https://gateway.example/v1" }, undefined, unreachable))
      .rejects.toThrow("local model discovery service");
  });

  test("forwards a selected reasoning intensity to provider test requests", async () => {
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

  test("names an unnamed setup after its model and keeps a chosen name", () => {
    expect(resolveProfileName("", "model-a")).toBe("model-a");
    expect(resolveProfileName("  Work gateway ", "model-a")).toBe("Work gateway");

    const unnamed = createChatProfile({ name: resolveProfileName("", config.model), ...config }, () => "profile-one");
    expect(editableProfileName(unnamed)).toBe("");
    // Switching the model of an unnamed setup must not leave it labelled with the old one.
    const switched = createChatProfile({
      ...unnamed,
      model: "other-model",
      name: resolveProfileName(editableProfileName(unnamed), "other-model"),
    });
    expect(switched.name).toBe("other-model");

    // A model id longer than a name may be still saves, and still counts as unnamed afterwards.
    const longModel = `accounts/example/models/${"very-long-model-name-".repeat(5)}v1`;
    expect(longModel.length).toBeGreaterThan(80);
    const long = createChatProfile({ ...config, model: longModel, name: resolveProfileName("", longModel) }, () => "long");
    expect(long.name).toBe(longModel.slice(0, 80));
    expect(long.model).toBe(longModel);
    expect(editableProfileName(long)).toBe("");

    const named = createChatProfile({ name: "Work gateway", ...config }, () => "profile-two");
    expect(editableProfileName(named)).toBe("Work gateway");
    expect(resolveProfileName(editableProfileName(named), "other-model")).toBe("Work gateway");
  });

  test("keeps a fetched model list while it still describes the saved setup", () => {
    const profile = createChatProfile({ name: "Gateway", ...config, reasoningEffort: "high" }, () => "profile-one");
    const models = [
      { id: "first-model", reasoningEfforts: [] },
      { id: "study-model", reasoningEfforts: ["low", "high"] },
    ];

    expect(profileModelCatalog(profile, { baseUrl: config.baseUrl, apiKey: config.apiKey, models })).toBe(models);
    const savedOnly = [{ id: "study-model", reasoningEfforts: ["high"] }];
    expect(profileModelCatalog(profile, { baseUrl: config.baseUrl, apiKey: "rotated", models })).toEqual(savedOnly);
    expect(profileModelCatalog(profile, { baseUrl: "https://other.example/v1", apiKey: config.apiKey, models }))
      .toEqual(savedOnly);
    expect(profileModelCatalog(profile, { baseUrl: config.baseUrl, apiKey: config.apiKey, models: [models[0]!] }))
      .toEqual(savedOnly);
    expect(profileModelCatalog(profile, { baseUrl: "", apiKey: "", models: [] })).toEqual(savedOnly);
  });

  test("keeps the configured model across a refreshed catalog when it is still offered", () => {
    const models = [{ id: "first-model", reasoningEfforts: [] }, { id: "study-model", reasoningEfforts: [] }];
    expect(selectCatalogModel(models, "study-model")).toBe("study-model");
    expect(selectCatalogModel(models, "retired-model")).toBe("first-model");
    expect(selectCatalogModel(models, "")).toBe("first-model");
    expect(selectCatalogModel([], "study-model")).toBe("");
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

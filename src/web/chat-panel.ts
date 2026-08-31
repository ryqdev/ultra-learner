import {
  DEFAULT_CHAT_CONFIG,
  fetchChatModels,
  testChatConnection,
  validateChatCredentials,
  validateChatConfig,
  type ChatConfig,
  type ChatModel,
} from "../lib/chat.ts";
import {
  CHAT_PROFILE_STORAGE_KEY,
  CHAT_PROFILE_STORAGE_VERSION,
  createChatProfile,
  parseChatProfileState,
  removeChatProfile,
  serializeChatProfileState,
  upsertChatProfile,
  type ChatProfileState,
} from "../lib/chat-profiles.ts";
import { requiredElement } from "./dom.ts";

interface ModelConfigPanelElements {
  configForm: HTMLFormElement;
  configSummary: HTMLElement;
  statusDot: HTMLElement;
  profileSelect: HTMLSelectElement;
  newModelButton: HTMLButtonElement;
  providerPreset: HTMLSelectElement;
  apiKey: HTMLInputElement;
  apiKeyToggle: HTMLButtonElement;
  baseUrl: HTMLInputElement;
  fetchModelsButton: HTMLButtonElement;
  fetchModelsLabel: HTMLElement;
  modelSelect: HTMLSelectElement;
  modelHelp: HTMLElement;
  reasoningEffort: HTMLSelectElement;
  reasoningHelp: HTMLElement;
  testButton: HTMLButtonElement;
  testLabel: HTMLElement;
  deleteButton: HTMLButtonElement;
  configStatus: HTMLElement;
}

interface ProviderPreset {
  label: string;
  baseUrl: string;
  apiKey?: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "lm-studio" },
};

function profileStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function blankProfileState(): ChatProfileState {
  return { version: CHAT_PROFILE_STORAGE_VERSION, activeProfileId: null, profiles: [] };
}

export class ModelConfigPanelController {
  private readonly elements: ModelConfigPanelElements;
  private config: ChatConfig = { apiKey: "", ...DEFAULT_CHAT_CONFIG };
  private profileState: ChatProfileState = blankProfileState();
  private models: ChatModel[] = [];
  private modelsBaseUrl = "";
  private modelsApiKey = "";
  private testController: AbortController | null = null;
  private modelsController: AbortController | null = null;

  public constructor() {
    this.elements = {
      configForm: requiredElement<HTMLFormElement>("chat-config-form"),
      configSummary: requiredElement("chat-config-summary"),
      statusDot: requiredElement("chat-status-dot"),
      profileSelect: requiredElement<HTMLSelectElement>("chat-profile-select"),
      newModelButton: requiredElement<HTMLButtonElement>("chat-new-model"),
      providerPreset: requiredElement<HTMLSelectElement>("chat-provider-preset"),
      apiKey: requiredElement<HTMLInputElement>("chat-api-key"),
      apiKeyToggle: requiredElement<HTMLButtonElement>("chat-api-key-toggle"),
      baseUrl: requiredElement<HTMLInputElement>("chat-base-url"),
      fetchModelsButton: requiredElement<HTMLButtonElement>("chat-fetch-models"),
      fetchModelsLabel: requiredElement("chat-fetch-models-label"),
      modelSelect: requiredElement<HTMLSelectElement>("chat-model"),
      modelHelp: requiredElement("chat-model-help"),
      reasoningEffort: requiredElement<HTMLSelectElement>("chat-reasoning-effort"),
      reasoningHelp: requiredElement("chat-reasoning-help"),
      testButton: requiredElement<HTMLButtonElement>("chat-test-button"),
      testLabel: requiredElement("chat-test-label"),
      deleteButton: requiredElement<HTMLButtonElement>("chat-delete-button"),
      configStatus: requiredElement("chat-config-status"),
    };
    this.loadProfiles();
    this.bindEvents();
    this.updateConfigSummary();
  }

  private bindEvents(): void {
    const { elements } = this;
    elements.configForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveConfig();
    });
    elements.profileSelect.addEventListener("change", () => this.selectProfile(elements.profileSelect.value));
    elements.newModelButton.addEventListener("click", () => this.startNewModel());
    elements.providerPreset.addEventListener("change", () => this.applyProviderPreset(elements.providerPreset.value));
    elements.apiKeyToggle.addEventListener("click", () => this.toggleApiKeyVisibility());
    for (const input of [elements.apiKey, elements.baseUrl]) {
      input.addEventListener("input", () => {
        this.invalidateModels();
        this.syncConfigFromForm();
        this.syncProviderPreset();
        this.updateConfigSummary();
      });
    }
    elements.modelSelect.addEventListener("change", () => this.selectModel(elements.modelSelect.value));
    elements.reasoningEffort.addEventListener("change", () => {
      this.syncConfigFromForm();
      this.updateConfigSummary();
    });
    elements.fetchModelsButton.addEventListener("click", () => void this.fetchModels());
    elements.testButton.addEventListener("click", () => void this.testConfig());
    elements.deleteButton.addEventListener("click", () => this.deleteSelectedProfile());
  }

  private saveConfig(): void {
    const { elements } = this;
    try {
      this.requireFetchedModel();
      const config = validateChatConfig({
        apiKey: elements.apiKey.value,
        baseUrl: elements.baseUrl.value,
        model: elements.modelSelect.value,
        reasoningEffort: elements.reasoningEffort.value,
      });
      const profile = createChatProfile({
        id: elements.profileSelect.value || undefined,
        name: this.profileState.profiles.find((candidate) => candidate.id === elements.profileSelect.value)?.name ?? config.model,
        ...config,
      });
      this.config = config;
      this.profileState = upsertChatProfile(this.profileState, profile);
      const persisted = this.persistProfiles();
      this.renderProfiles(profile.id);
      this.updateConfigSummary();
      if (persisted) {
        elements.configStatus.textContent = `${profile.name} is ready to use.`;
        elements.configStatus.className = "chat-config-status is-success";
      }
    } catch (error) {
      elements.configStatus.textContent = error instanceof Error ? error.message : "Check the provider settings.";
      elements.configStatus.className = "chat-config-status is-error";
    }
  }

  private loadProfiles(): void {
    const storage = profileStorage();
    try {
      this.profileState = parseChatProfileState(storage?.getItem(CHAT_PROFILE_STORAGE_KEY) ?? null);
    } catch {
      this.profileState = blankProfileState();
    }
    const active = this.profileState.profiles.find((profile) => profile.id === this.profileState.activeProfileId)
      ?? this.profileState.profiles[0];
    if (active) {
      this.config = {
        apiKey: active.apiKey,
        baseUrl: active.baseUrl,
        model: active.model,
        ...(active.reasoningEffort ? { reasoningEffort: active.reasoningEffort } : {}),
      };
    }
    this.renderProfiles(active?.id);
    this.updateConfigSummary();
  }

  private persistProfiles(): boolean {
    const storage = profileStorage();
    if (!storage) {
      this.elements.configStatus.textContent = "The model is ready for this tab, but browser storage is unavailable.";
      this.elements.configStatus.className = "chat-config-status is-error";
      return false;
    }
    try {
      storage.setItem(CHAT_PROFILE_STORAGE_KEY, serializeChatProfileState(this.profileState));
      return true;
    } catch {
      this.elements.configStatus.textContent = "The model is ready, but this browser could not save it.";
      this.elements.configStatus.className = "chat-config-status is-error";
      return false;
    }
  }

  private renderProfiles(selectedId?: string): void {
    const { elements } = this;
    const targetId = selectedId ?? this.profileState.activeProfileId ?? "";
    elements.profileSelect.replaceChildren();
    const newOption = document.createElement("option");
    newOption.value = "";
    newOption.textContent = "New model…";
    newOption.dataset.placeholder = "true";
    elements.profileSelect.append(newOption);
    for (const profile of this.profileState.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      elements.profileSelect.append(option);
    }
    elements.profileSelect.value = targetId;
    elements.deleteButton.disabled = !elements.profileSelect.value;
    const selected = this.profileState.profiles.find((profile) => profile.id === elements.profileSelect.value);
    if (selected) {
      elements.apiKey.value = selected.apiKey;
      elements.baseUrl.value = selected.baseUrl;
      this.config = {
        apiKey: selected.apiKey,
        baseUrl: selected.baseUrl,
        model: selected.model,
        ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
      };
      this.setModelCatalog([{
        id: selected.model,
        reasoningEfforts: selected.reasoningEffort ? [selected.reasoningEffort] : [],
      }], selected.baseUrl, selected.apiKey, selected.model, selected.reasoningEffort);
    } else {
      elements.apiKey.value = this.config.apiKey;
      elements.baseUrl.value = this.config.baseUrl;
      this.invalidateModels();
    }
    this.syncProviderPreset();
    this.resetApiKeyVisibility();
  }

  private selectProfile(id: string): void {
    if (!id) {
      this.config = { apiKey: "", ...DEFAULT_CHAT_CONFIG };
      this.renderProfiles("");
      this.invalidateModels();
      this.elements.configStatus.textContent = "New setup — choose a provider or enter custom details.";
      this.elements.configStatus.className = "chat-config-status";
      this.updateConfigSummary();
      return;
    }
    const profile = this.profileState.profiles.find((candidate) => candidate.id === id);
    if (!profile) return;
    this.config = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
      model: profile.model,
      ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}),
    };
    this.profileState = { ...this.profileState, activeProfileId: profile.id };
    const persisted = this.persistProfiles();
    this.renderProfiles(profile.id);
    this.updateConfigSummary();
    if (persisted) {
      this.elements.configStatus.textContent = `Using ${profile.name}.`;
      this.elements.configStatus.className = "chat-config-status is-success";
    }
  }

  private deleteSelectedProfile(): void {
    const id = this.elements.profileSelect.value;
    if (!id) return;
    const profile = this.profileState.profiles.find((candidate) => candidate.id === id);
    if (
      profile
      && typeof window !== "undefined"
      && typeof window.confirm === "function"
      && !window.confirm(`Remove “${profile.name}” from this browser?`)
    ) return;
    this.profileState = removeChatProfile(this.profileState, id);
    const persisted = this.persistProfiles();
    const active = this.profileState.profiles.find((candidate) => candidate.id === this.profileState.activeProfileId);
    this.config = active
      ? {
        apiKey: active.apiKey,
        baseUrl: active.baseUrl,
        model: active.model,
        ...(active.reasoningEffort ? { reasoningEffort: active.reasoningEffort } : {}),
      }
      : { apiKey: "", ...DEFAULT_CHAT_CONFIG };
    this.renderProfiles(this.profileState.activeProfileId ?? "");
    this.updateConfigSummary();
    if (persisted) {
      this.elements.configStatus.textContent = profile ? `Removed ${profile.name}.` : "Model removed.";
      this.elements.configStatus.className = "chat-config-status is-success";
    }
  }

  private startNewModel(): void {
    this.elements.profileSelect.value = "";
    this.selectProfile("");
    this.elements.apiKey.focus();
  }

  private applyProviderPreset(presetId: string): void {
    const preset = PROVIDER_PRESETS[presetId];
    if (!preset) return;
    const { elements } = this;
    elements.baseUrl.value = preset.baseUrl;
    if (preset.apiKey && !elements.apiKey.value.trim()) elements.apiKey.value = preset.apiKey;
    this.invalidateModels();
    this.syncConfigFromForm();
    this.updateConfigSummary();
    elements.configStatus.textContent = `${preset.label} defaults filled in. Fetch its available models to continue.`;
    elements.configStatus.className = "chat-config-status";
  }

  private syncConfigFromForm(): void {
    try {
      this.config = validateChatConfig({
        apiKey: this.elements.apiKey.value,
        baseUrl: this.elements.baseUrl.value,
        model: this.elements.modelSelect.value,
        reasoningEffort: this.elements.reasoningEffort.value,
      });
    } catch {
      // Keep the last usable config while the form is temporarily incomplete.
    }
  }

  private requireFetchedModel(): void {
    let credentials;
    try {
      credentials = validateChatCredentials({
        apiKey: this.elements.apiKey.value,
        baseUrl: this.elements.baseUrl.value,
      });
    } catch {
      throw new Error("Fetch the available models before choosing one.");
    }
    if (
      credentials.baseUrl !== this.modelsBaseUrl
      || credentials.apiKey !== this.modelsApiKey
      || !this.models.some((model) => model.id === this.elements.modelSelect.value)
    ) {
      throw new Error("Fetch the available models before choosing one.");
    }
  }

  private invalidateModels(clearFields = true): void {
    this.modelsController?.abort();
    this.models = [];
    this.modelsBaseUrl = "";
    this.modelsApiKey = "";
    if (clearFields) this.setModelCatalog([], "", "", "", "");
  }

  private setModelCatalog(
    models: ChatModel[],
    baseUrl: string,
    apiKey: string,
    selectedModel = "",
    selectedEffort = "",
  ): void {
    const { elements } = this;
    this.models = models;
    this.modelsBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    this.modelsApiKey = apiKey.trim();
    elements.modelSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = models.length > 0 ? "Choose a model…" : "Fetch models to choose one…";
    placeholder.dataset.placeholder = "true";
    elements.modelSelect.append(placeholder);
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.id;
      elements.modelSelect.append(option);
    }
    const chosen = models.some((model) => model.id === selectedModel)
      ? selectedModel
      : models[0]?.id ?? "";
    elements.modelSelect.value = chosen;
    elements.modelSelect.disabled = models.length === 0;
    this.populateReasoningEfforts(chosen, selectedEffort);
    if (models.length === 0) {
      elements.modelHelp.textContent = "Enter your credentials, then fetch the available models.";
    }
  }

  private populateReasoningEfforts(modelId: string, selectedEffort = ""): void {
    const { elements } = this;
    const model = this.models.find((candidate) => candidate.id === modelId);
    const efforts = model?.reasoningEfforts ?? [];
    elements.reasoningEffort.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default (provider controlled)";
    elements.reasoningEffort.append(defaultOption);
    for (const effort of efforts) {
      const option = document.createElement("option");
      option.value = effort;
      option.textContent = effort.charAt(0).toUpperCase() + effort.slice(1);
      elements.reasoningEffort.append(option);
    }
    elements.reasoningEffort.value = efforts.includes(selectedEffort) ? selectedEffort : "";
    elements.reasoningEffort.disabled = !modelId;
    elements.reasoningHelp.textContent = efforts.length > 0
      ? `Available for ${modelId}: ${efforts.join(", ")}.`
      : modelId
        ? "This model did not advertise reasoning levels; the provider default will be used."
        : "Choose a model to see its reasoning levels.";
  }

  private selectModel(modelId: string): void {
    const previousEffort = this.elements.reasoningEffort.value;
    this.populateReasoningEfforts(modelId, previousEffort);
    this.syncConfigFromForm();
    this.updateConfigSummary();
  }

  private async fetchModels(): Promise<void> {
    if (this.modelsController) return;
    const { elements } = this;
    let credentials;
    try {
      credentials = validateChatCredentials({ apiKey: elements.apiKey.value, baseUrl: elements.baseUrl.value });
    } catch (error) {
      elements.configStatus.textContent = error instanceof Error ? error.message : "Enter an API key and Base URL first.";
      elements.configStatus.className = "chat-config-status is-error";
      if (!elements.apiKey.value.trim()) elements.apiKey.focus();
      else elements.baseUrl.focus();
      return;
    }

    const controller = new AbortController();
    this.modelsController = controller;
    elements.fetchModelsButton.disabled = true;
    elements.fetchModelsLabel.textContent = "Fetching…";
    elements.configStatus.textContent = "Contacting the provider for its model list…";
    elements.configStatus.className = "chat-config-status";
    try {
      const models = await fetchChatModels(credentials, controller.signal);
      if (models.length === 0) throw new Error("The provider returned no usable models.");
      const priorModel = this.models.some((model) => model.id === this.config.model) ? this.config.model : "";
      this.setModelCatalog(models, credentials.baseUrl, credentials.apiKey, priorModel, this.config.reasoningEffort);
      this.syncConfigFromForm();
      const reasoningModels = models.filter((model) => model.reasoningEfforts.length > 0).length;
      elements.modelHelp.textContent = `${models.length} model${models.length === 1 ? "" : "s"} found${reasoningModels > 0 ? ` · ${reasoningModels} with reasoning controls` : ""}.`;
      elements.configStatus.textContent = "Models loaded. Choose a model and reasoning intensity, then save.";
      elements.configStatus.className = "chat-config-status is-success";
      this.updateConfigSummary();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        this.setModelCatalog([], "", "", "", "");
        elements.modelHelp.textContent = "Enter your credentials, then fetch the available models.";
        elements.configStatus.textContent = error instanceof Error ? error.message : "The model list could not be loaded.";
        elements.configStatus.className = "chat-config-status is-error";
      }
    } finally {
      if (this.modelsController === controller) {
        this.modelsController = null;
        elements.fetchModelsButton.disabled = false;
        elements.fetchModelsLabel.textContent = "Fetch models";
      }
    }
  }

  private syncProviderPreset(): void {
    const baseUrl = this.elements.baseUrl.value.trim().replace(/\/+$/, "");
    const match = Object.entries(PROVIDER_PRESETS).find(([, preset]) => preset.baseUrl === baseUrl);
    this.elements.providerPreset.value = match?.[0] ?? "custom";
  }

  private toggleApiKeyVisibility(): void {
    const visible = this.elements.apiKey.type === "text";
    this.elements.apiKey.type = visible ? "password" : "text";
    this.elements.apiKeyToggle.setAttribute("aria-label", visible ? "Show API key" : "Hide API key");
    this.elements.apiKeyToggle.title = visible ? "Show API key" : "Hide API key";
    this.elements.apiKeyToggle.classList.toggle("is-visible", !visible);
  }

  private resetApiKeyVisibility(): void {
    this.elements.apiKey.type = "password";
    this.elements.apiKeyToggle.setAttribute("aria-label", "Show API key");
    this.elements.apiKeyToggle.title = "Show API key";
    this.elements.apiKeyToggle.classList.remove("is-visible");
  }

  private updateConfigSummary(): void {
    const { elements } = this;
    const selected = this.profileState.profiles.find((profile) => profile.id === elements.profileSelect.value);
    const current = {
      apiKey: elements.apiKey.value.trim(),
      baseUrl: elements.baseUrl.value.trim().replace(/\/+$/, ""),
      model: elements.modelSelect.value.trim(),
      reasoningEffort: elements.reasoningEffort.value.trim(),
    };
    const hasConfig = this.isCurrentConfigValid();
    const matchesSelected = selected
      && selected.apiKey === current.apiKey
      && selected.baseUrl === current.baseUrl
      && selected.model === current.model;
    const selectedEffort = selected?.reasoningEffort ?? "";
    const sameEffort = selected && selectedEffort === current.reasoningEffort;
    elements.configSummary.textContent = matchesSelected
      && sameEffort
      ? `${selected.name} · ${selected.model}${selectedEffort ? ` · ${selectedEffort}` : ""}`
      : hasConfig
        ? `${current.model}${current.reasoningEffort ? ` · ${current.reasoningEffort}` : ""} · unsaved changes`
        : "Set up a model";
    elements.statusDot.classList.toggle("is-ready", hasConfig);
  }

  private isCurrentConfigValid(): boolean {
    try {
      validateChatConfig({
        apiKey: this.elements.apiKey.value,
        baseUrl: this.elements.baseUrl.value,
        model: this.elements.modelSelect.value,
        reasoningEffort: this.elements.reasoningEffort.value,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async testConfig(): Promise<void> {
    if (this.testController) return;
    const { elements } = this;
    let config: ChatConfig;
    try {
      this.requireFetchedModel();
      config = validateChatConfig({
        apiKey: elements.apiKey.value,
        baseUrl: elements.baseUrl.value,
        model: elements.modelSelect.value,
        reasoningEffort: elements.reasoningEffort.value,
      });
    } catch (error) {
      elements.configStatus.textContent = error instanceof Error ? error.message : "Check the provider settings.";
      elements.configStatus.className = "chat-config-status is-error";
      return;
    }

    const controller = new AbortController();
    this.testController = controller;
    this.config = config;
    elements.testButton.disabled = true;
    elements.testLabel.textContent = "Testing…";
    elements.configStatus.textContent = "Sending a small test request…";
    elements.configStatus.className = "chat-config-status";
    try {
      const answer = await testChatConnection(config, controller.signal);
      elements.configStatus.textContent = `Connection works — ${answer.slice(0, 120)}`;
      elements.configStatus.className = "chat-config-status is-success";
      this.updateConfigSummary();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        elements.configStatus.textContent = error instanceof Error ? error.message : "The connection test failed.";
        elements.configStatus.className = "chat-config-status is-error";
      }
    } finally {
      if (this.testController === controller) {
        this.testController = null;
        elements.testButton.disabled = false;
        elements.testLabel.textContent = "Test connection";
      }
    }
  }
}

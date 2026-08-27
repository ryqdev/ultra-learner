import {
  DEFAULT_CHAT_CONFIG,
  fetchChatModels,
  testChatConnection,
  requestChatCompletion,
  validateChatCredentials,
  validateChatConfig,
  type ChatConfig,
  type ChatModel,
  type ChatMessage,
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
import {
  selectionLabel,
  selectionPrompt,
  type SelectionContext,
} from "../lib/selection.ts";
import { requiredElement } from "./dom.ts";

interface ChatPanelElements {
  panel: HTMLElement;
  configForm: HTMLFormElement;
  configToggle: HTMLButtonElement;
  configSummary: HTMLElement;
  configToggleAction: HTMLElement;
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
  messageList: HTMLElement;
  emptyState: HTMLElement;
  selectionCard: HTMLElement;
  selectionLabel: HTMLElement;
  selectionText: HTMLElement;
  clearSelection: HTMLButtonElement;
  composer: HTMLFormElement;
  prompt: HTMLTextAreaElement;
  sendButton: HTMLButtonElement;
  composerHint: HTMLElement;
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

function createMessageElement(message: ChatMessage): HTMLElement {
  const article = document.createElement("article");
  article.className = `chat-message chat-message-${message.role}`;
  const role = document.createElement("span");
  role.className = "chat-message-role";
  role.textContent = message.role === "assistant" ? "Learner guide" : "You";
  const content = document.createElement("p");
  content.textContent = message.content;
  article.append(role, content);
  return article;
}

export class ChatPanelController {
  private readonly elements: ChatPanelElements;
  private readonly messages: ChatMessage[] = [];
  private config: ChatConfig = { apiKey: "", ...DEFAULT_CHAT_CONFIG };
  private profileState: ChatProfileState = blankProfileState();
  private models: ChatModel[] = [];
  private modelsBaseUrl = "";
  private modelsApiKey = "";
  private selection: SelectionContext | null = null;
  private requestController: AbortController | null = null;
  private testController: AbortController | null = null;
  private modelsController: AbortController | null = null;
  private configOpen = false;

  public constructor() {
    this.elements = {
      panel: requiredElement("chat-panel"),
      configForm: requiredElement<HTMLFormElement>("chat-config-form"),
      configToggle: requiredElement<HTMLButtonElement>("chat-config-toggle"),
      configSummary: requiredElement("chat-config-summary"),
      configToggleAction: requiredElement("chat-config-toggle-action"),
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
      messageList: requiredElement("chat-message-list"),
      emptyState: requiredElement("chat-empty-state"),
      selectionCard: requiredElement("chat-selection-card"),
      selectionLabel: requiredElement("chat-selection-label"),
      selectionText: requiredElement("chat-selection-text"),
      clearSelection: requiredElement<HTMLButtonElement>("chat-clear-selection"),
      composer: requiredElement<HTMLFormElement>("chat-composer"),
      prompt: requiredElement<HTMLTextAreaElement>("chat-prompt"),
      sendButton: requiredElement<HTMLButtonElement>("chat-send"),
      composerHint: requiredElement("chat-composer-hint"),
    };
    this.loadProfiles();
    this.bindEvents();
    this.renderMessages();
    this.updateConfigSummary();
    this.updateComposerHint();
  }

  public setSelection(selection: SelectionContext | null): void {
    this.selection = selection;
    const { elements } = this;
    if (!selection) {
      elements.selectionCard.hidden = true;
      this.updateComposerHint();
      return;
    }
    elements.selectionCard.hidden = false;
    elements.selectionLabel.textContent = selectionLabel(selection);
    elements.selectionText.textContent = selection.text;
    elements.composerHint.textContent = "This passage will be included with your next question.";
  }

  public clearSelection(): void {
    this.setSelection(null);
  }

  public resetConversation(): void {
    this.requestController?.abort();
    this.requestController = null;
    if (this.testController) {
      this.testController.abort();
      this.testController = null;
      this.elements.testButton.disabled = false;
      this.elements.testLabel.textContent = "Test connection";
    }
    if (this.modelsController) {
      this.modelsController.abort();
      this.modelsController = null;
      this.elements.fetchModelsButton.disabled = false;
      this.elements.fetchModelsLabel.textContent = "Fetch models";
    }
    this.messages.splice(0);
    this.elements.prompt.value = "";
    this.clearSelection();
    this.setBusy(false);
    this.renderMessages();
  }

  /** Start a blank conversation while keeping the provider configuration for this tab. */
  public startNewSession(): void {
    this.resetConversation();
    this.elements.prompt.focus();
  }

  public toggleVisibility(): void {
    this.elements.panel.classList.toggle("is-collapsed");
  }

  private bindEvents(): void {
    const { elements } = this;
    elements.configToggle.addEventListener("click", () => {
      this.configOpen = !this.configOpen;
      elements.configForm.hidden = !this.configOpen;
      elements.configToggle.setAttribute("aria-expanded", String(this.configOpen));
    });
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
        this.updateComposerHint();
      });
    }
    elements.modelSelect.addEventListener("change", () => this.selectModel(elements.modelSelect.value));
    elements.reasoningEffort.addEventListener("change", () => {
      this.syncConfigFromForm();
      this.updateConfigSummary();
      this.updateComposerHint();
    });
    elements.fetchModelsButton.addEventListener("click", () => void this.fetchModels());
    elements.testButton.addEventListener("click", () => void this.testConfig());
    elements.deleteButton.addEventListener("click", () => this.deleteSelectedProfile());
    elements.clearSelection.addEventListener("click", () => this.clearSelection());
    elements.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    elements.prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.send();
      }
    });
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
      this.updateComposerHint();
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
      this.updateComposerHint();
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
    this.updateComposerHint();
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
    this.updateComposerHint();
  }

  private updateComposerHint(): void {
    this.elements.composerHint.textContent = this.selection
      ? "This passage will be included with your next question."
      : this.isCurrentConfigValid()
        ? "Your document stays in this browser until you send a prompt."
        : "Add a provider key above to start chatting.";
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
    this.updateComposerHint();
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
    this.updateComposerHint();
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
      this.updateComposerHint();
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
        : "Set up a model to start";
    elements.configToggleAction.textContent = hasConfig ? "Edit" : "Set up";
    elements.statusDot.classList.toggle("is-ready", hasConfig);
    elements.statusDot.setAttribute("aria-label", hasConfig ? "Model ready" : "Model not configured");
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
      this.updateComposerHint();
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

  private async send(): Promise<void> {
    const prompt = this.elements.prompt.value.trim();
    if (!prompt || this.requestController) return;
    if (!this.isCurrentConfigValid()) {
      this.configOpen = true;
      this.elements.configForm.hidden = false;
      this.elements.configToggle.setAttribute("aria-expanded", "true");
      this.elements.configStatus.textContent = "Finish the model setup before sending a message.";
      this.elements.configStatus.className = "chat-config-status is-error";
      if (!this.elements.apiKey.value.trim()) this.elements.apiKey.focus();
      else if (!this.elements.baseUrl.value.trim()) this.elements.baseUrl.focus();
      else this.elements.modelSelect.focus();
      return;
    }
    this.syncConfigFromForm();

    const userContent = this.selection ? `${selectionPrompt(this.selection)}\n\nQuestion: ${prompt}` : prompt;
    const userMessage: ChatMessage = { role: "user", content: userContent };
    this.messages.push(userMessage);
    this.elements.prompt.value = "";
    this.renderMessages();
    this.setBusy(true);
    const requestController = new AbortController();
    this.requestController = requestController;

    try {
      const answer = await requestChatCompletion(
        this.config,
        this.messages,
        requestController.signal,
        fetch,
      );
      if (this.requestController === requestController) {
        this.messages.push({ role: "assistant", content: answer });
        this.renderMessages();
      }
    } catch (error) {
      if (this.requestController === requestController && !(error instanceof Error && error.name === "AbortError")) {
        const message = error instanceof Error ? error.message : "The model request could not be completed.";
        this.messages.push({ role: "assistant", content: `I couldn't reach the model: ${message}` });
        this.renderMessages();
      }
    } finally {
      if (this.requestController === requestController) {
        this.requestController = null;
        this.setBusy(false);
      }
    }
  }

  private setBusy(busy: boolean): void {
    this.elements.sendButton.disabled = busy;
    this.elements.prompt.disabled = busy;
    this.elements.sendButton.classList.toggle("is-loading", busy);
    this.elements.sendButton.textContent = busy ? "Thinking…" : "Send";
  }

  private renderMessages(): void {
    this.elements.emptyState.hidden = this.messages.length > 0;
    this.elements.messageList.querySelectorAll(".chat-message").forEach((message) => message.remove());
    const fragment = document.createDocumentFragment();
    for (const message of this.messages) fragment.append(createMessageElement(message));
    this.elements.messageList.append(fragment);
    this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
  }
}

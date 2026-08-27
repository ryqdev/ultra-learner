import {
  DEFAULT_CHAT_CONFIG,
  testChatConnection,
  requestChatCompletion,
  validateChatConfig,
  type ChatConfig,
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
  profileName: HTMLInputElement;
  providerPreset: HTMLSelectElement;
  apiKey: HTMLInputElement;
  apiKeyToggle: HTMLButtonElement;
  baseUrl: HTMLInputElement;
  model: HTMLInputElement;
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
  model: string;
  apiKey?: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2", apiKey: "ollama" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", apiKey: "lm-studio" },
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
  private selection: SelectionContext | null = null;
  private requestController: AbortController | null = null;
  private testController: AbortController | null = null;
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
      profileName: requiredElement<HTMLInputElement>("chat-profile-name"),
      providerPreset: requiredElement<HTMLSelectElement>("chat-provider-preset"),
      apiKey: requiredElement<HTMLInputElement>("chat-api-key"),
      apiKeyToggle: requiredElement<HTMLButtonElement>("chat-api-key-toggle"),
      baseUrl: requiredElement<HTMLInputElement>("chat-base-url"),
      model: requiredElement<HTMLInputElement>("chat-model"),
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
    for (const input of [elements.profileName, elements.apiKey, elements.baseUrl, elements.model]) {
      input.addEventListener("input", () => {
        this.syncConfigFromForm();
        this.syncProviderPreset();
        this.updateConfigSummary();
        this.updateComposerHint();
      });
    }
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
      const config = validateChatConfig({
        apiKey: elements.apiKey.value,
        baseUrl: elements.baseUrl.value,
        model: elements.model.value,
      });
      const profile = createChatProfile({
        id: elements.profileSelect.value || undefined,
        name: elements.profileName.value.trim() || config.model,
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
      this.config = { apiKey: active.apiKey, baseUrl: active.baseUrl, model: active.model };
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
      elements.profileName.value = selected.name;
      elements.apiKey.value = selected.apiKey;
      elements.baseUrl.value = selected.baseUrl;
      elements.model.value = selected.model;
    } else {
      elements.profileName.value = "";
      elements.apiKey.value = this.config.apiKey;
      elements.baseUrl.value = this.config.baseUrl;
      elements.model.value = this.config.model;
    }
    this.syncProviderPreset();
    this.resetApiKeyVisibility();
  }

  private selectProfile(id: string): void {
    if (!id) {
      this.config = { apiKey: "", ...DEFAULT_CHAT_CONFIG };
      this.renderProfiles("");
      this.elements.configStatus.textContent = "New setup — choose a provider or enter custom details.";
      this.elements.configStatus.className = "chat-config-status";
      this.updateConfigSummary();
      this.updateComposerHint();
      return;
    }
    const profile = this.profileState.profiles.find((candidate) => candidate.id === id);
    if (!profile) return;
    this.config = { apiKey: profile.apiKey, baseUrl: profile.baseUrl, model: profile.model };
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
      ? { apiKey: active.apiKey, baseUrl: active.baseUrl, model: active.model }
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
    this.elements.profileName.focus();
  }

  private applyProviderPreset(presetId: string): void {
    const preset = PROVIDER_PRESETS[presetId];
    if (!preset) return;
    const { elements } = this;
    elements.baseUrl.value = preset.baseUrl;
    elements.model.value = preset.model;
    if (preset.apiKey && !elements.apiKey.value.trim()) elements.apiKey.value = preset.apiKey;
    if (!elements.profileName.value.trim()) elements.profileName.value = preset.label;
    this.syncConfigFromForm();
    this.updateConfigSummary();
    this.updateComposerHint();
    elements.configStatus.textContent = `${preset.label} defaults filled in. Check the model ID, then test the connection.`;
    elements.configStatus.className = "chat-config-status";
  }

  private syncConfigFromForm(): void {
    try {
      this.config = validateChatConfig({
        apiKey: this.elements.apiKey.value,
        baseUrl: this.elements.baseUrl.value,
        model: this.elements.model.value,
      });
    } catch {
      // Keep the last usable config while the form is temporarily incomplete.
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
      model: elements.model.value.trim(),
    };
    const hasConfig = this.isCurrentConfigValid();
    const matchesSelected = selected
      && selected.name === elements.profileName.value.trim()
      && selected.apiKey === current.apiKey
      && selected.baseUrl === current.baseUrl
      && selected.model === current.model;
    elements.configSummary.textContent = matchesSelected
      ? `${selected.name} · ${selected.model}`
      : hasConfig
        ? `${current.model} · unsaved changes`
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
        model: this.elements.model.value,
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
      config = validateChatConfig({
        apiKey: elements.apiKey.value,
        baseUrl: elements.baseUrl.value,
        model: elements.model.value,
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
      else this.elements.model.focus();
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

import {
  DEFAULT_CHAT_CONFIG,
  requestChatCompletion,
  validateChatConfig,
  type ChatConfig,
  type ChatMessage,
} from "../lib/chat.ts";
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
  apiKey: HTMLInputElement;
  baseUrl: HTMLInputElement;
  model: HTMLInputElement;
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
  private selection: SelectionContext | null = null;
  private requestController: AbortController | null = null;
  private configOpen = false;

  public constructor() {
    this.elements = {
      panel: requiredElement("chat-panel"),
      configForm: requiredElement<HTMLFormElement>("chat-config-form"),
      configToggle: requiredElement<HTMLButtonElement>("chat-config-toggle"),
      apiKey: requiredElement<HTMLInputElement>("chat-api-key"),
      baseUrl: requiredElement<HTMLInputElement>("chat-base-url"),
      model: requiredElement<HTMLInputElement>("chat-model"),
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
    this.elements.baseUrl.value = this.config.baseUrl;
    this.elements.model.value = this.config.model;
    this.bindEvents();
    this.renderMessages();
  }

  public setSelection(selection: SelectionContext | null): void {
    this.selection = selection;
    const { elements } = this;
    if (!selection) {
      elements.selectionCard.hidden = true;
      elements.composerHint.textContent = this.config.apiKey
        ? "Your document stays in this browser until you send a prompt."
        : "Add a provider key above to start chatting.";
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
      this.config = validateChatConfig({
        apiKey: elements.apiKey.value,
        baseUrl: elements.baseUrl.value,
        model: elements.model.value,
      });
      elements.configStatus.textContent = "Saved for this tab only.";
      elements.configStatus.className = "chat-config-status is-success";
      elements.composerHint.textContent = this.selection
        ? "This passage will be included with your next question."
        : "Your document stays in this browser until you send a prompt.";
    } catch (error) {
      elements.configStatus.textContent = error instanceof Error ? error.message : "Check the provider settings.";
      elements.configStatus.className = "chat-config-status is-error";
    }
  }

  private async send(): Promise<void> {
    const prompt = this.elements.prompt.value.trim();
    if (!prompt || this.requestController) return;
    if (!this.config.apiKey) {
      this.configOpen = true;
      this.elements.configForm.hidden = false;
      this.elements.configToggle.setAttribute("aria-expanded", "true");
      this.elements.configStatus.textContent = "Add an API key before sending a message.";
      this.elements.configStatus.className = "chat-config-status is-error";
      this.elements.apiKey.focus();
      return;
    }

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

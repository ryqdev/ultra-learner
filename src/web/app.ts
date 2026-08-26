import { createSamplePdf } from "./sample.ts";
import { ChatPanelController } from "./chat-panel.ts";
import { requiredElement } from "./dom.ts";
import { PdfReaderController } from "./pdf-reader.ts";
import {
  listSessions,
  loadSessionPdf,
  saveSession,
  sessionMeta,
} from "./session-history.ts";
import {
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  MIN_READER_MAIN_WIDTH,
  clampChatPanelWidth,
} from "../lib/layout.ts";
import { readerKeyboardAction } from "../lib/reader.ts";
import type { SelectionSource } from "../lib/selection.ts";
import type { SessionSummary } from "../lib/sessions.ts";

const appShell = requiredElement("app-shell");
const welcomeView = requiredElement("welcome-view");
const readerView = requiredElement("reader-view");
const siteFooter = requiredElement("site-footer");
const dropZone = requiredElement("drop-zone");
const fileInput = requiredElement<HTMLInputElement>("file-input");
const chooseButton = requiredElement<HTMLButtonElement>("choose-button");
const sampleButton = requiredElement<HTMLButtonElement>("sample-button");
const newSessionButton = requiredElement<HTMLButtonElement>("new-session-button");
const newFileButton = requiredElement<HTMLButtonElement>("new-file-button");
const errorChooseButton = requiredElement<HTMLButtonElement>("error-choose-button");
const themeButton = requiredElement<HTMLButtonElement>("theme-button");
const sidebarToggle = requiredElement<HTMLButtonElement>("sidebar-toggle");
const sidebarClose = requiredElement<HTMLButtonElement>("sidebar-close");
const chatToggle = requiredElement<HTMLButtonElement>("chat-toggle");
const chatCollapse = requiredElement<HTMLButtonElement>("chat-collapse");
const chatPanel = requiredElement("chat-panel");
const chatResizeHandle = requiredElement("chat-resize-handle");
const readerMain = requiredElement("reader-main");
const textSelectMode = requiredElement<HTMLButtonElement>("text-select-mode");
const boxSelectMode = requiredElement<HTMLButtonElement>("box-select-mode");
const toast = requiredElement("toast");
const historyList = requiredElement("history-list");
const historyStatus = requiredElement("history-status");
const historyCount = requiredElement("history-count");

readerView.style.setProperty("--chat-panel-min-width", `${MIN_CHAT_PANEL_WIDTH}px`);
readerView.style.setProperty("--chat-panel-width", `${DEFAULT_CHAT_PANEL_WIDTH}px`);
readerView.style.setProperty("--reader-main-min-width", `${MIN_READER_MAIN_WIDTH}px`);
chatResizeHandle.setAttribute("aria-valuemin", String(MIN_CHAT_PANEL_WIDTH));
chatResizeHandle.setAttribute("aria-valuemax", String(MAX_CHAT_PANEL_WIDTH));
chatResizeHandle.setAttribute("aria-valuenow", String(DEFAULT_CHAT_PANEL_WIDTH));

let toastTimer: number | undefined;
let chatResizePointerId: number | null = null;
let chatResizeStart: { pointerX: number; panelWidth: number } | null = null;
let sessions: SessionSummary[] = [];
let openingSessionId: string | null = null;

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

const chat = new ChatPanelController();
const reader = new PdfReaderController(
  {
    readerView,
    readerStage: requiredElement("reader-stage"),
    readerLoading: requiredElement("reader-loading"),
    loadingDetail: requiredElement("loading-detail"),
    readerError: requiredElement("reader-error"),
    errorMessage: requiredElement("error-message"),
    canvasFrame: requiredElement("canvas-frame"),
    pageSurface: requiredElement("page-surface"),
    canvas: requiredElement<HTMLCanvasElement>("pdf-canvas"),
    textLayer: requiredElement("text-layer"),
    boxSelection: requiredElement("box-selection"),
    thumbnailList: requiredElement("thumbnail-list"),
    documentTitle: requiredElement("document-title"),
    documentMeta: requiredElement("document-meta"),
    pageInput: requiredElement<HTMLInputElement>("page-input"),
    pageCount: requiredElement("page-count"),
    previousPage: requiredElement<HTMLButtonElement>("previous-page"),
    nextPage: requiredElement<HTMLButtonElement>("next-page"),
    zoomOut: requiredElement<HTMLButtonElement>("zoom-out"),
    zoomIn: requiredElement<HTMLButtonElement>("zoom-in"),
    zoomValue: requiredElement("zoom-value"),
    fitButton: requiredElement<HTMLButtonElement>("fit-button"),
    progressLabel: requiredElement("progress-label"),
    progressBar: requiredElement("progress-bar"),
  },
  {
    onFileAccepted: showReader,
    onSelection: (selection) => chat.setSelection(selection),
    onToast: showToast,
  },
);

function showWelcome(): void {
  reader.reset();
  fileInput.value = "";
  appShell.classList.remove("is-reading");
  welcomeView.hidden = false;
  readerView.hidden = true;
  siteFooter.hidden = false;
  document.title = "Ultra Learner — PDF Reader";
  void refreshHistory();
}

function historyItem(session: SessionSummary): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-item";
  button.dataset.sessionId = session.id;
  button.disabled = openingSessionId !== null;
  button.setAttribute("aria-label", `Open ${session.filename}`);

  const icon = document.createElement("span");
  icon.className = "history-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5v-15Z"/><path d="M12 2.5v3h3M7.5 10h5m-5 3h4"/></svg>';

  const copy = document.createElement("span");
  copy.className = "history-item-copy";
  const filename = document.createElement("strong");
  filename.textContent = session.filename;
  const metadata = document.createElement("span");
  metadata.textContent = openingSessionId === session.id ? "Opening local session…" : sessionMeta(session);
  copy.append(filename, metadata);

  const arrow = document.createElement("span");
  arrow.className = "history-item-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  button.append(icon, copy, arrow);
  return button;
}

function renderHistory(): void {
  historyList.replaceChildren(...sessions.map(historyItem));
  historyCount.hidden = sessions.length === 0;
  historyCount.textContent = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  if (sessions.length === 0) {
    historyStatus.textContent = "Your uploaded PDFs will appear here.";
    historyStatus.hidden = false;
  } else {
    historyStatus.hidden = true;
  }
}

async function refreshHistory(): Promise<void> {
  historyStatus.classList.remove("is-error");
  if (sessions.length === 0) {
    historyStatus.textContent = "Loading previous sessions…";
    historyStatus.hidden = false;
  }
  try {
    sessions = await listSessions();
    renderHistory();
  } catch (error) {
    historyList.replaceChildren();
    historyCount.hidden = true;
    historyStatus.hidden = false;
    historyStatus.classList.add("is-error");
    historyStatus.textContent = error instanceof Error ? error.message : "Unable to load your PDF history.";
  }
}

async function openSession(session: SessionSummary): Promise<void> {
  if (openingSessionId) return;
  openingSessionId = session.id;
  renderHistory();
  try {
    const data = await loadSessionPdf(session);
    showReader();
    await reader.loadPdf(data, session.filename, session.fileSize);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to open this PDF session.");
    await refreshHistory();
  } finally {
    openingSessionId = null;
    if (!welcomeView.hidden) renderHistory();
  }
}

historyList.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-session-id]")
    : null;
  if (!target) return;
  const session = sessions.find((candidate) => candidate.id === target.dataset.sessionId);
  if (session) void openSession(session);
});

async function openUploadedFile(file: File): Promise<void> {
  await reader.openFile(file, {
    persist: async (data) => {
      const session = await saveSession(file, data);
      sessions = [session, ...sessions];
      showToast("PDF saved to your local history.");
      return "Saved locally";
    },
  });
}

function showReader(): void {
  chat.resetConversation();
  appShell.classList.add("is-reading");
  welcomeView.hidden = true;
  readerView.hidden = false;
  siteFooter.hidden = true;
  reader.showReader();
  window.requestAnimationFrame(fitChatPanelWidth);
}

function startNewSession(): void {
  if (!reader.documentLoaded) return;
  setChatCollapsed(false);
  chat.startNewSession();
  showToast("Started a new conversation for this PDF.");
}

function chooseFile(): void {
  fileInput.value = "";
  fileInput.click();
}

async function openSample(): Promise<void> {
  showReader();
  const sample = createSamplePdf();
  await reader.loadPdf(sample, "The Shape of Attention.pdf", sample.byteLength);
}

chooseButton.addEventListener("click", chooseFile);
newFileButton.addEventListener("click", chooseFile);
errorChooseButton.addEventListener("click", chooseFile);
sampleButton.addEventListener("click", () => void openSample());
newSessionButton.addEventListener("click", startNewSession);
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    void openUploadedFile(file);
  }
});

for (const eventName of ["dragenter", "dragover"] as const) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"] as const) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files[0];
  if (file) {
    void openUploadedFile(file);
  }
});

function refreshReaderLayout(): void {
  window.requestAnimationFrame(() => {
    fitChatPanelWidth();
    reader.refreshLayout();
  });
}

sidebarToggle.addEventListener("click", () => {
  reader.toggleSidebar();
  refreshReaderLayout();
});
sidebarClose.addEventListener("click", () => {
  reader.closeSidebar();
  refreshReaderLayout();
});

function availableChatPanelWidth(): number {
  const readerBounds = readerView.getBoundingClientRect();
  const mainBounds = readerMain.getBoundingClientRect();
  return Math.max(0, readerBounds.right - mainBounds.left);
}

function syncChatResizeHandle(): void {
  if (readerView.hidden || chatPanel.classList.contains("is-collapsed")) return;
  const width = Math.round(chatPanel.getBoundingClientRect().width);
  const maximum = clampChatPanelWidth(MAX_CHAT_PANEL_WIDTH, availableChatPanelWidth());
  chatResizeHandle.setAttribute("aria-valuemin", String(MIN_CHAT_PANEL_WIDTH));
  chatResizeHandle.setAttribute("aria-valuemax", String(maximum));
  chatResizeHandle.setAttribute("aria-valuenow", String(width));
  chatResizeHandle.setAttribute("aria-valuetext", `${width} pixels wide`);
}

function setChatPanelWidth(requestedWidth: number): void {
  const width = clampChatPanelWidth(requestedWidth, availableChatPanelWidth());
  readerView.style.setProperty("--chat-panel-width", `${width}px`);
  syncChatResizeHandle();
}

function fitChatPanelWidth(): void {
  if (window.matchMedia("(max-width: 760px)").matches || chatPanel.classList.contains("is-collapsed")) return;
  const configuredWidth = Number.parseFloat(readerView.style.getPropertyValue("--chat-panel-width"));
  setChatPanelWidth(configuredWidth);
}

function finishChatResize(pointerId: number): void {
  if (chatResizePointerId !== pointerId) return;
  chatResizePointerId = null;
  chatResizeStart = null;
  if (chatResizeHandle.hasPointerCapture(pointerId)) chatResizeHandle.releasePointerCapture(pointerId);
  chatResizeHandle.classList.remove("is-dragging");
  document.body.classList.remove("is-resizing-chat");
  reader.refreshLayout();
}

chatResizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary || window.matchMedia("(max-width: 760px)").matches) return;
  event.preventDefault();
  chatResizePointerId = event.pointerId;
  chatResizeStart = {
    pointerX: event.clientX,
    panelWidth: chatPanel.getBoundingClientRect().width,
  };
  chatResizeHandle.setPointerCapture(event.pointerId);
  chatResizeHandle.classList.add("is-dragging");
  document.body.classList.add("is-resizing-chat");
});

chatResizeHandle.addEventListener("pointermove", (event) => {
  if (chatResizePointerId !== event.pointerId || !chatResizeStart) return;
  event.preventDefault();
  setChatPanelWidth(chatResizeStart.panelWidth + chatResizeStart.pointerX - event.clientX);
});

chatResizeHandle.addEventListener("pointerup", (event) => finishChatResize(event.pointerId));
chatResizeHandle.addEventListener("pointercancel", (event) => finishChatResize(event.pointerId));
chatResizeHandle.addEventListener("lostpointercapture", (event) => finishChatResize(event.pointerId));
chatResizeHandle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const currentWidth = chatPanel.getBoundingClientRect().width || DEFAULT_CHAT_PANEL_WIDTH;
  const step = event.shiftKey ? 48 : 16;
  setChatPanelWidth(currentWidth + (event.key === "ArrowLeft" ? step : -step));
  reader.refreshLayout();
});

function setChatCollapsed(collapsed: boolean): void {
  chatPanel.classList.toggle("is-collapsed", collapsed);
  readerView.classList.toggle("chat-collapsed", collapsed);
  chatToggle.setAttribute("aria-expanded", String(!collapsed));
  refreshReaderLayout();
}

chatToggle.addEventListener("click", () => setChatCollapsed(false));
chatCollapse.addEventListener("click", () => setChatCollapsed(true));

function setSelectionMode(mode: SelectionSource): void {
  reader.setSelectionMode(mode);
  const isText = mode === "text";
  textSelectMode.classList.toggle("is-active", isText);
  boxSelectMode.classList.toggle("is-active", !isText);
  textSelectMode.setAttribute("aria-pressed", String(isText));
  boxSelectMode.setAttribute("aria-pressed", String(!isText));
}

textSelectMode.addEventListener("click", () => setSelectionMode("text"));
boxSelectMode.addEventListener("click", () => setSelectionMode("box"));

themeButton.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("is-dark");
  themeButton.setAttribute("aria-pressed", String(isDark));
});

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

window.addEventListener("keydown", (event) => {
  if (!reader.documentLoaded || isEditableTarget(event.target)) return;
  const action = readerKeyboardAction(event.key, event);
  if (action === "close-sidebar") {
    reader.closeSidebar();
    refreshReaderLayout();
    return;
  }
  if (!action) return;
  event.preventDefault();
  reader.vimNavigate(action);
});

window.addEventListener("resize", () => window.requestAnimationFrame(fitChatPanelWidth));

window.addEventListener("beforeunload", () => reader.destroy());

showWelcome();

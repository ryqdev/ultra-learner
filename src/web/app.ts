import { createSamplePdf } from "./sample.ts";
import { ChatPanelController } from "./chat-panel.ts";
import { requiredElement } from "./dom.ts";
import { PdfReaderController } from "./pdf-reader.ts";
import {
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  MIN_READER_MAIN_WIDTH,
  clampChatPanelWidth,
} from "../lib/layout.ts";
import { readerKeyboardAction } from "../lib/reader.ts";
import type { SelectionSource } from "../lib/selection.ts";

const appShell = requiredElement("app-shell");
const welcomeView = requiredElement("welcome-view");
const readerView = requiredElement("reader-view");
const siteFooter = requiredElement("site-footer");
const dropZone = requiredElement("drop-zone");
const fileInput = requiredElement<HTMLInputElement>("file-input");
const chooseButton = requiredElement<HTMLButtonElement>("choose-button");
const sampleButton = requiredElement<HTMLButtonElement>("sample-button");
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

readerView.style.setProperty("--chat-panel-min-width", `${MIN_CHAT_PANEL_WIDTH}px`);
readerView.style.setProperty("--chat-panel-width", `${DEFAULT_CHAT_PANEL_WIDTH}px`);
readerView.style.setProperty("--reader-main-min-width", `${MIN_READER_MAIN_WIDTH}px`);
chatResizeHandle.setAttribute("aria-valuemin", String(MIN_CHAT_PANEL_WIDTH));
chatResizeHandle.setAttribute("aria-valuemax", String(MAX_CHAT_PANEL_WIDTH));
chatResizeHandle.setAttribute("aria-valuenow", String(DEFAULT_CHAT_PANEL_WIDTH));

let toastTimer: number | undefined;
let chatResizePointerId: number | null = null;
let chatResizeStart: { pointerX: number; panelWidth: number } | null = null;

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
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    void reader.openFile(file);
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
    void reader.openFile(file);
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

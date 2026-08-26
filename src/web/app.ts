import { createSamplePdf } from "./sample.ts";
import { ChatPanelController } from "./chat-panel.ts";
import { requiredElement } from "./dom.ts";
import { PdfReaderController } from "./pdf-reader.ts";
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
const textSelectMode = requiredElement<HTMLButtonElement>("text-select-mode");
const boxSelectMode = requiredElement<HTMLButtonElement>("box-select-mode");
const toast = requiredElement("toast");

let toastTimer: number | undefined;

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

sidebarToggle.addEventListener("click", () => reader.toggleSidebar());
sidebarClose.addEventListener("click", () => reader.closeSidebar());
function setChatCollapsed(collapsed: boolean): void {
  chatPanel.classList.toggle("is-collapsed", collapsed);
  readerView.classList.toggle("chat-collapsed", collapsed);
  chatToggle.setAttribute("aria-expanded", String(!collapsed));
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
  if (!reader.documentLoaded || isEditableTarget(event.target) || event.altKey) return;
  if (event.key === "Escape") {
    reader.closeSidebar();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) {
    event.preventDefault();
    void reader.changeZoom(1);
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "-") {
    event.preventDefault();
    void reader.changeZoom(-1);
    return;
  }
  if (event.metaKey || event.ctrlKey) return;
  if (event.key === "j" || event.key === "k" || event.key === "d" || event.key === "u") {
    event.preventDefault();
    reader.vimNavigate(event.key);
  }
});

window.addEventListener("beforeunload", () => reader.destroy());

showWelcome();

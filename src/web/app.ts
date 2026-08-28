import { ChatPanelController } from "./chat-panel.ts";
import { requiredElement } from "./dom.ts";
import { PdfReaderController } from "./pdf-reader.ts";
import { configureSessionDeleteDialog } from "./session-delete-dialog.ts";
import {
  deleteSession,
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
const appSidebar = requiredElement("app-sidebar");
const appSidebarCollapse = requiredElement<HTMLButtonElement>("app-sidebar-collapse");
const appSidebarToggle = requiredElement<HTMLButtonElement>("app-sidebar-toggle");
const appSidebarBackdrop = requiredElement("app-sidebar-backdrop");
const sidebarNewChat = requiredElement<HTMLButtonElement>("sidebar-new-chat");
const sidebarLibrary = requiredElement<HTMLButtonElement>("sidebar-library");
const sidebarRefresh = requiredElement<HTMLButtonElement>("sidebar-refresh");
const topbarTitle = requiredElement("topbar-title");
const welcomeView = requiredElement("welcome-view");
const readerView = requiredElement("reader-view");
const dropZone = requiredElement("drop-zone");
const fileInput = requiredElement<HTMLInputElement>("file-input");
const chooseButton = requiredElement<HTMLButtonElement>("choose-button");
const errorChooseButton = requiredElement<HTMLButtonElement>("error-choose-button");
const themeButton = requiredElement<HTMLButtonElement>("theme-button");
const sidebarToggle = requiredElement<HTMLButtonElement>("sidebar-toggle");
const sidebarClose = requiredElement<HTMLButtonElement>("sidebar-close");
const readerLibrary = requiredElement<HTMLButtonElement>("reader-library");
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
const sessionDeleteDialog = requiredElement<HTMLDialogElement>("session-delete-dialog");
const sessionDeleteFilename = requiredElement("session-delete-filename");
const sessionDeleteCancel = requiredElement<HTMLButtonElement>("session-delete-cancel");
const sessionDeleteConfirm = requiredElement<HTMLButtonElement>("session-delete-confirm");

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
let deletingSessionId: string | null = null;
let activeSessionId: string | null = null;

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function isCompactSidebar(): boolean {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setMobileSidebarOpen(open: boolean): void {
  const compact = isCompactSidebar();
  const shouldOpen = open && compact;
  if (compact) appShell.classList.remove("sidebar-collapsed");
  appShell.classList.toggle("sidebar-open", shouldOpen);
  appSidebarToggle.setAttribute("aria-expanded", String(shouldOpen));
  appSidebarToggle.setAttribute("aria-label", shouldOpen ? "Close workspace navigation" : "Open workspace navigation");
  appSidebarToggle.title = shouldOpen ? "Close workspace navigation" : "Open workspace navigation";
  appSidebarBackdrop.hidden = !shouldOpen;
  appSidebar.inert = compact && !shouldOpen;
  if (compact) {
    appSidebar.setAttribute("aria-hidden", String(!shouldOpen));
  } else {
    appSidebar.removeAttribute("aria-hidden");
  }
  document.body.classList.toggle("sidebar-drawer-open", shouldOpen);
}

function setSidebarCollapsed(collapsed: boolean): void {
  if (isCompactSidebar()) {
    setMobileSidebarOpen(!collapsed);
    return;
  }
  appShell.classList.toggle("sidebar-collapsed", collapsed);
  appSidebarCollapse.setAttribute("aria-expanded", String(!collapsed));
  appSidebarCollapse.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
  appSidebarCollapse.title = collapsed ? "Expand navigation" : "Collapse navigation";
}

function setTopbarTitle(title: string): void {
  topbarTitle.textContent = title;
}

function setLibraryActive(active: boolean): void {
  sidebarLibrary.classList.toggle("is-active", active);
  if (active) {
    sidebarLibrary.setAttribute("aria-current", "page");
  } else {
    sidebarLibrary.removeAttribute("aria-current");
  }
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
    textLayer: requiredElement<HTMLDivElement>("text-layer"),
    annotationLayer: requiredElement<HTMLDivElement>("annotation-layer"),
    boxSelection: requiredElement("box-selection"),
    thumbnailList: requiredElement("thumbnail-list"),
    documentTitle: requiredElement("document-title"),
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
  activeSessionId = null;
  appShell.classList.remove("is-reading");
  welcomeView.hidden = false;
  readerView.hidden = true;
  setMobileSidebarOpen(false);
  setLibraryActive(true);
  setTopbarTitle("");
  document.title = "Ultra Learner — PDF Reader";
  void refreshHistory();
}

function historyItem(session: SessionSummary): HTMLElement {
  const item = document.createElement("div");
  item.className = "history-item";
  if (openingSessionId !== null || deletingSessionId !== null) item.classList.add("is-busy");
  if (activeSessionId === session.id) {
    item.classList.add("is-active");
  }

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "history-item-open";
  openButton.dataset.sessionOpen = session.id;
  openButton.disabled = openingSessionId !== null || deletingSessionId !== null;
  openButton.setAttribute("aria-label", `Open ${session.filename}`);
  if (activeSessionId === session.id) openButton.setAttribute("aria-current", "page");

  const icon = document.createElement("span");
  icon.className = "history-item-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5v-15Z"/><path d="M12 2.5v3h3M7.5 10h5m-5 3h4"/></svg>';

  const copy = document.createElement("span");
  copy.className = "history-item-copy";
  const filename = document.createElement("strong");
  filename.textContent = session.filename;
  const metadata = document.createElement("span");
  metadata.textContent = openingSessionId === session.id
    ? "Opening local session…"
    : deletingSessionId === session.id
      ? "Deleting local session…"
      : sessionMeta(session);
  copy.append(filename, metadata);

  const arrow = document.createElement("span");
  arrow.className = "history-item-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  openButton.append(icon, copy, arrow);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "history-item-delete";
  deleteButton.dataset.sessionDelete = session.id;
  deleteButton.disabled = openingSessionId !== null || deletingSessionId !== null;
  deleteButton.setAttribute("aria-label", `Delete ${session.filename}`);
  deleteButton.title = `Delete ${session.filename}`;
  deleteButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11m-7.5 3v5m4-5v5M6 6l.7 10h6.6L14 6M8 6V3.8h4V6"/></svg>';

  item.append(openButton, deleteButton);
  return item;
}

function renderHistory(): void {
  historyList.replaceChildren(...sessions.map(historyItem));
  historyCount.hidden = sessions.length === 0;
  historyCount.textContent = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  historyStatus.textContent = "";
  historyStatus.hidden = true;
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
  if (openingSessionId || deletingSessionId) return;
  openingSessionId = session.id;
  renderHistory();
  try {
    const data = await loadSessionPdf(session);
    showReader(session.filename);
    const loaded = await reader.loadPdf(data, session.filename);
    if (loaded) {
      activeSessionId = session.id;
      setTopbarTitle(session.filename);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to open this PDF session.");
    await refreshHistory();
  } finally {
    openingSessionId = null;
    renderHistory();
  }
}

async function removeSession(session: SessionSummary): Promise<void> {
  if (openingSessionId || deletingSessionId) return;
  deletingSessionId = session.id;
  renderHistory();
  try {
    await deleteSession(session);
    sessions = sessions.filter((candidate) => candidate.id !== session.id);
    if (activeSessionId === session.id) {
      showWelcome();
    } else {
      renderHistory();
    }
    showToast(`Deleted ${session.filename} from local history.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to delete this PDF session.");
    await refreshHistory();
  } finally {
    deletingSessionId = null;
    renderHistory();
  }
}

const openSessionDeleteDialog = configureSessionDeleteDialog({
  dialog: sessionDeleteDialog,
  filename: sessionDeleteFilename,
  cancelButton: sessionDeleteCancel,
  confirmButton: sessionDeleteConfirm,
}, (session) => void removeSession(session));

function requestSessionDeletion(session: SessionSummary): void {
  if (openingSessionId || deletingSessionId) return;
  openSessionDeleteDialog(session);
}

sessionDeleteDialog.addEventListener("click", (event) => {
  if (event.target === sessionDeleteDialog) sessionDeleteDialog.close("cancel");
});

historyList.addEventListener("click", (event) => {
  const element = event.target instanceof Element ? event.target : null;
  const deleteTarget = element?.closest<HTMLButtonElement>("[data-session-delete]");
  if (deleteTarget) {
    const session = sessions.find((candidate) => candidate.id === deleteTarget.dataset.sessionDelete);
    if (session) requestSessionDeletion(session);
    return;
  }

  const target = element?.closest<HTMLButtonElement>("[data-session-open]");
  if (!target) return;
  const session = sessions.find((candidate) => candidate.id === target.dataset.sessionOpen);
  if (session) {
    setMobileSidebarOpen(false);
    void openSession(session);
  }
});

async function openUploadedFile(file: File): Promise<void> {
  activeSessionId = null;
  setTopbarTitle(file.name);
  renderHistory();
  await reader.openFile(file, {
    persist: async (data) => {
      const session = await saveSession(file, data);
      sessions = [session, ...sessions];
      activeSessionId = session.id;
      setTopbarTitle(session.filename);
      renderHistory();
      showToast("PDF saved to your local history.");
    },
  });
}

function showReader(title = "Reading"): void {
  chat.resetConversation();
  appShell.classList.add("is-reading");
  welcomeView.hidden = true;
  readerView.hidden = false;
  setMobileSidebarOpen(false);
  setLibraryActive(false);
  setTopbarTitle(title);
  reader.showReader();
  window.requestAnimationFrame(fitChatPanelWidth);
}

function startNewSession(): void {
  if (!reader.documentLoaded) {
    showWelcome();
    showToast("Choose a PDF to start a new chat.");
    window.requestAnimationFrame(() => chooseButton.focus());
    return;
  }
  setChatCollapsed(false);
  chat.startNewSession();
  setTopbarTitle("New chat");
  showToast("Started a new conversation for this PDF.");
}

function chooseFile(): void {
  fileInput.value = "";
  fileInput.click();
}

chooseButton.addEventListener("click", chooseFile);
errorChooseButton.addEventListener("click", chooseFile);
sidebarNewChat.addEventListener("click", () => {
  setMobileSidebarOpen(false);
  startNewSession();
});
sidebarLibrary.addEventListener("click", () => showWelcome());
sidebarRefresh.addEventListener("click", () => void refreshHistory());
appSidebarCollapse.addEventListener("click", () => {
  const collapsed = appShell.classList.contains("sidebar-collapsed");
  setSidebarCollapsed(!collapsed);
  window.setTimeout(refreshReaderLayout, 200);
});
appSidebarToggle.addEventListener("click", () => {
  const open = appShell.classList.contains("sidebar-open");
  setMobileSidebarOpen(!open);
});
appSidebarBackdrop.addEventListener("click", () => setMobileSidebarOpen(false));
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
readerLibrary.addEventListener("click", () => showWelcome());

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
  const label = collapsed ? "Open AI guide" : "Close AI guide";
  chatToggle.setAttribute("aria-label", label);
  chatToggle.title = label;
  refreshReaderLayout();
}

chatToggle.addEventListener("click", () => setChatCollapsed(!chatPanel.classList.contains("is-collapsed")));
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
  if (sessionDeleteDialog.open) return;
  if (event.key === "Escape" && appShell.classList.contains("sidebar-open")) {
    setMobileSidebarOpen(false);
    appSidebarToggle.focus();
    return;
  }
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

window.addEventListener("resize", () => {
  if (isCompactSidebar()) {
    if (!appShell.classList.contains("sidebar-open")) setMobileSidebarOpen(false);
    return;
  }
  setMobileSidebarOpen(false);
});

window.addEventListener("beforeunload", () => reader.destroy());

showWelcome();

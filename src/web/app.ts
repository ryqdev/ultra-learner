import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type OnProgressParameters,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";

import { documentTitle, formatFileSize, isPdfFile } from "../lib/files.ts";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPage,
  nextZoom,
  readingProgress,
  vimPageDelta,
  vimScrollDelta,
  zoomLabel,
} from "../lib/reader.ts";
import { createSamplePdf } from "./sample.ts";

GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.mjs";

interface ReaderState {
  document: PDFDocumentProxy | null;
  loadingTask: PDFDocumentLoadingTask | null;
  filename: string;
  fileSize: number;
  page: number;
  zoom: number;
  fitScale: number;
  renderTask: RenderTask | null;
  textLayer: TextLayer | null;
  renderVersion: number;
}

const maximumFileSize = 100 * 1024 * 1024;
const state: ReaderState = {
  document: null,
  loadingTask: null,
  filename: "",
  fileSize: 0,
  page: 1,
  zoom: 1,
  fitScale: 1,
  renderTask: null,
  textLayer: null,
  renderVersion: 0,
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

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
const thumbnailList = requiredElement("thumbnail-list");
const readerStage = requiredElement("reader-stage");
const readerLoading = requiredElement("reader-loading");
const loadingDetail = requiredElement("loading-detail");
const readerError = requiredElement("reader-error");
const errorMessage = requiredElement("error-message");
const canvasFrame = requiredElement("canvas-frame");
const canvas = requiredElement<HTMLCanvasElement>("pdf-canvas");
const textLayerElement = requiredElement("text-layer");
const documentTitleElement = requiredElement("document-title");
const documentMeta = requiredElement("document-meta");
const previousPageButton = requiredElement<HTMLButtonElement>("previous-page");
const nextPageButton = requiredElement<HTMLButtonElement>("next-page");
const pageInput = requiredElement<HTMLInputElement>("page-input");
const pageCountElement = requiredElement("page-count");
const zoomOutButton = requiredElement<HTMLButtonElement>("zoom-out");
const zoomInButton = requiredElement<HTMLButtonElement>("zoom-in");
const zoomValue = requiredElement("zoom-value");
const fitButton = requiredElement<HTMLButtonElement>("fit-button");
const progressLabel = requiredElement("progress-label");
const progressBar = requiredElement<HTMLElement>("progress-bar");
const toast = requiredElement("toast");

let toastTimer: number | undefined;
let resizeTimer: number | undefined;

function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function showWelcome(): void {
  state.renderTask?.cancel();
  state.textLayer?.cancel();
  state.textLayer = null;
  void state.loadingTask?.destroy();
  state.document = null;
  state.loadingTask = null;
  state.page = 1;
  state.zoom = 1;
  state.fitScale = 1;
  state.renderVersion += 1;
  thumbnailList.replaceChildren();
  textLayerElement.replaceChildren();
  canvas.width = 0;
  canvas.height = 0;
  fileInput.value = "";
  appShell.classList.remove("is-reading");
  welcomeView.hidden = false;
  readerView.hidden = true;
  siteFooter.hidden = false;
  document.title = "Ultra Learner — PDF Reader";
}

function showReader(): void {
  appShell.classList.add("is-reading");
  welcomeView.hidden = true;
  readerView.hidden = false;
  siteFooter.hidden = true;
  readerLoading.hidden = false;
  readerError.hidden = true;
  canvasFrame.hidden = true;
  readerView.classList.toggle("sidebar-hidden", window.matchMedia("(max-width: 760px)").matches);
}

function setLoading(message: string): void {
  loadingDetail.textContent = message;
  readerLoading.hidden = false;
  readerError.hidden = true;
  canvasFrame.hidden = true;
}

function setControlsLoading(): void {
  pageInput.disabled = true;
  previousPageButton.disabled = true;
  nextPageButton.disabled = true;
  zoomOutButton.disabled = true;
  zoomInButton.disabled = true;
  fitButton.disabled = true;
  pageInput.value = "1";
  pageCountElement.textContent = "—";
  progressLabel.textContent = "0% read";
  progressBar.style.width = "0%";
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The file may be damaged or unsupported.";
  errorMessage.textContent = message.includes("password")
    ? "Password-protected PDFs are not supported in this first prototype."
    : "Try a different file or make sure the document is a valid PDF.";
  readerLoading.hidden = true;
  canvasFrame.hidden = true;
  readerError.hidden = false;
}

async function loadPdf(data: Uint8Array, filename: string, fileSize: number): Promise<void> {
  showReader();
  setLoading("Opening document…");
  setControlsLoading();
  documentTitleElement.textContent = documentTitle(filename);
  documentMeta.textContent = `${formatFileSize(fileSize)} · Validating PDF…`;
  state.renderTask?.cancel();
  state.textLayer?.cancel();
  state.textLayer = null;
  await state.loadingTask?.destroy();
  state.document = null;
  state.loadingTask = null;
  state.renderVersion += 1;
  const loadVersion = state.renderVersion;

  try {
    const loadingTask = getDocument({
      data,
      cMapPacked: true,
      cMapUrl: "/assets/cmaps/",
      iccUrl: "/assets/iccs/",
      useWorkerFetch: true,
      standardFontDataUrl: "/assets/standard_fonts/",
      wasmUrl: "/assets/wasm/",
    });
    state.loadingTask = loadingTask;
    loadingTask.onProgress = ({ loaded, total }: OnProgressParameters) => {
      if (loadVersion !== state.renderVersion) return;
      if (total > 0) loadingDetail.textContent = `Reading document… ${Math.round((loaded / total) * 100)}%`;
    };

    const pdf = await loadingTask.promise;
    if (loadVersion !== state.renderVersion) {
      await loadingTask.destroy();
      return;
    }

    state.document = pdf;
    state.filename = filename;
    state.fileSize = fileSize;
    state.page = 1;
    state.zoom = 1;

    documentTitleElement.textContent = documentTitle(filename);
    documentMeta.textContent = `${pdf.numPages} ${pdf.numPages === 1 ? "page" : "pages"} · ${formatFileSize(fileSize)} · Local only`;
    document.title = `${documentTitle(filename)} — Ultra Learner`;
    pageCountElement.textContent = String(pdf.numPages);
    pageInput.max = String(pdf.numPages);
    await renderCurrentPage(true);
    void renderThumbnails(pdf, loadVersion);
  } catch (error) {
    if (loadVersion === state.renderVersion) showError(error);
  }
}

async function openFile(file: File): Promise<void> {
  if (!isPdfFile(file)) {
    showToast("Please choose a PDF file.");
    return;
  }
  if (file.size > maximumFileSize) {
    showToast("That PDF is larger than 100 MB.");
    return;
  }
  if (file.size === 0) {
    showToast("That PDF is empty.");
    return;
  }

  const data = new Uint8Array(await file.arrayBuffer());
  await loadPdf(data, file.name, file.size);
}

async function openSample(): Promise<void> {
  const sample = createSamplePdf();
  await loadPdf(sample, "The Shape of Attention.pdf", sample.byteLength);
}

async function calculateFitScale(page: PDFPageProxy): Promise<number> {
  const naturalViewport = page.getViewport({ scale: 1 });
  const stageWidth = Math.max(readerStage.clientWidth - 56, 220);
  const stageHeight = Math.max(readerStage.clientHeight - 56, 240);
  return Math.min(stageWidth / naturalViewport.width, stageHeight / naturalViewport.height, 1.45);
}

async function renderCurrentPage(recalculateFit = false): Promise<void> {
  const pdf = state.document;
  if (!pdf) return;

  const renderVersion = ++state.renderVersion;
  state.renderTask?.cancel();
  state.textLayer?.cancel();
  state.textLayer = null;
  textLayerElement.replaceChildren();
  setLoading(`Rendering page ${state.page}…`);

  try {
    const page = await pdf.getPage(state.page);
    if (renderVersion !== state.renderVersion) return;
    if (recalculateFit) state.fitScale = await calculateFitScale(page);
    const scale = state.fitScale * state.zoom;
    const viewport = page.getViewport({ scale });
    const deviceScale = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(viewport.width * deviceScale);
    canvas.height = Math.floor(viewport.height * deviceScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    textLayerElement.style.setProperty("--total-scale-factor", String(scale));

    state.renderTask = page.render({
      canvas,
      viewport,
      transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
      background: "rgb(255, 255, 255)",
    });
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textLayerElement,
      viewport,
    });
    state.textLayer = textLayer;
    textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
    textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
    const textLayerPromise = textLayer.render().catch(() => undefined);
    await Promise.all([state.renderTask.promise, textLayerPromise]);
    if (renderVersion !== state.renderVersion) return;

    readerLoading.hidden = true;
    readerError.hidden = true;
    canvasFrame.hidden = false;
    readerStage.scrollTo({ top: 0, left: 0 });
    updateControls();
  } catch (error) {
    if (error instanceof Error && error.name === "RenderingCancelledException") return;
    if (renderVersion === state.renderVersion) showError(error);
  }
}

async function renderThumbnails(pdf: PDFDocumentProxy, loadVersion: number): Promise<void> {
  const fragment = document.createDocumentFragment();
  const buttons: HTMLButtonElement[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail-item";
    button.dataset.page = String(pageNumber);
    button.setAttribute("aria-label", `Go to page ${pageNumber}`);

    const number = document.createElement("span");
    number.className = "thumbnail-number";
    number.textContent = String(pageNumber).padStart(2, "0");
    const wrapper = document.createElement("span");
    wrapper.className = "thumbnail-canvas-wrap";
    const thumbnail = document.createElement("canvas");
    wrapper.append(thumbnail);
    button.append(number, wrapper);
    button.addEventListener("click", () => void goToPage(pageNumber));
    buttons.push(button);
    fragment.append(button);
  }

  thumbnailList.replaceChildren(fragment);
  updateActiveThumbnail();

  for (let index = 0; index < buttons.length; index += 1) {
    if (loadVersion !== state.renderVersion && state.document !== pdf) return;
    const button = buttons[index];
    const thumbnail = button?.querySelector("canvas");
    if (!thumbnail) continue;

    try {
      const page = await pdf.getPage(index + 1);
      const natural = page.getViewport({ scale: 1 });
      const width = 132;
      const scale = width / natural.width;
      const viewport = page.getViewport({ scale });
      thumbnail.width = Math.floor(viewport.width);
      thumbnail.height = Math.floor(viewport.height);
      await page.render({ canvas: thumbnail, viewport }).promise;
    } catch {
      // A thumbnail is optional; the main page remains usable if one fails.
    }
  }
}

function updateControls(): void {
  const pageCount = state.document?.numPages ?? 0;
  pageInput.disabled = false;
  fitButton.disabled = false;
  pageInput.value = String(state.page);
  previousPageButton.disabled = state.page <= 1;
  nextPageButton.disabled = state.page >= pageCount;
  zoomOutButton.disabled = state.zoom <= MIN_ZOOM;
  zoomInButton.disabled = state.zoom >= MAX_ZOOM;
  zoomValue.textContent = zoomLabel(state.zoom);
  const progress = readingProgress(state.page, pageCount);
  progressLabel.textContent = `${progress}% read`;
  progressBar.style.width = `${progress}%`;
  updateActiveThumbnail();
}

function updateActiveThumbnail(): void {
  const previous = thumbnailList.querySelector(".thumbnail-item.is-active");
  previous?.classList.remove("is-active");
  const active = thumbnailList.querySelector<HTMLButtonElement>(`[data-page="${state.page}"]`);
  active?.classList.add("is-active");
  active?.scrollIntoView({ block: "nearest" });
}

async function goToPage(requestedPage: number): Promise<void> {
  const pageCount = state.document?.numPages ?? 0;
  const nextPage = clampPage(requestedPage, pageCount);
  if (!state.document || nextPage === state.page) {
    pageInput.value = String(state.page);
    return;
  }
  state.page = nextPage;
  await renderCurrentPage();
}

async function changeZoom(direction: -1 | 1): Promise<void> {
  const zoom = nextZoom(state.zoom, direction);
  if (zoom === state.zoom) return;
  state.zoom = zoom;
  await renderCurrentPage();
}

async function fitPage(): Promise<void> {
  state.zoom = 1;
  await renderCurrentPage(true);
}

function chooseFile(): void {
  fileInput.value = "";
  fileInput.click();
}

chooseButton.addEventListener("click", chooseFile);
newFileButton.addEventListener("click", chooseFile);
errorChooseButton.addEventListener("click", chooseFile);
sampleButton.addEventListener("click", () => void openSample());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
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
  if (file) void openFile(file);
});

previousPageButton.addEventListener("click", () => void goToPage(state.page - 1));
nextPageButton.addEventListener("click", () => void goToPage(state.page + 1));
pageInput.addEventListener("change", () => void goToPage(Number(pageInput.value)));
pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void goToPage(Number(pageInput.value));
    pageInput.blur();
  }
});
zoomOutButton.addEventListener("click", () => void changeZoom(-1));
zoomInButton.addEventListener("click", () => void changeZoom(1));
fitButton.addEventListener("click", () => void fitPage());

sidebarToggle.addEventListener("click", () => readerView.classList.toggle("sidebar-hidden"));
sidebarClose.addEventListener("click", () => readerView.classList.add("sidebar-hidden"));

themeButton.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("is-dark");
  themeButton.setAttribute("aria-pressed", String(isDark));
});

window.addEventListener("keydown", (event) => {
  if (
    !state.document
    || event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
    || (event.target instanceof HTMLElement && event.target.isContentEditable)
    || event.altKey
  ) return;
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    void goToPage(state.page - 1);
  }
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    void goToPage(state.page + 1);
  }
  if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) {
    event.preventDefault();
    void changeZoom(1);
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "-") {
    event.preventDefault();
    void changeZoom(-1);
    return;
  }
  if (event.metaKey || event.ctrlKey) return;
  if (event.key === "j" || event.key === "k") {
    event.preventDefault();
    readerStage.scrollBy({ top: vimScrollDelta(event.key), behavior: "auto" });
    return;
  }
  if (event.key === "d" || event.key === "u") {
    event.preventDefault();
    void goToPage(state.page + vimPageDelta(event.key));
    return;
  }
  if (event.key === "Escape") readerView.classList.add("sidebar-hidden");
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.document && state.zoom === 1) void renderCurrentPage(true);
  }, 180);
});

window.addEventListener("beforeunload", () => {
  state.renderTask?.cancel();
  void state.loadingTask?.destroy();
});

showWelcome();

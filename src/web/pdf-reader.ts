import {
  AnnotationLayer,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type OnProgressParameters,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";

import { documentTitle, formatFileSize, pdfFileValidationError } from "../lib/files.ts";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  vimScrollDelta,
  clampPage,
  isVimScrollBoundary,
  nextZoom,
  readingProgress,
  vimPageDelta,
  zoomLabel,
} from "../lib/reader.ts";
import { createSelectionContext, type SelectionContext, type SelectionSource } from "../lib/selection.ts";
import { ReaderPdfDownloadManager } from "./pdf-download-manager.ts";
import { ReaderPdfLinkService } from "./pdf-link-service.ts";

GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.mjs";

export interface PdfReaderElements {
  readerView: HTMLElement;
  readerStage: HTMLElement;
  readerLoading: HTMLElement;
  loadingDetail: HTMLElement;
  readerError: HTMLElement;
  errorMessage: HTMLElement;
  canvasFrame: HTMLElement;
  pageSurface: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  annotationLayer: HTMLDivElement;
  boxSelection: HTMLElement;
  thumbnailList: HTMLElement;
  documentTitle: HTMLElement;
  documentMeta: HTMLElement;
  pageInput: HTMLInputElement;
  pageCount: HTMLElement;
  previousPage: HTMLButtonElement;
  nextPage: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  zoomValue: HTMLElement;
  fitButton: HTMLButtonElement;
  progressLabel: HTMLElement;
  progressBar: HTMLElement;
}

export interface PdfReaderCallbacks {
  onFileAccepted: () => void;
  onSelection: (selection: SelectionContext | null) => void;
  onToast: (message: string) => void;
}

export interface OpenFileOptions {
  persist?: (data: Uint8Array) => Promise<string | void>;
}

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
  annotationLayer: AnnotationLayer | null;
  annotationCanvasMap: Map<string, HTMLCanvasElement> | null;
  optionalContentConfigPromise: ReturnType<PDFDocumentProxy["getOptionalContentConfig"]> | null;
  renderVersion: number;
  selectionMode: SelectionSource;
}

interface PdfDestinationKind {
  name?: string;
}

interface PdfDestinationLocation {
  x: number | null;
  y: number | null;
}

function isRenderingCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function rectanglesIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export class PdfReaderController {
  private readonly state: ReaderState = {
    document: null,
    loadingTask: null,
    filename: "",
    fileSize: 0,
    page: 1,
    zoom: 1,
    fitScale: 1,
    renderTask: null,
    textLayer: null,
    annotationLayer: null,
    annotationCanvasMap: null,
    optionalContentConfigPromise: null,
    renderVersion: 0,
    selectionMode: "text",
  };

  private resizeTimer: number | undefined;
  private boxStart: { x: number; y: number } | null = null;
  private openFileVersion = 0;
  private readonly linkService: ReaderPdfLinkService;
  private readonly downloadManager = new ReaderPdfDownloadManager();

  public constructor(
    private readonly elements: PdfReaderElements,
    private readonly callbacks: PdfReaderCallbacks,
  ) {
    this.linkService = new ReaderPdfLinkService(this, callbacks.onToast);
    this.bindEvents();
    this.setControlsLoading();
  }

  public get page(): number {
    return this.state.page;
  }

  public get pageCount(): number {
    return this.state.document?.numPages ?? 0;
  }

  public get documentLoaded(): boolean {
    return this.state.document !== null;
  }

  public reset(): void {
    this.openFileVersion += 1;
    this.cancelCurrentWork();
    this.state.filename = "";
    this.state.fileSize = 0;
    this.state.page = 1;
    this.state.zoom = 1;
    this.state.fitScale = 1;
    this.state.selectionMode = "text";
    this.elements.pageSurface.classList.remove("is-box-selecting");
    this.elements.textLayer.classList.remove("is-box-selecting");
    this.elements.annotationLayer.classList.remove("is-box-selecting");
    this.elements.textLayer.setAttribute("aria-label", "Select PDF text");
    this.elements.thumbnailList.replaceChildren();
    this.elements.canvas.width = 0;
    this.elements.canvas.height = 0;
    this.elements.canvas.style.width = "";
    this.elements.canvas.style.height = "";
    this.elements.textLayer.replaceChildren();
    this.elements.annotationLayer.replaceChildren();
    this.elements.pageSurface.style.width = "";
    this.elements.pageSurface.style.height = "";
    this.elements.documentTitle.textContent = "Document";
    this.elements.documentMeta.textContent = "PDF document";
    this.setControlsLoading();
    this.clearSelection();
  }

  public showReader(): void {
    this.elements.readerLoading.hidden = false;
    this.elements.readerError.hidden = true;
    this.elements.canvasFrame.hidden = true;
    this.elements.readerView.classList.toggle("sidebar-hidden", window.matchMedia("(max-width: 760px)").matches);
  }

  public async loadPdf(data: Uint8Array, filename: string, fileSize: number): Promise<boolean> {
    this.showReader();
    this.setLoading("Parsing PDF…");
    this.setControlsLoading();
    this.elements.documentTitle.textContent = documentTitle(filename);
    this.elements.documentMeta.textContent = `${formatFileSize(fileSize)} · Validating PDF…`;
    this.cancelCurrentWork();
    const loadVersion = ++this.state.renderVersion;

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
      this.state.loadingTask = loadingTask;
      loadingTask.onProgress = ({ loaded, total }: OnProgressParameters) => {
        if (loadVersion !== this.state.renderVersion) return;
        if (total > 0) this.elements.loadingDetail.textContent = `Reading document… ${Math.round((loaded / total) * 100)}%`;
      };

      const pdf = await loadingTask.promise;
      if (loadVersion !== this.state.renderVersion) {
        await loadingTask.destroy();
        return false;
      }

      this.state.document = pdf;
      this.linkService.setDocument(pdf);
      this.state.loadingTask = loadingTask;
      this.state.filename = filename;
      this.state.fileSize = fileSize;
      this.state.page = 1;
      this.state.zoom = 1;
      this.state.optionalContentConfigPromise = pdf.getOptionalContentConfig({ intent: "display" });
      this.elements.documentTitle.textContent = documentTitle(filename);
      this.elements.documentMeta.textContent = `${pdf.numPages} ${pdf.numPages === 1 ? "page" : "pages"} · ${formatFileSize(fileSize)} · Local only`;
      this.elements.pageCount.textContent = String(pdf.numPages);
      this.elements.pageInput.max = String(pdf.numPages);
      document.title = `${documentTitle(filename)} — Ultra Learner`;
      this.clearSelection();
      await this.renderCurrentPage(true);
      void this.renderThumbnails(pdf, loadVersion);
      return this.state.document === pdf;
    } catch (error) {
      if (loadVersion === this.state.renderVersion) this.showError(error);
      return false;
    }
  }

  public async goToPage(requestedPage: number): Promise<void> {
    const nextPage = clampPage(requestedPage, this.pageCount);
    if (!this.state.document || nextPage === this.state.page) {
      this.elements.pageInput.value = String(this.state.page);
      return;
    }
    this.state.page = nextPage;
    this.clearSelection();
    await this.renderCurrentPage();
  }

  public async goToDestination(page: number, explicitDestination: readonly unknown[]): Promise<void> {
    const nextPage = clampPage(page, this.pageCount);
    const location = this.destinationLocation(explicitDestination);
    if (nextPage === this.state.page) {
      this.scrollToDestination(location);
      return;
    }
    await this.goToPage(nextPage);
    if (this.state.page !== nextPage) return;
    this.scrollToDestination(location);
  }

  public async setOptionalContentState(action: unknown): Promise<void> {
    const pdf = this.state.document;
    if (!pdf) return;
    const configuration = await (this.state.optionalContentConfigPromise
      ?? pdf.getOptionalContentConfig({ intent: "display" }));
    if (pdf !== this.state.document) return;
    configuration.setOCGState(action as Parameters<typeof configuration.setOCGState>[0]);
    this.state.optionalContentConfigPromise = Promise.resolve(configuration);
    await this.renderCurrentPage();
  }

  public async changeZoom(direction: -1 | 1): Promise<void> {
    const zoom = nextZoom(this.state.zoom, direction);
    if (zoom === this.state.zoom) return;
    this.state.zoom = zoom;
    await this.renderCurrentPage();
  }

  public async fitPage(): Promise<void> {
    this.state.zoom = 1;
    await this.renderCurrentPage(true);
  }

  /** Move the reading viewport by one Vim-style line or page. */
  public vimNavigate(key: "j" | "k" | "d" | "u"): void {
    if (key === "j" || key === "k") {
      if (isVimScrollBoundary(
        key,
        this.elements.readerStage.scrollTop,
        this.elements.readerStage.clientHeight,
        this.elements.readerStage.scrollHeight,
      )) {
        void this.goToPage(this.state.page + (key === "j" ? 1 : -1));
        return;
      }
      this.elements.readerStage.scrollBy({ top: vimScrollDelta(key), behavior: "auto" });
      return;
    }
    void this.goToPage(this.state.page + vimPageDelta(key));
  }

  public setSelectionMode(mode: SelectionSource): void {
    this.state.selectionMode = mode;
    this.elements.pageSurface.classList.toggle("is-box-selecting", mode === "box");
    this.elements.textLayer.classList.toggle("is-box-selecting", mode === "box");
    this.elements.annotationLayer.classList.toggle("is-box-selecting", mode === "box");
    this.elements.textLayer.setAttribute("aria-label", mode === "box" ? "Draw a box around PDF text" : "Select PDF text");
    if (mode === "box") this.clearSelection();
  }

  public toggleSidebar(): void {
    this.elements.readerView.classList.toggle("sidebar-hidden");
  }

  public closeSidebar(): void {
    this.elements.readerView.classList.add("sidebar-hidden");
  }

  public refreshLayout(): void {
    if (this.state.document && this.state.zoom === 1) void this.renderCurrentPage(true);
  }

  public async openFile(file: File, options: OpenFileOptions = {}): Promise<void> {
    const validationError = pdfFileValidationError(file);
    if (validationError) {
      this.callbacks.onToast(validationError);
      return;
    }

    const openVersion = ++this.openFileVersion;
    this.showReader();
    this.setLoading("Reading local file…");
    this.setControlsLoading();
    this.elements.documentTitle.textContent = documentTitle(file.name);
    this.elements.documentMeta.textContent = `${formatFileSize(file.size)} · Preparing local session…`;
    this.callbacks.onFileAccepted();

    let data: Uint8Array;
    try {
      data = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (openVersion === this.openFileVersion) this.showError(error);
      return;
    }
    if (openVersion !== this.openFileVersion) return;

    // PDF.js may transfer the supplied buffer to its worker, so retain the
    // original bytes for the local session write after parsing succeeds.
    const loaded = await this.loadPdf(data.slice(), file.name, file.size);
    if (!loaded || openVersion !== this.openFileVersion) return;

    if (options.persist) {
      try {
        const persistedLabel = await options.persist(data);
        if (persistedLabel) {
          this.elements.documentMeta.textContent = `${this.pageCount} ${this.pageCount === 1 ? "page" : "pages"} · ${formatFileSize(file.size)} · ${persistedLabel}`;
        }
      } catch (error) {
        this.elements.documentMeta.textContent = `${this.pageCount} ${this.pageCount === 1 ? "page" : "pages"} · ${formatFileSize(file.size)} · Current tab only`;
        this.callbacks.onToast(error instanceof Error ? error.message : "Unable to save this PDF to your history.");
      }
    }
  }

  public destroy(): void {
    this.openFileVersion += 1;
    this.cancelCurrentWork();
    window.clearTimeout(this.resizeTimer);
  }

  private bindEvents(): void {
    const { elements } = this;
    elements.previousPage.addEventListener("click", () => void this.goToPage(this.state.page - 1));
    elements.nextPage.addEventListener("click", () => void this.goToPage(this.state.page + 1));
    elements.pageInput.addEventListener("change", () => void this.goToPage(Number(elements.pageInput.value)));
    elements.pageInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.goToPage(Number(elements.pageInput.value));
      elements.pageInput.blur();
    });
    elements.zoomOut.addEventListener("click", () => void this.changeZoom(-1));
    elements.zoomIn.addEventListener("click", () => void this.changeZoom(1));
    elements.fitButton.addEventListener("click", () => void this.fitPage());
    elements.thumbnailList.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-page]") : null;
      if (target) void this.goToPage(Number(target.dataset.page));
    });
    this.elements.textLayer.addEventListener("mouseup", () => {
      window.setTimeout(() => this.publishNativeSelection(), 0);
    });
    document.addEventListener("selectionchange", () => {
      if (this.state.selectionMode === "text") this.publishNativeSelection();
    });
    elements.pageSurface.addEventListener("pointerdown", (event) => this.beginBoxSelection(event));
    elements.pageSurface.addEventListener("pointermove", (event) => this.updateBoxSelection(event));
    elements.pageSurface.addEventListener("pointerup", (event) => this.finishBoxSelection(event));
    elements.pageSurface.addEventListener("pointercancel", () => this.cancelBoxSelection());
    window.addEventListener("resize", () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.refreshLayout();
      }, 180);
    });
  }

  private beginBoxSelection(event: PointerEvent): void {
    if (this.state.selectionMode !== "box" || event.button !== 0 || !this.state.document) return;
    event.preventDefault();
    this.boxStart = this.surfacePoint(event);
    this.elements.pageSurface.setPointerCapture(event.pointerId);
    this.elements.boxSelection.hidden = false;
    this.elements.boxSelection.style.left = `${this.boxStart.x}px`;
    this.elements.boxSelection.style.top = `${this.boxStart.y}px`;
    this.elements.boxSelection.style.width = "0px";
    this.elements.boxSelection.style.height = "0px";
  }

  private updateBoxSelection(event: PointerEvent): void {
    if (!this.boxStart) return;
    event.preventDefault();
    const point = this.surfacePoint(event);
    const left = Math.min(point.x, this.boxStart.x);
    const top = Math.min(point.y, this.boxStart.y);
    this.elements.boxSelection.style.left = `${left}px`;
    this.elements.boxSelection.style.top = `${top}px`;
    this.elements.boxSelection.style.width = `${Math.abs(point.x - this.boxStart.x)}px`;
    this.elements.boxSelection.style.height = `${Math.abs(point.y - this.boxStart.y)}px`;
  }

  private finishBoxSelection(event: PointerEvent): void {
    if (!this.boxStart) return;
    event.preventDefault();
    const start = this.boxStart;
    const point = this.surfacePoint(event);
    this.boxStart = null;
    if (this.elements.pageSurface.hasPointerCapture(event.pointerId)) this.elements.pageSurface.releasePointerCapture(event.pointerId);
    this.elements.boxSelection.hidden = true;

    const left = Math.min(point.x, start.x);
    const top = Math.min(point.y, start.y);
    const selectionRect = new DOMRect(
      this.elements.pageSurface.getBoundingClientRect().left + left,
      this.elements.pageSurface.getBoundingClientRect().top + top,
      Math.abs(point.x - start.x),
      Math.abs(point.y - start.y),
    );
    const text = Array.from(this.elements.textLayer.querySelectorAll<HTMLElement>("span"))
      .filter((span) => rectanglesIntersect(span.getBoundingClientRect(), selectionRect))
      .map((span) => span.textContent ?? "")
      .join(" ");
    const selection = createSelectionContext(text, this.state.page, "box");
    if (!selection) {
      this.callbacks.onToast("Draw around text on the page to share it with the chat.");
      return;
    }
    this.publishSelection(selection);
  }

  private cancelBoxSelection(): void {
    this.boxStart = null;
    this.elements.boxSelection.hidden = true;
  }

  private surfacePoint(event: PointerEvent): { x: number; y: number } {
    const bounds = this.elements.pageSurface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  }

  private publishNativeSelection(): void {
    if (this.state.selectionMode !== "text") return;
    const browserSelection = window.getSelection();
    if (!browserSelection || browserSelection.isCollapsed || !browserSelection.rangeCount) return;
    const range = browserSelection.getRangeAt(0);
    if (!this.elements.textLayer.contains(range.commonAncestorContainer)) return;
    const selection = createSelectionContext(browserSelection.toString(), this.state.page, "text");
    if (selection) this.publishSelection(selection);
  }

  private publishSelection(selection: SelectionContext): void {
    this.callbacks.onSelection(selection);
  }

  private clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    this.elements.boxSelection.hidden = true;
    this.callbacks.onSelection(null);
  }

  private cancelCurrentWork(): void {
    this.state.renderTask?.cancel();
    this.state.textLayer?.cancel();
    this.state.annotationLayer?.destroy();
    void this.state.loadingTask?.destroy();
    this.linkService.setDocument(null);
    this.state.document = null;
    this.state.loadingTask = null;
    this.state.renderTask = null;
    this.state.textLayer = null;
    this.state.annotationLayer = null;
    this.state.annotationCanvasMap = null;
    this.state.optionalContentConfigPromise = null;
    this.elements.thumbnailList.replaceChildren();
    this.elements.canvas.width = 0;
    this.elements.canvas.height = 0;
    this.elements.textLayer.replaceChildren();
    this.elements.annotationLayer.replaceChildren();
    this.state.renderVersion += 1;
    this.callbacks.onSelection(null);
  }

  private setLoading(message: string): void {
    this.elements.loadingDetail.textContent = message;
    this.elements.readerLoading.hidden = false;
    this.elements.readerError.hidden = true;
    this.elements.canvasFrame.hidden = true;
  }

  private setControlsLoading(): void {
    const { elements } = this;
    elements.pageInput.disabled = true;
    elements.previousPage.disabled = true;
    elements.nextPage.disabled = true;
    elements.zoomOut.disabled = true;
    elements.zoomIn.disabled = true;
    elements.fitButton.disabled = true;
    elements.pageInput.value = "1";
    elements.pageCount.textContent = "—";
    elements.progressLabel.textContent = "0% read";
    elements.progressBar.style.width = "0%";
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : "The file may be damaged or unsupported.";
    this.elements.errorMessage.textContent = message.includes("password")
      ? "Password-protected PDFs are not supported in this first prototype."
      : "Try a different file or make sure the document is a valid PDF.";
    this.elements.readerLoading.hidden = true;
    this.elements.canvasFrame.hidden = true;
    this.elements.readerError.hidden = false;
  }

  private async calculateFitScale(page: PDFPageProxy): Promise<number> {
    const naturalViewport = page.getViewport({ scale: 1 });
    const stageWidth = Math.max(this.elements.readerStage.clientWidth - 56, 220);
    const stageHeight = Math.max(this.elements.readerStage.clientHeight - 56, 240);
    return Math.min(stageWidth / naturalViewport.width, stageHeight / naturalViewport.height, 1.45);
  }

  private destinationLocation(destination: readonly unknown[]): PdfDestinationLocation | null {
    const kind = destination[1] as PdfDestinationKind | undefined;
    switch (kind?.name) {
      case "XYZ":
        return {
          x: typeof destination[2] === "number" ? destination[2] : 0,
          y: typeof destination[3] === "number" ? destination[3] : null,
        };
      case "FitH":
      case "FitBH":
        return {
          x: 0,
          y: typeof destination[2] === "number" ? destination[2] : null,
        };
      case "FitV":
      case "FitBV":
        return {
          x: typeof destination[2] === "number" ? destination[2] : 0,
          y: null,
        };
      case "FitR":
        return {
          x: typeof destination[2] === "number" ? destination[2] : 0,
          y: typeof destination[5] === "number" ? destination[5] : null,
        };
      default:
        return null;
    }
  }

  private scrollToDestination(location: PdfDestinationLocation | null): void {
    if (!location) {
      this.elements.readerStage.scrollTo({ top: 0, left: 0 });
      return;
    }
    const scale = this.state.fitScale * this.state.zoom;
    const pdf = this.state.document;
    const destinationPage = this.state.page;
    void pdf?.getPage(destinationPage).then((page) => {
      if (pdf !== this.state.document || destinationPage !== this.state.page) return;
      const viewport = page.getViewport({ scale });
      const y = location.y ?? page.view[3]!;
      const [left, top] = viewport.convertToViewportPoint(location.x ?? 0, y);
      this.elements.readerStage.scrollTo({
        left: Math.max(0, left + this.elements.canvasFrame.offsetLeft),
        top: Math.max(0, top + this.elements.canvasFrame.offsetTop),
      });
    });
  }

  private async renderCurrentPage(recalculateFit = false): Promise<void> {
    const pdf = this.state.document;
    if (!pdf) return;

    const renderVersion = ++this.state.renderVersion;
    this.state.renderTask?.cancel();
    this.state.textLayer?.cancel();
    this.state.annotationLayer?.destroy();
    this.state.annotationLayer = null;
    this.state.annotationCanvasMap = null;
    this.setLoading(`Rendering page ${this.state.page}…`);

    try {
      const page = await pdf.getPage(this.state.page);
      if (renderVersion !== this.state.renderVersion) return;
      if (recalculateFit) this.state.fitScale = await this.calculateFitScale(page);
      const scale = this.state.fitScale * this.state.zoom;
      const viewport = page.getViewport({ scale });
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);

      this.elements.pageSurface.style.width = `${width}px`;
      this.elements.pageSurface.style.height = `${height}px`;
      this.elements.canvas.width = Math.floor(viewport.width * deviceScale);
      this.elements.canvas.height = Math.floor(viewport.height * deviceScale);
      this.elements.canvas.style.width = `${width}px`;
      this.elements.canvas.style.height = `${height}px`;
      this.elements.textLayer.style.width = `${width}px`;
      this.elements.textLayer.style.height = `${height}px`;
      this.elements.textLayer.style.setProperty("--total-scale-factor", String(scale));
      this.elements.textLayer.replaceChildren();
      this.elements.pageSurface.style.setProperty("--total-scale-factor", String(scale));
      this.elements.pageSurface.style.setProperty("--scale-round-x", "1px");
      this.elements.pageSurface.style.setProperty("--scale-round-y", "1px");
      this.elements.annotationLayer.replaceChildren();

      const annotationCanvasMap = new Map<string, HTMLCanvasElement>();
      this.state.annotationCanvasMap = annotationCanvasMap;

      const renderTask = page.render({
        canvas: this.elements.canvas,
        viewport,
        annotationMode: AnnotationMode.ENABLE_FORMS,
        annotationCanvasMap,
        optionalContentConfigPromise: this.state.optionalContentConfigPromise ?? undefined,
        transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
        background: "rgb(255, 255, 255)",
      });
      this.state.renderTask = renderTask;
      const textLayerPromise = page.getTextContent().then((textContent) => {
        if (renderVersion !== this.state.renderVersion) return;
        const textLayer = new TextLayer({ textContentSource: textContent, container: this.elements.textLayer, viewport });
        this.state.textLayer = textLayer;
        return textLayer.render();
      });
      const annotationsPromise = page.getAnnotations({ intent: "display" });
      await Promise.all([renderTask.promise, textLayerPromise]);
      if (renderVersion !== this.state.renderVersion) return;

      const [annotations, optionalContentConfig] = await Promise.all([
        annotationsPromise,
        this.state.optionalContentConfigPromise,
      ]);
      if (renderVersion !== this.state.renderVersion) return;
      const annotationViewport = viewport.clone({ dontFlip: true });
      const annotationLayerElement = document.createElement("div");
      annotationLayerElement.id = "annotation-layer";
      annotationLayerElement.className = "annotationLayer";
      annotationLayerElement.classList.toggle("is-box-selecting", this.state.selectionMode === "box");
      annotationLayerElement.setAttribute("aria-label", "PDF links and annotations");
      const annotationLayer = new AnnotationLayer({
        div: annotationLayerElement,
        accessibilityManager: null,
        annotationEditorUIManager: null,
        page,
        viewport: annotationViewport,
        structTreeLayer: null,
        commentManager: null,
        linkService: this.linkService,
        annotationStorage: pdf.annotationStorage,
        annotationCanvasMap,
      });
      await annotationLayer.render({
        viewport: annotationViewport,
        div: annotationLayerElement,
        annotations,
        page,
        linkService: this.linkService as never,
        downloadManager: this.downloadManager as never,
        annotationStorage: pdf.annotationStorage,
        imageResourcesPath: "/assets/images/",
        renderForms: true,
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: null,
        annotationCanvasMap,
        optionalContentConfig: optionalContentConfig ?? undefined,
      });
      if (renderVersion !== this.state.renderVersion) {
        annotationLayer.destroy();
        return;
      }
      this.elements.annotationLayer.replaceWith(annotationLayerElement);
      this.elements.annotationLayer = annotationLayerElement;
      this.state.annotationLayer = annotationLayer;

      this.elements.readerLoading.hidden = true;
      this.elements.readerError.hidden = true;
      this.elements.canvasFrame.hidden = false;
      this.elements.readerStage.scrollTo({ top: 0, left: 0 });
      this.updateControls();
    } catch (error) {
      if (isRenderingCancelled(error) || (error instanceof Error && error.name === "AbortException")) return;
      if (renderVersion === this.state.renderVersion) this.showError(error);
    }
  }

  private async renderThumbnails(pdf: PDFDocumentProxy, loadVersion: number): Promise<void> {
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
      wrapper.append(document.createElement("canvas"));
      button.append(number, wrapper);
      buttons.push(button);
      fragment.append(button);
    }
    this.elements.thumbnailList.replaceChildren(fragment);
    this.updateActiveThumbnail();

    for (let index = 0; index < buttons.length; index += 1) {
      if (loadVersion !== this.state.renderVersion && this.state.document !== pdf) return;
      const thumbnail = buttons[index]?.querySelector("canvas");
      if (!thumbnail) continue;
      try {
        const page = await pdf.getPage(index + 1);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 132 / natural.width });
        thumbnail.width = Math.floor(viewport.width);
        thumbnail.height = Math.floor(viewport.height);
        await page.render({ canvas: thumbnail, viewport }).promise;
      } catch {
        // A thumbnail is optional; the main page remains usable if one fails.
      }
    }
  }

  private updateControls(): void {
    const { elements } = this;
    elements.pageInput.disabled = false;
    elements.fitButton.disabled = false;
    elements.pageInput.value = String(this.state.page);
    elements.previousPage.disabled = this.state.page <= 1;
    elements.nextPage.disabled = this.state.page >= this.pageCount;
    elements.zoomOut.disabled = this.state.zoom <= MIN_ZOOM;
    elements.zoomIn.disabled = this.state.zoom >= MAX_ZOOM;
    elements.zoomValue.textContent = zoomLabel(this.state.zoom);
    const progress = readingProgress(this.state.page, this.pageCount);
    elements.progressLabel.textContent = `${progress}% read`;
    elements.progressBar.style.width = `${progress}%`;
    this.updateActiveThumbnail();
  }

  private updateActiveThumbnail(): void {
    const previous = this.elements.thumbnailList.querySelector(".thumbnail-item.is-active");
    previous?.classList.remove("is-active");
    const active = this.elements.thumbnailList.querySelector<HTMLButtonElement>(`[data-page="${this.state.page}"]`);
    active?.classList.add("is-active");
    active?.scrollIntoView({ block: "nearest" });
  }
}

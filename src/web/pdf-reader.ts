import {
  AnnotationLayer,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type OnProgressParameters,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { TextLayerBuilder } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

import { documentTitle, pdfFileValidationError, pdfOpenErrorMessage } from "../lib/files.ts";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  type VimScrollKey,
  clampPage,
  isVimScrollBoundary,
  nextZoom,
  readingProgress,
  vimPageDelta,
  vimScrollDelta,
  vimScrollProgress,
  zoomLabel,
} from "../lib/reader.ts";
import { createSelectionContext, type SelectionContext, type SelectionSource } from "../lib/selection.ts";
import { ReaderPdfDownloadManager } from "./pdf-download-manager.ts";
import { ReaderPdfLinkService } from "./pdf-link-service.ts";

GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.mjs";

const PAGE_RENDER_LOADING_DELAY_MS = 160;

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
  textLayer: HTMLDivElement;
  annotationLayer: HTMLDivElement;
  boxSelection: HTMLElement;
  thumbnailList: HTMLElement;
  documentTitle: HTMLElement;
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
  onSelection?: (selection: SelectionContext | null) => void;
  onToast: (message: string) => void;
}

export interface OpenFileOptions {
  persist?: (data: Uint8Array) => Promise<void>;
}

interface ReaderState {
  document: PDFDocumentProxy | null;
  loadingTask: PDFDocumentLoadingTask | null;
  filename: string;
  page: number;
  zoom: number;
  fitScale: number;
  renderTask: RenderTask | null;
  textLayer: TextLayerBuilder | null;
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
  private pageLoadingTimer: number | undefined;
  private boxStart: { x: number; y: number } | null = null;
  private openFileVersion = 0;
  private mainPageRendering = false;
  private pendingTextLayer: TextLayerBuilder | null = null;
  private pendingAnnotationLayer: AnnotationLayer | null = null;
  private thumbnailRenderTask: RenderTask | null = null;
  private vimScrollAnimationFrame: number | null = null;
  private vimScrollTarget: number | null = null;
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
    this.setControlsLoading();
    this.clearSelection();
  }

  public showReader(): void {
    this.elements.readerLoading.hidden = false;
    this.elements.readerError.hidden = true;
    this.elements.canvasFrame.hidden = true;
    this.elements.readerView.classList.add("sidebar-hidden");
  }

  public async loadPdf(data: Uint8Array, filename: string): Promise<boolean> {
    this.showReader();
    this.setLoading("Parsing PDF…");
    this.setControlsLoading();
    this.elements.documentTitle.textContent = documentTitle(filename);
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
      this.state.page = 1;
      this.state.zoom = 1;
      this.state.optionalContentConfigPromise = pdf.getOptionalContentConfig({ intent: "display" });
      this.elements.documentTitle.textContent = documentTitle(filename);
      this.elements.pageCount.textContent = String(pdf.numPages);
      this.elements.pageInput.max = String(pdf.numPages);
      document.title = `${documentTitle(filename)} — Ultra Learner`;
      this.clearSelection();
      await this.renderCurrentPage(true);
      void this.renderThumbnails(pdf);
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
      this.animateVimScroll(key);
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
    const loaded = await this.loadPdf(data.slice(), file.name);
    if (!loaded || openVersion !== this.openFileVersion) return;

    if (options.persist) {
      try {
        await options.persist(data);
      } catch (error) {
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
    this.elements.pageSurface.addEventListener("mouseup", () => {
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
      .filter((span) => !span.classList.contains("markedContent") && !span.querySelector("span"))
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
    this.callbacks.onSelection?.(selection);
  }

  private clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    this.elements.boxSelection.hidden = true;
    this.callbacks.onSelection?.(null);
  }

  private animateVimScroll(key: VimScrollKey): void {
    const stage = this.elements.readerStage;
    const start = stage.scrollTop;
    const maximum = Math.max(stage.scrollHeight - stage.clientHeight, 0);
    const target = Math.min(Math.max((this.vimScrollTarget ?? start) + vimScrollDelta(key), 0), maximum);
    if (this.vimScrollAnimationFrame !== null) window.cancelAnimationFrame(this.vimScrollAnimationFrame);
    if (target === start) {
      this.vimScrollAnimationFrame = null;
      this.vimScrollTarget = null;
      return;
    }

    this.vimScrollTarget = target;
    const startedAt = window.performance.now();
    const animate = (now: number): void => {
      const progress = vimScrollProgress(now - startedAt);
      stage.scrollTop = start + (target - start) * progress;
      if (progress < 1) {
        this.vimScrollAnimationFrame = window.requestAnimationFrame(animate);
        return;
      }
      stage.scrollTop = target;
      this.vimScrollAnimationFrame = null;
      this.vimScrollTarget = null;
    };
    this.vimScrollAnimationFrame = window.requestAnimationFrame(animate);
  }

  private cancelVimScroll(): void {
    if (this.vimScrollAnimationFrame !== null) window.cancelAnimationFrame(this.vimScrollAnimationFrame);
    this.vimScrollAnimationFrame = null;
    this.vimScrollTarget = null;
  }

  private cancelCurrentWork(): void {
    this.cancelVimScroll();
    window.clearTimeout(this.pageLoadingTimer);
    this.pageLoadingTimer = undefined;
    this.state.renderTask?.cancel();
    this.pendingTextLayer?.cancel();
    this.pendingAnnotationLayer?.destroy();
    this.thumbnailRenderTask?.cancel();
    this.state.textLayer?.cancel();
    this.state.annotationLayer?.destroy();
    void this.state.loadingTask?.destroy();
    this.linkService.setDocument(null);
    this.state.document = null;
    this.state.loadingTask = null;
    this.state.renderTask = null;
    this.pendingTextLayer = null;
    this.pendingAnnotationLayer = null;
    this.thumbnailRenderTask = null;
    this.mainPageRendering = false;
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
    this.callbacks.onSelection?.(null);
  }

  private setLoading(message: string): void {
    window.clearTimeout(this.pageLoadingTimer);
    this.pageLoadingTimer = undefined;
    this.elements.loadingDetail.textContent = message;
    this.elements.readerLoading.hidden = false;
    this.elements.readerError.hidden = true;
    this.elements.canvasFrame.hidden = true;
  }

  private deferPageLoading(message: string, renderVersion: number): void {
    window.clearTimeout(this.pageLoadingTimer);
    this.elements.loadingDetail.textContent = message;
    this.elements.readerLoading.hidden = true;
    this.pageLoadingTimer = window.setTimeout(() => {
      this.pageLoadingTimer = undefined;
      if (renderVersion !== this.state.renderVersion || this.elements.canvasFrame.hidden) return;
      this.elements.readerLoading.hidden = false;
    }, PAGE_RENDER_LOADING_DELAY_MS);
  }

  private hideLoading(): void {
    window.clearTimeout(this.pageLoadingTimer);
    this.pageLoadingTimer = undefined;
    this.elements.readerLoading.hidden = true;
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
    window.clearTimeout(this.pageLoadingTimer);
    this.pageLoadingTimer = undefined;
    this.elements.errorMessage.textContent = pdfOpenErrorMessage(error);
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
    this.cancelVimScroll();
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
    this.cancelVimScroll();
    const pdf = this.state.document;
    if (!pdf) return;

    const renderVersion = ++this.state.renderVersion;
    const hadRenderedPage = !this.elements.canvasFrame.hidden;
    this.state.renderTask?.cancel();
    this.pendingTextLayer?.cancel();
    this.pendingAnnotationLayer?.destroy();
    this.thumbnailRenderTask?.cancel();
    this.state.renderTask = null;
    this.pendingTextLayer = null;
    this.pendingAnnotationLayer = null;
    this.thumbnailRenderTask = null;
    this.mainPageRendering = true;
    if (hadRenderedPage) {
      this.deferPageLoading(`Rendering page ${this.state.page}…`, renderVersion);
    } else {
      this.setLoading(`Rendering page ${this.state.page}…`);
    }

    let renderTask: RenderTask | null = null;
    let textLayer: TextLayerBuilder | null = null;
    let annotationLayer: AnnotationLayer | null = null;
    let committed = false;

    try {
      const page = await pdf.getPage(this.state.page);
      if (renderVersion !== this.state.renderVersion) return;
      if (recalculateFit) this.state.fitScale = await this.calculateFitScale(page);
      const scale = this.state.fitScale * this.state.zoom;
      const viewport = page.getViewport({ scale });
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);

      const canvas = this.elements.canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.width = Math.floor(viewport.width * deviceScale);
      canvas.height = Math.floor(viewport.height * deviceScale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const annotationCanvasMap = new Map<string, HTMLCanvasElement>();
      renderTask = page.render({
        canvas,
        viewport,
        annotationMode: AnnotationMode.ENABLE_FORMS,
        annotationCanvasMap,
        optionalContentConfigPromise: this.state.optionalContentConfigPromise ?? undefined,
        transform: deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
        background: "rgb(255, 255, 255)",
      });
      this.state.renderTask = renderTask;
      // Build every layer away from the visible page, then commit them together.
      // This keeps the previous page readable while PDF.js prepares the next one.
      textLayer = new TextLayerBuilder({ pdfPage: page });
      this.pendingTextLayer = textLayer;
      textLayer.div.id = "text-layer";
      textLayer.div.style.width = `${width}px`;
      textLayer.div.style.height = `${height}px`;
      textLayer.div.style.setProperty("--total-scale-factor", String(scale));
      textLayer.div.classList.toggle("is-box-selecting", this.state.selectionMode === "box");
      textLayer.div.setAttribute(
        "aria-label",
        this.state.selectionMode === "box" ? "Draw a box around PDF text" : "Select PDF text",
      );
      const textLayerPromise = textLayer.render({ viewport, images: undefined as never });
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
      annotationLayer = new AnnotationLayer({
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
      this.pendingAnnotationLayer = annotationLayer;
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

      this.state.textLayer?.cancel();
      this.state.annotationLayer?.destroy();
      this.elements.pageSurface.style.width = `${width}px`;
      this.elements.pageSurface.style.height = `${height}px`;
      this.elements.pageSurface.style.setProperty("--total-scale-factor", String(scale));
      this.elements.pageSurface.style.setProperty("--scale-round-x", "1px");
      this.elements.pageSurface.style.setProperty("--scale-round-y", "1px");
      this.elements.canvas.replaceWith(canvas);
      this.elements.canvas = canvas;
      this.elements.textLayer.replaceWith(textLayer.div);
      this.elements.textLayer = textLayer.div;
      this.elements.annotationLayer.replaceWith(annotationLayerElement);
      this.elements.annotationLayer = annotationLayerElement;
      this.state.renderTask = null;
      this.pendingTextLayer = null;
      this.pendingAnnotationLayer = null;
      this.state.textLayer = textLayer;
      this.state.annotationLayer = annotationLayer;
      this.state.annotationCanvasMap = annotationCanvasMap;
      committed = true;

      this.hideLoading();
      this.elements.readerError.hidden = true;
      this.elements.canvasFrame.hidden = false;
      this.elements.readerStage.scrollTo({ top: 0, left: 0 });
      this.updateControls();
      this.prefetchAdjacentPages(pdf, this.state.page);
    } catch (error) {
      if (isRenderingCancelled(error) || (error instanceof Error && error.name === "AbortException")) return;
      if (renderVersion === this.state.renderVersion) this.showError(error);
    } finally {
      if (!committed) {
        textLayer?.cancel();
        annotationLayer?.destroy();
      }
      if (this.state.renderTask === renderTask) this.state.renderTask = null;
      if (this.pendingTextLayer === textLayer) this.pendingTextLayer = null;
      if (this.pendingAnnotationLayer === annotationLayer) this.pendingAnnotationLayer = null;
      if (renderVersion === this.state.renderVersion) this.mainPageRendering = false;
    }
  }

  private prefetchAdjacentPages(pdf: PDFDocumentProxy, page: number): void {
    for (const candidate of [page - 1, page + 1]) {
      if (candidate >= 1 && candidate <= pdf.numPages) void pdf.getPage(candidate).catch(() => undefined);
    }
  }

  private async waitForThumbnailOpportunity(pdf: PDFDocumentProxy): Promise<boolean> {
    while (this.mainPageRendering && this.state.document === pdf) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 32));
    }
    if (this.state.document !== pdf) return false;
    await new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 300 });
      } else {
        window.setTimeout(resolve, 32);
      }
    });
    return !this.mainPageRendering && this.state.document === pdf;
  }

  private async renderThumbnails(pdf: PDFDocumentProxy): Promise<void> {
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
      const thumbnail = buttons[index]?.querySelector("canvas");
      if (!thumbnail) continue;
      let rendered = false;
      while (!rendered && this.state.document === pdf) {
        if (!await this.waitForThumbnailOpportunity(pdf)) continue;
        try {
          const page = await pdf.getPage(index + 1);
          if (this.mainPageRendering || this.state.document !== pdf) continue;
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 132 / natural.width });
          thumbnail.width = Math.floor(viewport.width);
          thumbnail.height = Math.floor(viewport.height);
          const renderTask = page.render({ canvas: thumbnail, viewport });
          this.thumbnailRenderTask = renderTask;
          await renderTask.promise;
          rendered = true;
        } catch (error) {
          if (!isRenderingCancelled(error)) break;
        } finally {
          this.thumbnailRenderTask = null;
        }
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

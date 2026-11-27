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
import { pagesRailStartsOpen } from "../lib/layout.ts";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  type PagePlacement,
  type VimScrollKey,
  clampPage,
  isVimScrollBoundary,
  nextZoom,
  readingProgress,
  rescaledScrollOffset,
  vimPageDelta,
  vimPagePlacement,
  vimScrollDelta,
  vimScrollProgress,
  zoomLabel,
} from "../lib/reader.ts";
import { ReaderPdfDownloadManager } from "./pdf-download-manager.ts";
import { ReaderPdfLinkService } from "./pdf-link-service.ts";

GlobalWorkerOptions.workerSrc = "/assets/pdf.worker.mjs";

const PAGE_RENDER_LOADING_DELAY_MS = 160;
// The width of a thumbnail in the rail, in CSS pixels.
const THUMBNAIL_WIDTH = 132;
// Draw thumbnails one rail-height beyond the visible ones so ordinary scrolling rarely shows a blank.
const THUMBNAIL_PRELOAD_MARGIN = "100% 0px";

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
  /** Called each time a page is put on screen, including a redraw of the same page. */
  onPageShown?: (page: number) => void;
  onToast: (message: string) => void;
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
  };

  private resizeTimer: number | undefined;
  private pageLoadingTimer: number | undefined;
  private openFileVersion = 0;
  private mainPageRendering = false;
  // The page whose canvas is on screen, so a redraw can be told apart from a page turn.
  private renderedPage: number | null = null;
  // Where the next newly shown page starts. Held here rather than passed to one render,
  // because a zoom step or layer toggle can replace that render before it finishes.
  private arrivalPlacement: PagePlacement = "start";
  private pendingTextLayer: TextLayerBuilder | null = null;
  private pendingAnnotationLayer: AnnotationLayer | null = null;
  private thumbnailRenderTask: RenderTask | null = null;
  private thumbnailObserver: IntersectionObserver | null = null;
  // Thumbnails near the visible part of the rail that still need drawing, oldest first.
  private readonly pendingThumbnails = new Set<HTMLButtonElement>();
  private thumbnailWorker: Promise<void> | null = null;
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
    this.elements.readerView.classList.toggle("sidebar-hidden", !pagesRailStartsOpen(window.innerWidth));
  }

  public async loadPdf(data: Uint8Array, filename: string, initialPage = 1): Promise<boolean> {
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
      this.state.page = clampPage(initialPage, pdf.numPages);
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

  public async goToPage(requestedPage: number, placement: PagePlacement = "start"): Promise<void> {
    const nextPage = clampPage(requestedPage, this.pageCount);
    if (!this.state.document || nextPage === this.state.page) {
      this.elements.pageInput.value = String(this.state.page);
      return;
    }
    this.state.page = nextPage;
    this.arrivalPlacement = placement;
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
        void this.goToPage(this.state.page + (key === "j" ? 1 : -1), vimPagePlacement(key));
        return;
      }
      this.animateVimScroll(key);
      return;
    }
    void this.goToPage(this.state.page + vimPageDelta(key));
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

  /** Open a local file and report whether it became the document on screen. */
  public async openFile(file: File): Promise<boolean> {
    const validationError = pdfFileValidationError(file);
    if (validationError) {
      this.callbacks.onToast(validationError);
      return false;
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
      return false;
    }
    if (openVersion !== this.openFileVersion) return false;

    // PDF.js may transfer this buffer to its worker. Nothing reuses it: saving
    // the session uploads the File again rather than holding a second copy.
    const loaded = await this.loadPdf(data, file.name);
    return loaded && openVersion === this.openFileVersion;
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
    window.addEventListener("resize", () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.refreshLayout();
      }, 180);
    });
  }

  /** Drop a text selection that belongs to a page or document no longer shown. */
  private clearSelection(): void {
    window.getSelection()?.removeAllRanges();
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
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    this.pendingThumbnails.clear();
    // A worker still winding down for the previous document must not hold up the next one.
    this.thumbnailWorker = null;
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
    this.renderedPage = null;
    this.arrivalPlacement = "start";
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
    // A document that never opened has no pages to list, so its rail would sit empty beside the message.
    if (!this.state.document) this.elements.readerView.classList.add("sidebar-hidden");
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
      textLayer.div.setAttribute("aria-label", "Select PDF text");
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

      // Redrawing the page already on screen (zoom, layout, layer visibility) must not lose the reader's place.
      const stage = this.elements.readerStage;
      const previousView = this.renderedPage === this.state.page && !this.elements.canvasFrame.hidden
        ? {
          top: stage.scrollTop,
          left: stage.scrollLeft,
          width: this.elements.pageSurface.offsetWidth,
          height: this.elements.pageSurface.offsetHeight,
          marginTop: this.elements.canvasFrame.offsetTop,
          marginLeft: this.elements.canvasFrame.offsetLeft,
        }
        : null;

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
      if (previousView) {
        stage.scrollTo({
          top: rescaledScrollOffset(previousView.top, previousView.height, height, previousView.marginTop),
          left: rescaledScrollOffset(previousView.left, previousView.width, width, previousView.marginLeft),
        });
      } else {
        stage.scrollTo({ top: this.arrivalPlacement === "end" ? stage.scrollHeight : 0, left: 0 });
      }
      this.arrivalPlacement = "start";
      this.renderedPage = this.state.page;
      this.updateControls();
      this.callbacks.onPageShown?.(this.state.page);
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

  /**
   * Build the page rail with a placeholder per page and draw a thumbnail only
   * once it nears the visible part of the rail, so a long document costs what
   * the reader actually looks at rather than one canvas render per page.
   */
  private async renderThumbnails(pdf: PDFDocumentProxy): Promise<void> {
    let placeholderWidth = THUMBNAIL_WIDTH;
    let placeholderHeight = Math.round(THUMBNAIL_WIDTH * Math.SQRT2);
    try {
      // Reserve each thumbnail's final size up front; drawing must not move the rail under the reader.
      const viewport = this.thumbnailViewport(await pdf.getPage(1));
      placeholderWidth = Math.floor(viewport.width);
      placeholderHeight = Math.floor(viewport.height);
    } catch {
      // The main view reports page failures; the rail keeps the default proportions.
    }
    if (this.state.document !== pdf) return;

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
      const canvas = document.createElement("canvas");
      canvas.width = placeholderWidth;
      canvas.height = placeholderHeight;
      wrapper.append(canvas);
      button.append(number, wrapper);
      buttons.push(button);
      fragment.append(button);
    }
    this.elements.thumbnailList.replaceChildren(fragment);

    if (typeof IntersectionObserver === "function") {
      this.thumbnailObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const button = entry.target as HTMLButtonElement;
          if (entry.isIntersecting) this.pendingThumbnails.add(button);
          // Scrolled past before its turn came: drop it rather than draw what is no longer near.
          else this.pendingThumbnails.delete(button);
        }
        this.drawPendingThumbnails(pdf);
      }, { root: this.elements.thumbnailList, rootMargin: THUMBNAIL_PRELOAD_MARGIN });
      for (const button of buttons) this.thumbnailObserver.observe(button);
    } else {
      for (const button of buttons) this.pendingThumbnails.add(button);
      this.drawPendingThumbnails(pdf);
    }
    this.updateActiveThumbnail();
  }

  /** Draw queued thumbnails one at a time, always yielding to main-page rendering. */
  private drawPendingThumbnails(pdf: PDFDocumentProxy): void {
    if (this.thumbnailWorker || this.state.document !== pdf) return;
    const worker = (async () => {
      while (this.state.document === pdf) {
        const button = this.pendingThumbnails.values().next().value;
        if (!button) return;
        if (!await this.waitForThumbnailOpportunity(pdf) || !this.pendingThumbnails.has(button)) continue;
        if (await this.drawThumbnail(pdf, button) === "interrupted") continue;
        this.pendingThumbnails.delete(button);
        this.thumbnailObserver?.unobserve(button);
      }
    })();
    this.thumbnailWorker = worker;
    void worker.finally(() => {
      if (this.thumbnailWorker !== worker) return;
      this.thumbnailWorker = null;
      if (this.pendingThumbnails.size > 0) this.drawPendingThumbnails(pdf);
    });
  }

  /**
   * The viewport a thumbnail is drawn through. Its canvas holds as many pixels as the
   * rail slot covers on this display, up to the density the main page uses, so a
   * thumbnail is not a stretched low-resolution image on a high-density screen.
   */
  private thumbnailViewport(page: PDFPageProxy): ReturnType<PDFPageProxy["getViewport"]> {
    const density = Math.min(window.devicePixelRatio || 1, 2);
    return page.getViewport({ scale: (THUMBNAIL_WIDTH * density) / page.getViewport({ scale: 1 }).width });
  }

  private async drawThumbnail(
    pdf: PDFDocumentProxy,
    button: HTMLButtonElement,
  ): Promise<"drawn" | "interrupted" | "failed"> {
    const thumbnail = button.querySelector("canvas");
    if (!thumbnail) return "failed";
    try {
      const page = await pdf.getPage(Number(button.dataset.page));
      if (this.mainPageRendering || this.state.document !== pdf) return "interrupted";
      const viewport = this.thumbnailViewport(page);
      thumbnail.width = Math.floor(viewport.width);
      thumbnail.height = Math.floor(viewport.height);
      const renderTask = page.render({ canvas: thumbnail, viewport });
      this.thumbnailRenderTask = renderTask;
      await renderTask.promise;
      return "drawn";
    } catch (error) {
      // The main page cancels thumbnail work to take priority; that thumbnail is simply tried again.
      return isRenderingCancelled(error) ? "interrupted" : "failed";
    } finally {
      this.thumbnailRenderTask = null;
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

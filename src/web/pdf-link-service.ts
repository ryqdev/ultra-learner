import type { PDFDocumentProxy } from "pdfjs-dist";

import {
  normalizePdfNamedAction,
  resolvePdfDestination,
  type PdfDestination,
} from "../lib/pdf-navigation.ts";

const EXTERNAL_LINK_REL = "noopener noreferrer nofollow";

interface PdfLinkReader {
  readonly page: number;
  readonly pageCount: number;
  goToDestination(page: number, explicitDestination: readonly unknown[]): Promise<void>;
  goToPage(page: number): Promise<void>;
  setOptionalContentState(action: unknown): Promise<void>;
}

export class ReaderPdfLinkService {
  public readonly eventBus = null;
  public readonly externalLinkEnabled = true;
  public readonly externalLinkTarget = null;
  public readonly externalLinkRel = EXTERNAL_LINK_REL;
  private document: PDFDocumentProxy | null = null;

  public constructor(
    private readonly reader: PdfLinkReader,
    private readonly onToast: (message: string) => void,
  ) {}

  public setDocument(document: PDFDocumentProxy | null): void {
    this.document = document;
  }

  public get pagesCount(): number {
    return this.reader.pageCount;
  }

  public get page(): number {
    return this.reader.page;
  }

  public set page(page: number) {
    void this.reader.goToPage(page);
  }

  public get rotation(): number {
    return 0;
  }

  public set rotation(_rotation: number) {}

  public get isInPresentationMode(): boolean {
    return false;
  }

  public async goToDestination(destination: PdfDestination | Promise<PdfDestination>): Promise<void> {
    const document = this.document;
    if (!document) return;
    const resolved = await resolvePdfDestination(document, await destination);
    if (!resolved || document !== this.document) {
      this.onToast("This link points to an unavailable PDF destination.");
      return;
    }
    await this.reader.goToDestination(resolved.page, resolved.explicitDestination);
  }

  public goToPage(value: number | string): void {
    const page = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isInteger(page)) {
      this.onToast("This link points to an unavailable PDF page.");
      return;
    }
    void this.reader.goToPage(page);
  }

  public goToXY(page: number, x: number, y: number): void {
    void this.reader.goToDestination(page, [null, { name: "XYZ" }, x, y, null]);
  }

  public addLinkAttributes(link: HTMLAnchorElement, url: string, _newWindow = false): void {
    link.href = url;
    link.title = url;
    link.target = "_blank";
    link.rel = EXTERNAL_LINK_REL;
  }

  public getDestinationHash(destination: PdfDestination): string {
    const encoded = typeof destination === "string" ? destination : JSON.stringify(destination);
    return `#pdf-destination=${encodeURIComponent(encoded)}`;
  }

  public getAnchorUrl(anchor: string): string {
    return anchor;
  }

  public executeNamedAction(action: string): void {
    switch (normalizePdfNamedAction(action)) {
      case "first":
        void this.reader.goToPage(1);
        return;
      case "last":
        void this.reader.goToPage(this.reader.pageCount);
        return;
      case "next":
        void this.reader.goToPage(this.reader.page + 1);
        return;
      case "previous":
        void this.reader.goToPage(this.reader.page - 1);
        return;
      case "unsupported":
        this.onToast(`The PDF action “${action}” is not available in this reader.`);
    }
  }

  public async executeSetOCGState(action: unknown): Promise<void> {
    await this.reader.setOptionalContentState(action);
  }

  public async getAttachmentContent(id: string): Promise<Uint8Array | null> {
    return await this.document?.getAttachmentContent(id) ?? null;
  }
}

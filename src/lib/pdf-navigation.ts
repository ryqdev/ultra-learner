export type PdfDestination = string | readonly unknown[];

interface PdfPageReference {
  num: number;
  gen: number;
}

export interface PdfDestinationDocument {
  numPages: number;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: PdfPageReference): Promise<number>;
}

export interface ResolvedPdfDestination {
  page: number;
  explicitDestination: readonly unknown[];
}

export type PdfNamedAction = "first" | "last" | "next" | "previous" | "unsupported";

function isPageReference(value: unknown): value is PdfPageReference {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<PdfPageReference>;
  return Number.isInteger(reference.num) && Number.isInteger(reference.gen);
}

export async function resolvePdfDestination(
  document: PdfDestinationDocument,
  destination: PdfDestination,
): Promise<ResolvedPdfDestination | null> {
  const explicitDestination = typeof destination === "string"
    ? await document.getDestination(destination)
    : destination;
  if (!Array.isArray(explicitDestination) || explicitDestination.length === 0) return null;

  const pageReference = explicitDestination[0];
  let pageIndex: number;
  if (Number.isInteger(pageReference)) {
    pageIndex = pageReference as number;
  } else if (isPageReference(pageReference)) {
    try {
      pageIndex = await document.getPageIndex(pageReference);
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const page = pageIndex + 1;
  if (!Number.isInteger(page) || page < 1 || page > document.numPages) return null;
  return { page, explicitDestination };
}

export function normalizePdfNamedAction(action: string): PdfNamedAction {
  switch (action) {
    case "FirstPage":
      return "first";
    case "LastPage":
      return "last";
    case "NextPage":
      return "next";
    case "PrevPage":
    case "PreviousPage":
      return "previous";
    default:
      return "unsupported";
  }
}

export type SelectionSource = "text" | "box";

export interface SelectionContext {
  text: string;
  page: number;
  source: SelectionSource;
}

/**
 * Normalizes text copied from PDF.js text runs. PDF text often contains
 * repeated whitespace and line breaks that are implementation details of the
 * text layer rather than useful context for a study question.
 */
export function normalizeSelectionText(value: string, maxLength = 8_000): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function createSelectionContext(
  text: string,
  page: number,
  source: SelectionSource,
): SelectionContext | null {
  const normalized = normalizeSelectionText(text);
  if (!normalized || !Number.isInteger(page) || page < 1) return null;
  return { text: normalized, page, source };
}

export function selectionLabel(selection: SelectionContext): string {
  return `${selection.source === "box" ? "Box" : "Text"} selection · page ${selection.page}`;
}

export function selectionPrompt(selection: SelectionContext): string {
  return `[Selected from page ${selection.page}]\n${selection.text}`;
}

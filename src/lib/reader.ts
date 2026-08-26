export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;
export const VIM_SCROLL_STEP = 140;

export type VimScrollKey = "j" | "k";
export type VimPageKey = "d" | "u";
export type ReaderKeyboardAction = "close-sidebar" | VimScrollKey | VimPageKey;

export interface ReaderKeyboardModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Return only shortcuts owned by the reader, leaving browser shortcuts untouched. */
export function readerKeyboardAction(
  key: string,
  modifiers: ReaderKeyboardModifiers,
): ReaderKeyboardAction | null {
  if (modifiers.altKey) return null;
  if (key === "Escape") return "close-sidebar";
  if (modifiers.metaKey || modifiers.ctrlKey) return null;
  if (key === "j" || key === "k" || key === "d" || key === "u") return key;
  return null;
}

/** Return the small vertical movement associated with Vim's line keys. */
export function vimScrollDelta(key: VimScrollKey): number {
  return key === "j" ? VIM_SCROLL_STEP : -VIM_SCROLL_STEP;
}

/** Return the document-page movement associated with Vim's page keys. */
export function vimPageDelta(key: VimPageKey): -1 | 1 {
  return key === "d" ? 1 : -1;
}

export function clampPage(page: number, pageCount: number): number {
  if (pageCount < 1) return 1;
  const safePage = Number.isFinite(page) ? page : 1;
  return Math.min(Math.max(Math.round(safePage), 1), pageCount);
}

export function clampZoom(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;
  return Math.min(Math.max(safeZoom, MIN_ZOOM), MAX_ZOOM);
}

export function nextZoom(current: number, direction: -1 | 1): number {
  return Number(clampZoom(current + direction * ZOOM_STEP).toFixed(2));
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

export function readingProgress(page: number, pageCount: number): number {
  if (pageCount < 1) return 0;
  return Math.round((clampPage(page, pageCount) / pageCount) * 100);
}

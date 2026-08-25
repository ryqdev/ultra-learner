export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;

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

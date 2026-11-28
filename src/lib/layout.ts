export const DEFAULT_CHAT_PANEL_WIDTH = 300;
export const MIN_CHAT_PANEL_WIDTH = 260;
export const MAX_CHAT_PANEL_WIDTH = 640;
export const MIN_READER_MAIN_WIDTH = 280;

/**
 * The widest viewport at which the Pages rail lies over the page instead of
 * taking a column of its own. `public/styles.css` switches the rail at the same width.
 */
export const PAGES_RAIL_OVERLAY_MAX_WIDTH = 1180;

/** The Pages rail starts open only where opening it cannot cover the page. */
export function pagesRailStartsOpen(viewportWidth: number): boolean {
  return viewportWidth > PAGES_RAIL_OVERLAY_MAX_WIDTH;
}

/** Keep the guide usable without crowding the main reading surface. */
export function clampChatPanelWidth(requestedWidth: number, availableWidth: number): number {
  const safeRequestedWidth = Number.isFinite(requestedWidth) ? requestedWidth : DEFAULT_CHAT_PANEL_WIDTH;
  const safeAvailableWidth = Number.isFinite(availableWidth) ? Math.max(availableWidth, 0) : Number.POSITIVE_INFINITY;
  const layoutMaximum = Math.max(
    MIN_CHAT_PANEL_WIDTH,
    Math.min(MAX_CHAT_PANEL_WIDTH, safeAvailableWidth - MIN_READER_MAIN_WIDTH),
  );

  return Math.round(Math.min(Math.max(safeRequestedWidth, MIN_CHAT_PANEL_WIDTH), layoutMaximum));
}

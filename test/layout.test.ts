import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  PAGES_RAIL_OVERLAY_MAX_WIDTH,
  clampChatPanelWidth,
  pagesRailStartsOpen,
} from "../src/lib/layout.ts";

describe("reader layout helpers", () => {
  test("keeps the resizable AI guide within the available reading layout", () => {
    expect(clampChatPanelWidth(180, 1_200)).toBe(MIN_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(480, 1_200)).toBe(480);
    expect(clampChatPanelWidth(900, 1_200)).toBe(MAX_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(500, 600)).toBe(320);
    expect(clampChatPanelWidth(Number.NaN, 1_200)).toBe(DEFAULT_CHAT_PANEL_WIDTH);
  });

  test("starts the Pages rail open only where it has a column of its own", () => {
    expect(pagesRailStartsOpen(1_440)).toBe(true);
    expect(pagesRailStartsOpen(PAGES_RAIL_OVERLAY_MAX_WIDTH + 1)).toBe(true);
    expect(pagesRailStartsOpen(PAGES_RAIL_OVERLAY_MAX_WIDTH)).toBe(false);
    expect(pagesRailStartsOpen(390)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
} from "../src/lib/layout.ts";

describe("reader layout helpers", () => {
  test("keeps the resizable AI guide within the available reading layout", () => {
    expect(clampChatPanelWidth(180, 1_200)).toBe(MIN_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(480, 1_200)).toBe(480);
    expect(clampChatPanelWidth(900, 1_200)).toBe(MAX_CHAT_PANEL_WIDTH);
    expect(clampChatPanelWidth(500, 600)).toBe(320);
    expect(clampChatPanelWidth(Number.NaN, 1_200)).toBe(DEFAULT_CHAT_PANEL_WIDTH);
  });
});

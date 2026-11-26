import { describe, expect, test } from "bun:test";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPage,
  clampZoom,
  isVimScrollBoundary,
  nextZoom,
  readerKeyboardAction,
  readingProgress,
  rescaledScrollOffset,
  VIM_SCROLL_DURATION_MS,
  VIM_SCROLL_STEP,
  vimPageDelta,
  vimPagePlacement,
  vimScrollDelta,
  vimScrollProgress,
  zoomLabel,
} from "../src/lib/reader.ts";

describe("reader state helpers", () => {
  test("keeps requested pages inside the document", () => {
    expect(clampPage(-4, 10)).toBe(1);
    expect(clampPage(4.6, 10)).toBe(5);
    expect(clampPage(99, 10)).toBe(10);
    expect(clampPage(Number.NaN, 10)).toBe(1);
    expect(clampPage(2, 0)).toBe(1);
  });

  test("keeps zoom inside the supported range", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(zoomLabel(1.24)).toBe("124%");
  });

  test("reports reading progress using the current page", () => {
    expect(readingProgress(1, 4)).toBe(25);
    expect(readingProgress(3, 4)).toBe(75);
    expect(readingProgress(8, 4)).toBe(100);
    expect(readingProgress(1, 0)).toBe(0);
  });

  test("maps Vim navigation keys to predictable movements", () => {
    expect(VIM_SCROLL_STEP).toBe(56);
    expect(vimScrollDelta("j")).toBe(56);
    expect(vimScrollDelta("k")).toBe(-56);
    expect(VIM_SCROLL_DURATION_MS).toBe(90);
    expect(vimScrollProgress(-1)).toBe(0);
    expect(vimScrollProgress(45)).toBeCloseTo(0.875);
    expect(vimScrollProgress(90)).toBe(1);
    expect(vimScrollProgress(180)).toBe(1);
    expect(vimPageDelta("d")).toBe(1);
    expect(vimPageDelta("u")).toBe(-1);
  });

  test("keeps the reading position when the same page is drawn at another size", () => {
    // 300px down a 1000px page with a 28px margin is 272px into the page.
    expect(rescaledScrollOffset(300, 1000, 1100, 28)).toBeCloseTo(28 + 272 * 1.1);
    expect(rescaledScrollOffset(300, 1000, 500, 28)).toBeCloseTo(28 + 136);
    expect(rescaledScrollOffset(300, 1000, 1000, 28)).toBe(300);
    // Still inside the margin above the page: nothing to rescale.
    expect(rescaledScrollOffset(20, 1000, 2000, 28)).toBe(20);
    expect(rescaledScrollOffset(0, 1000, 2000)).toBe(0);
    expect(rescaledScrollOffset(300, 0, 1100)).toBe(0);
    expect(rescaledScrollOffset(Number.NaN, 1000, 1100)).toBe(0);
  });

  test("continues a line scroll onto the adjoining edge of the next page", () => {
    expect(vimPagePlacement("j")).toBe("start");
    expect(vimPagePlacement("k")).toBe("end");
  });

  test("leaves browser zoom shortcuts unhandled", () => {
    expect(readerKeyboardAction("+", { metaKey: true })).toBeNull();
    expect(readerKeyboardAction("=", { metaKey: true })).toBeNull();
    expect(readerKeyboardAction("-", { metaKey: true })).toBeNull();
    expect(readerKeyboardAction("+", { ctrlKey: true })).toBeNull();
  });

  test("recognizes only unmodified reader navigation shortcuts", () => {
    expect(readerKeyboardAction("Escape", {})).toBe("close-sidebar");
    expect(readerKeyboardAction("j", {})).toBe("j");
    expect(readerKeyboardAction("d", {})).toBe("d");
    expect(readerKeyboardAction("j", { metaKey: true })).toBeNull();
    expect(readerKeyboardAction("d", { altKey: true })).toBeNull();
  });

  test("detects the viewport edge for Vim scroll keys", () => {
    expect(isVimScrollBoundary("j", 600, 400, 1000)).toBe(true);
    expect(isVimScrollBoundary("j", 599, 400, 1000)).toBe(false);
    expect(isVimScrollBoundary("k", 0, 400, 1000)).toBe(true);
    expect(isVimScrollBoundary("k", 1, 400, 1000)).toBe(false);
    expect(isVimScrollBoundary("j", 0, 400, 400)).toBe(true);
    expect(isVimScrollBoundary("k", 0, 400, 400)).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";

import {
  normalizePdfNamedAction,
  resolvePdfDestination,
  type PdfDestinationDocument,
} from "../src/lib/pdf-navigation.ts";

function destinationDocument(namedDestination: unknown[] | null = null): PdfDestinationDocument {
  return {
    numPages: 6,
    getDestination: async () => namedDestination,
    getPageIndex: async ({ num }) => num === 42 ? 3 : -1,
  };
}

describe("PDF link navigation", () => {
  test("resolves explicit zero-based page destinations", async () => {
    const destination = [2, { name: "Fit" }];

    expect(await resolvePdfDestination(destinationDocument(), destination)).toEqual({
      page: 3,
      explicitDestination: destination,
    });
  });

  test("resolves named destinations and indirect page references", async () => {
    const destination = [{ num: 42, gen: 0 }, { name: "XYZ" }, 20, 700, null];

    expect(await resolvePdfDestination(destinationDocument(destination), "chapter-two")).toEqual({
      page: 4,
      explicitDestination: destination,
    });
  });

  test("rejects missing, malformed, and out-of-range destinations", async () => {
    expect(await resolvePdfDestination(destinationDocument(), "missing")).toBeNull();
    expect(await resolvePdfDestination(destinationDocument(), [99, { name: "Fit" }])).toBeNull();
    expect(await resolvePdfDestination(destinationDocument(), [{ num: 7, gen: 0 }])).toBeNull();
  });

  test("normalizes the page actions emitted by PDF annotations", () => {
    expect(normalizePdfNamedAction("FirstPage")).toBe("first");
    expect(normalizePdfNamedAction("LastPage")).toBe("last");
    expect(normalizePdfNamedAction("NextPage")).toBe("next");
    expect(normalizePdfNamedAction("PrevPage")).toBe("previous");
    expect(normalizePdfNamedAction("Print")).toBe("unsupported");
  });
});

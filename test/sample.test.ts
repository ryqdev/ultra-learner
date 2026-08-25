import { expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { createSamplePdf } from "../src/web/sample.ts";

test("creates a parseable, self-contained four-page PDF sample", async () => {
  const sample = createSamplePdf();
  const source = new TextDecoder().decode(sample);

  expect(source.startsWith("%PDF-1.7\n")).toBe(true);
  expect(source).toContain("/Type /Pages");
  expect(source).toContain("/Count 4");
  expect(source).toContain("(The shape)");
  expect(source).toContain("(of attention)");
  expect(source.endsWith("%%EOF\n")).toBe(true);

  const loadingTask = getDocument({ data: sample, disableFontFace: true });
  const document = await loadingTask.promise;
  expect(document.numPages).toBe(4);
  expect((await document.getPage(1)).getViewport({ scale: 1 }).width).toBe(612);
  await loadingTask.destroy();
});

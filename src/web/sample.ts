const encoder = new TextEncoder();

interface PdfPageContent {
  heading: string;
  eyebrow: string;
  quote: string;
  body: string[];
  accent: [number, number, number];
}

const pages: PdfPageContent[] = [
  {
    eyebrow: "FIELD GUIDE / 01",
    heading: "The shape of attention",
    quote: "What we choose to notice becomes the texture of our days.",
    body: [
      "Attention is not a spotlight that simply lands on the world. It is a practice: a series of small choices about what deserves another moment.",
      "Deep reading gives those choices a place to settle. Slow down, leave a mark, return to the sentence that resisted you.",
    ],
    accent: [0.91, 0.51, 0.41],
  },
  {
    eyebrow: "FIELD GUIDE / 02",
    heading: "Read in questions",
    quote: "A useful question turns a page into a conversation.",
    body: [
      "Before a chapter, write one thing you hope to understand. While reading, collect evidence instead of highlights. Afterward, answer in your own words.",
      "The goal is not to preserve every sentence. It is to build a path you can walk again.",
    ],
    accent: [0.22, 0.48, 0.4],
  },
  {
    eyebrow: "FIELD GUIDE / 03",
    heading: "Leave a trace",
    quote: "Learning becomes durable when an idea changes form.",
    body: [
      "Summarize a page in one sentence. Sketch the relationship between two ideas. Explain the difficult part as if you were writing to a friend.",
      "A trace does not need to be polished. It only needs to prove that the idea passed through you.",
    ],
    accent: [0.77, 0.69, 0.32],
  },
  {
    eyebrow: "FIELD GUIDE / 04",
    heading: "Return with purpose",
    quote: "Review is not repetition; it is a second encounter.",
    body: [
      "Come back after a day and ask what remained. Revisit only the gaps. Each return should be shorter, more selective, and more active than the first reading.",
      "Close the document with one next action. Knowledge grows when it has somewhere to go.",
    ],
    accent: [0.91, 0.51, 0.41],
  },
];

function escapePdfText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrapLine(value: string, maxLength = 78): string[] {
  const words = value.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function pageStream(page: PdfPageContent, pageNumber: number): string {
  const [red, green, blue] = page.accent;
  const titleWords = page.heading.split(" ");
  const splitAt = Math.ceil(titleWords.length / 2);
  const titleLines = [titleWords.slice(0, splitAt).join(" "), titleWords.slice(splitAt).join(" ")].filter(Boolean);
  const commands = [
    "q",
    "0.976 0.965 0.929 rg",
    "0 0 612 792 re f",
    `${red} ${green} ${blue} rg`,
    "52 711 42 4 re f",
    "0.15 0.31 0.27 rg",
    `BT /F1 9 Tf 1 0 0 1 52 730 Tm (${escapePdfText(page.eyebrow)}) Tj ET`,
  ];

  titleLines.forEach((line, index) => {
    commands.push(`BT /F2 43 Tf 1 0 0 1 52 ${665 - index * 48} Tm (${escapePdfText(line)}) Tj ET`);
  });

  commands.push(
    `${red} ${green} ${blue} RG`,
    "1.3 w",
    "52 544 m 560 544 l S",
    "0.15 0.31 0.27 rg",
    `BT /F3 17 Tf 1 0 0 1 73 496 Tm (${escapePdfText(page.quote)}) Tj ET`,
    `${red} ${green} ${blue} RG`,
    "3 w",
    "52 512 m 52 465 l S",
  );

  let y = 405;
  for (const paragraph of page.body) {
    for (const line of wrapLine(paragraph)) {
      commands.push(`BT /F1 11 Tf 1 0 0 1 52 ${y} Tm (${escapePdfText(line)}) Tj ET`);
      y -= 18;
    }
    y -= 16;
  }

  commands.push(
    "0.15 0.31 0.27 RG",
    "0.6 w",
    "52 69 m 560 69 l S",
    "0.15 0.31 0.27 rg",
    "BT /F1 8 Tf 1 0 0 1 52 47 Tm (ULTRA LEARNER / READ WITH INTENTION) Tj ET",
    `BT /F1 8 Tf 1 0 0 1 535 47 Tm (${String(pageNumber).padStart(2, "0")}) Tj ET`,
    "Q",
  );

  return commands.join("\n");
}

export function createSamplePdf(): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 6 + index * 3);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(next-section) [9 0 R /Fit]] >> >> >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>";

  pages.forEach((page, index) => {
    const pageObject = pageObjectNumbers[index]!;
    const contentObject = pageObject + 1;
    const annotationObject = pageObject + 2;
    const stream = pageStream(page, index + 1);
    const streamLength = encoder.encode(stream).byteLength;
    const target = index === pages.length - 1 ? pageObjectNumbers[0]! : pageObjectNumbers[index + 1]!;
    const destination = index === 0 ? "(next-section)" : `[${target} 0 R /Fit]`;
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Annots [${annotationObject} 0 R] /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`;
    objects[annotationObject] = `<< /Type /Annot /Subtype /Link /Rect [45 30 567 78] /Border [0 0 0] /Dest ${destination} >>`;
  });

  let pdf = "%PDF-1.7\n% ultra-learner\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = encoder.encode(pdf).byteLength;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(pdf);
}

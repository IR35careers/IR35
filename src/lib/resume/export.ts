import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
// The standalone build embeds PDFKit's standard font metrics. This avoids
// filesystem lookups that break in bundled serverless/Next.js runtimes.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import { resolveCandidateName } from "@/lib/candidate-name";
import type { ResumeExportRequest } from "@/lib/resume/types";
import { normaliseResumeText } from "@/lib/resume/normalise-text";

const SECTION_HEADING = /^(profile|professional profile|summary|professional summary|skills|technical skills|core skills|experience|professional experience|employment|career history|education|qualifications|certifications?|projects?|verified role skills)$/i;

function normaliseExportText(value: string): string {
  return normaliseResumeText(value).replace(/\n{4,}/g, "\n\n\n");
}

function isHeading(line: string): boolean {
  const value = line.trim();
  return SECTION_HEADING.test(value) || (/^[A-Z][A-Z &/+-]{2,}$/.test(value) && value.length <= 42);
}

function safeCandidateName(request: ResumeExportRequest): string {
  const resolved = resolveCandidateName(request.candidateName, request.resumeText);
  if (resolved) return resolved;
  throw new Error("A candidate name is required before exporting the CV.");
}

function bodyLines(request: ResumeExportRequest): string[] {
  const lines = normaliseExportText(request.resumeText).split("\n");
  const name = safeCandidateName(request).toLocaleLowerCase("en-GB");
  const firstContentIndex = lines.findIndex((line) => line.trim().toLocaleLowerCase("en-GB") !== name);
  return firstContentIndex === -1 ? [] : lines.slice(firstContentIndex);
}

export async function buildResumeDocx(request: ResumeExportRequest): Promise<Buffer> {
  const name = safeCandidateName(request);
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: name, bold: true, size: 34, color: "087A5B", font: "Arial" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, color: "A7F3D0", size: 10, space: 10 } },
      children: [],
    }),
  ];

  for (const rawLine of bodyLines(request)) {
    const line = rawLine.trim();
    if (!line) {
      children.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    if (isHeading(line)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 260, after: 100 },
          keepNext: true,
          children: [new TextRun({ text: line.toLocaleUpperCase("en-GB"), bold: true, color: "096048", size: 21, font: "Arial" })],
        })
      );
      continue;
    }
    if (/^[•*-]\s+/.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80, line: 286 },
          children: [new TextRun({ text: line.replace(/^[•*-]\s+/, ""), size: 20, color: "1E293B", font: "Arial" })],
        })
      );
      continue;
    }
    children.push(
      new Paragraph({
        spacing: { after: 100, line: 286 },
        children: [new TextRun({ text: line, size: 20, color: "1E293B", font: "Arial" })],
      })
    );
  }

  const document = new Document({
    creator: name,
    title: `${name} - CV`,
    description: "Curriculum Vitae",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20, color: "1E293B" }, paragraph: { spacing: { line: 286 } } },
        heading1: { run: { font: "Arial", size: 21, bold: true, color: "096048" } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 900, right: 1050, bottom: 900, left: 1050 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 120 },
                children: [
                  new TextRun({ text: "Page ", color: "64748B", size: 16, font: "Arial" }),
                  new TextRun({ children: [PageNumber.CURRENT], color: "64748B", size: 16, font: "Arial" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

function pdfSafe(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}

export async function buildResumePdf(request: ResumeExportRequest): Promise<Buffer> {
  const name = safeCandidateName(request);
  const chunks: Buffer[] = [];
  const document = new PDFDocument({
    size: "A4",
    margins: { top: 48, right: 54, bottom: 54, left: 54 },
    bufferPages: true,
    info: {
      Title: `${name} - CV`,
      Author: name,
      Subject: "Curriculum Vitae",
    },
  });
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.font("Helvetica-Bold").fontSize(22).fillColor("#087A5B").text(pdfSafe(name), { align: "center" });
  document.moveDown(0.65);
  document.strokeColor("#A7F3D0").lineWidth(1.2).moveTo(54, document.y).lineTo(541, document.y).stroke();
  document.moveDown(0.8);

  for (const rawLine of bodyLines(request)) {
    const line = rawLine.trim();
    if (!line) {
      document.moveDown(0.45);
      continue;
    }
    if (isHeading(line)) {
      document.moveDown(0.55);
      document.font("Helvetica-Bold").fontSize(10.5).fillColor("#096048").text(pdfSafe(line.toLocaleUpperCase("en-GB")), {
        characterSpacing: 0.7,
      });
      document.moveDown(0.3);
      continue;
    }
    const bullet = /^[•*-]\s+/.test(line);
    document.font("Helvetica").fontSize(9.6).fillColor("#1E293B");
    document.text(pdfSafe(bullet ? `- ${line.replace(/^[•*-]\s+/, "")}` : line), {
      indent: bullet ? 12 : 0,
      lineGap: 2.3,
      paragraphGap: 4,
    });
  }

  const range = document.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document.switchToPage(page);
    const originalBottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 18;
    document
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#64748B")
      .text(pdfSafe(`Page ${page + 1} of ${range.count}`), 54, 811, {
        width: 487,
        align: "center",
        lineBreak: false,
      });
    document.page.margins.bottom = originalBottomMargin;
  }

  document.end();
  return completed;
}

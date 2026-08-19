import { NextResponse } from "next/server";
import mammoth from "mammoth";
import JSZip from "jszip";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 150_000;
const MAX_PDF_PAGES = 50;
const MAX_DOCX_ENTRIES = 1_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return errorResponse("Choose a PDF, DOCX or text CV.");
    if (file.size === 0) return errorResponse("That file is empty.");
    if (file.size > MAX_BYTES) return errorResponse("CV must be under 5MB.", 413);

    const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-GB");
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";
    let pageCount: number | null = null;
    const warnings: string[] = [];

    if (extension === "pdf" || file.type === "application/pdf") {
      if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return errorResponse("That file is not a valid PDF.");
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      if (pdf.numPages > MAX_PDF_PAGES) {
        return errorResponse(`PDFs are limited to ${MAX_PDF_PAGES} pages.`, 413);
      }
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text;
      pageCount = extracted.totalPages;
    } else if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      if (buffer.subarray(0, 2).toString("ascii") !== "PK") return errorResponse("That file is not a valid DOCX.");
      const archive = await JSZip.loadAsync(buffer);
      const entries = Object.values(archive.files);
      if (!archive.file("word/document.xml")) return errorResponse("That file is not a readable Word document.");
      if (entries.length > MAX_DOCX_ENTRIES) return errorResponse("That Word document contains too many embedded parts.", 413);
      const expandedBytes = entries.reduce((total, entry) => {
        const internal = entry as typeof entry & { _data?: { uncompressedSize?: number } };
        return total + (internal._data?.uncompressedSize ?? 0);
      }, 0);
      if (expandedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) return errorResponse("That Word document expands beyond the safe processing limit.", 413);
      const extracted = await mammoth.extractRawText({ buffer });
      text = extracted.value;
      warnings.push(...extracted.messages.map((message) => message.message).filter(Boolean));
    } else if (extension === "txt" || file.type === "text/plain") {
      text = buffer.toString("utf8");
    } else if (extension === "doc") {
      return errorResponse("Older .doc files cannot be read safely. Save it as .docx or PDF, then try again.");
    } else {
      return errorResponse("Use a PDF, DOCX or plain-text CV.");
    }

    text = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
    if (!text) return errorResponse("No readable text was found. If this is a scanned PDF, paste the CV text instead.", 422);
    if (text.length > MAX_TEXT_CHARS) return errorResponse("This CV contains too much text to analyse safely.", 413);

    return NextResponse.json(
      { text, filename: file.name, pageCount, warnings: warnings.slice(0, 5) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return errorResponse("We could not read that CV. Try a different PDF/DOCX or paste the text.", 422);
  }
}

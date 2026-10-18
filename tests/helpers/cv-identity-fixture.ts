import PDFDocument from "pdfkit";

/** Synthetic bytes only: no original contractor document or personal record. */
export function spacedIdentityPdf(kind: "literal spaces" | "PDF glyph spacing" = "PDF glyph spacing"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    // Paint order differs from reading order, as can happen in designed CVs.
    doc.text("Cloud Platforms", 40, 100);
    doc.text("RBAC, IAM", 40, 120);
    doc.text(kind === "literal spaces" ? "A L E X   M O R G A N" : "Alex Morgan", 40, 40,
      { characterSpacing: kind === "PDF glyph spacing" ? 4 : 0 });
    doc.text("Senior DevOps Engineer", 40, 70);
    doc.text("alex@example.com | Bristol, UK", 40, 145);
    doc.text("TECHNICAL SKILLS", 40, 175);
    doc.text("AWS, Terraform, Kubernetes", 40, 200);
    doc.end();
  });
}

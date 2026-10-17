import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailMessageBody } from "@/components/workspace/EmailMessageBody";
import {
  emailMessagePreview,
  parseEmailDisplayContent,
} from "@/lib/email/message-display";

describe("email message display", () => {
  it("turns a labelled image URL into an image without duplicate label text", () => {
    expect(
      parseEmailDisplayContent(
        "VIQU logo\n[https://viqu.co.uk/wp-content/uploads/2020/02/VIQU-Logo-RGB-POS-1-300x67.png]",
      ),
    ).toEqual([
      {
        kind: "image",
        src: "https://viqu.co.uk/wp-content/uploads/2020/02/VIQU-Logo-RGB-POS-1-300x67.png",
        alt: "VIQU logo",
      },
    ]);
  });

  it("turns bracketed and bare URLs into safe, readable links", () => {
    const blocks = parseEmailDisplayContent(
      "Visit our website\n[http://email.mg.viqu.co.uk/c/abc123]\n\nQuestions: https://viqu.co.uk/contact.",
    );

    expect(blocks).toEqual([
      {
        kind: "paragraph",
        content: [{ kind: "text", value: "Visit our website" }],
      },
      {
        kind: "paragraph",
        content: [
          {
            kind: "link",
            href: "http://email.mg.viqu.co.uk/c/abc123",
            label: "Open email.mg.viqu.co.uk",
          },
        ],
      },
      {
        kind: "paragraph",
        content: [
          { kind: "text", value: "Questions: " },
          {
            kind: "link",
            href: "https://viqu.co.uk/contact",
            label: "Open viqu.co.uk",
          },
          { kind: "text", value: "." },
        ],
      },
    ]);
  });

  it("does not promote non-http content into a link", () => {
    expect(parseEmailDisplayContent("Use [javascript:alert(1)] only as text."))
      .toEqual([
        {
          kind: "paragraph",
          content: [{ kind: "text", value: "Use [javascript:alert(1)] only as text." }],
        },
      ]);
  });

  it("removes image-only content and shortens links in message previews", () => {
    expect(
      emailMessagePreview(
        "VIQU logo\n[https://viqu.co.uk/logo.png]\n\nThank you for applying.\n[https://email.mg.viqu.co.uk/c/a-very-long-tracking-link]",
      ),
    ).toBe("Thank you for applying. Open email.mg.viqu.co.uk");
  });

  it("renders employer images and links as interactive inbox content", () => {
    const markup = renderToStaticMarkup(
      createElement(EmailMessageBody, {
        body: "VIQU logo\n[https://viqu.co.uk/logo.png]\n\nVisit [https://viqu.co.uk/jobs]",
      }),
    );

    expect(markup).toContain('<img src="https://viqu.co.uk/logo.png"');
    expect(markup).toContain('href="https://viqu.co.uk/jobs"');
    expect(markup).toContain("Open viqu.co.uk");
    expect(markup).not.toContain("[https://viqu.co.uk/jobs]");
  });
});

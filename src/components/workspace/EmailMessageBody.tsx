"use client";

import { useMemo, useState } from "react";
import { ExternalLink, ImageIcon } from "lucide-react";
import { parseEmailDisplayContent } from "@/lib/email/message-display";

function EmailImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer noopener"
        className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-brand-800 hover:border-brand-300 hover:bg-brand-50"
      >
        <ImageIcon size={15} aria-hidden="true" /> View {alt.toLowerCase()}
        <ExternalLink size={13} aria-hidden="true" />
      </a>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer noopener"
      className="ir35-focus inline-flex max-w-full rounded-xl border border-slate-100 bg-white p-2 transition-colors hover:border-brand-200"
      aria-label={`Open ${alt}`}
    >
      {/* Email images are remote sender assets, so they cannot use the fixed Next.js image host list. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="max-h-20 max-w-full object-contain"
      />
    </a>
  );
}

export function EmailMessageBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseEmailDisplayContent(body), [body]);

  return (
    <div className="space-y-5 text-sm leading-7 text-slate-700">
      {blocks.map((block, blockIndex) =>
        block.kind === "image" ? (
          <EmailImage
            key={`image-${block.src}-${blockIndex}`}
            src={block.src}
            alt={block.alt}
          />
        ) : (
          <p key={`paragraph-${blockIndex}`} className="whitespace-pre-line break-words">
            {block.content.map((item, itemIndex) =>
              item.kind === "text" ? (
                item.value
              ) : (
                <a
                  key={`${item.href}-${itemIndex}`}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ir35-focus inline-flex items-center gap-1 font-semibold text-brand-800 underline decoration-brand-300 underline-offset-4 hover:text-brand-950"
                >
                  {item.label}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              ),
            )}
          </p>
        ),
      )}
    </div>
  );
}


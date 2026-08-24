import { parseResumeText } from "@/lib/resume/analysis";

function cleanDisplayLine(value: string): string {
  return value.replace(/^\s*[•*-]\s*/, "").replace(/\s+/g, " ").trim();
}

function isBullet(value: string): boolean {
  return /^\s*[•*-]\s+/.test(value);
}

function ContentLine({ line, index }: { line: string; index: number }) {
  const clean = cleanDisplayLine(line);
  if (!clean) return <div className="h-2" aria-hidden="true" />;
  if (isBullet(line)) {
    return (
      <p className="flex gap-2 text-[12px] leading-[1.55] text-slate-800">
        <span aria-hidden="true">•</span>
        <span>{clean}</span>
      </p>
    );
  }

  const labelled = clean.match(/^([^:]{2,42}):\s*(.+)$/);
  if (labelled) {
    return (
      <p className="text-[12px] leading-[1.55] text-slate-800">
        <strong className="font-bold text-slate-950">{labelled[1]}:</strong>{" "}
        {labelled[2]}
      </p>
    );
  }

  const looksLikeRoleLine =
    /\b(?:19|20)\d{2}\b/.test(clean) ||
    (clean.includes("|") && index === 0);
  return (
    <p
      className={`text-[12px] leading-[1.55] text-slate-800 ${
        looksLikeRoleLine ? "font-semibold text-slate-950" : ""
      }`}
    >
      {clean}
    </p>
  );
}

export function ResumeDocumentPreview({
  resumeText,
  filename,
}: {
  resumeText: string;
  filename: string;
}) {
  const parsed = parseResumeText(resumeText, filename);
  const normalisedName = parsed.candidateName.trim().toLocaleLowerCase("en-GB");
  const normalisedContact = parsed.contactLine.trim().toLocaleLowerCase("en-GB");

  const sections = parsed.sections
    .map((section) => ({
      ...section,
      lines: section.content
        .split("\n")
        .filter((line, index) => {
          const normalised = line.trim().toLocaleLowerCase("en-GB");
          if (normalised === normalisedName) return false;
          if (normalisedContact && normalised === normalisedContact) return false;
          return index > 0 || normalised.length > 0;
        }),
    }))
    .filter((section) => section.lines.some((line) => line.trim()));

  const firstSection = sections[0];
  const headerDetail =
    firstSection?.title === "Profile" && firstSection.kind === "other"
      ? firstSection.lines.find((line) => {
          const clean = cleanDisplayLine(line);
          return clean.length > 0 && !/@|linkedin|\+?\d[\d ()-]{7,}/i.test(clean);
        })
      : undefined;

  return (
    <article className="mx-auto min-h-[1020px] w-full max-w-[820px] bg-white px-8 py-10 text-slate-950 shadow-[0_18px_55px_rgba(15,23,42,0.14)] sm:px-12 sm:py-12 lg:px-16">
      <header className="text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-950">
          {parsed.candidateName}
        </h2>
        {headerDetail && (
          <p className="mt-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-600">
            {cleanDisplayLine(headerDetail)}
          </p>
        )}
        {parsed.contactLine && (
          <p className="mx-auto mt-2 max-w-2xl text-[11px] leading-5 text-slate-700">
            {parsed.contactLine}
          </p>
        )}
      </header>

      <div className="mt-7 space-y-6">
        {sections.map((section, sectionIndex) => {
          const visibleLines = section.lines.filter(
            (line) =>
              !(
                sectionIndex === 0 &&
                headerDetail &&
                cleanDisplayLine(line) === cleanDisplayLine(headerDetail)
              ),
          );
          if (visibleLines.every((line) => !line.trim())) return null;
          const title =
            section.title === "Profile" && section.kind === "other"
              ? "Professional profile"
              : section.title;
          return (
            <section key={`${section.title}-${sectionIndex}`}>
              <h3 className="border-b border-slate-950 pb-1 text-[13px] font-bold uppercase tracking-[0.04em] text-slate-950">
                {title}
              </h3>
              <div className="mt-2 space-y-1">
                {visibleLines.map((line, lineIndex) => (
                  <ContentLine
                    key={`${sectionIndex}-${lineIndex}`}
                    line={line}
                    index={lineIndex}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

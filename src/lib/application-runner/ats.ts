export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "workday" | "generic";

export interface AtsDefinition {
  kind: AtsKind;
  label: string;
  applyPattern: RegExp;
  nextPattern: RegExp;
  submitPattern: RegExp;
  successPattern: RegExp;
}

const COMMON = {
  applyPattern: /^(apply|apply now|apply for this job|start application|continue application)$/i,
  nextPattern: /^(next|continue|save and continue|continue application)$/i,
  submitPattern: /^(submit|submit application|send application|apply now|complete application)$/i,
  successPattern: /(application (?:has been )?(?:submitted|received)|thank you for applying|we(?:'|’)ve received your application|application complete)/i,
};

const DEFINITIONS: Record<AtsKind, AtsDefinition> = {
  greenhouse: { kind: "greenhouse", label: "Greenhouse", ...COMMON },
  lever: { kind: "lever", label: "Lever", ...COMMON },
  ashby: { kind: "ashby", label: "Ashby", ...COMMON },
  workable: { kind: "workable", label: "Workable", ...COMMON },
  smartrecruiters: { kind: "smartrecruiters", label: "SmartRecruiters", ...COMMON },
  workday: { kind: "workday", label: "Workday", ...COMMON },
  generic: { kind: "generic", label: "Employer application portal", ...COMMON },
};

export function detectAts(value: string): AtsDefinition {
  const host = new URL(value).hostname.toLowerCase();
  if (/(greenhouse\.io|greenhouse\.com)$/.test(host)) return DEFINITIONS.greenhouse;
  if (/(lever\.co|lever\.com)$/.test(host)) return DEFINITIONS.lever;
  if (/(ashbyhq\.com)$/.test(host)) return DEFINITIONS.ashby;
  if (/(workable\.com)$/.test(host)) return DEFINITIONS.workable;
  if (/(smartrecruiters\.com)$/.test(host)) return DEFINITIONS.smartrecruiters;
  if (/(myworkdayjobs\.com|workday\.com)$/.test(host)) return DEFINITIONS.workday;
  return DEFINITIONS.generic;
}

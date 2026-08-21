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

const ATS_DOMAINS: Array<{ domain: string; kind: Exclude<AtsKind, "generic"> }> = [
  { domain: "greenhouse.io", kind: "greenhouse" },
  { domain: "greenhouse.com", kind: "greenhouse" },
  { domain: "lever.co", kind: "lever" },
  { domain: "lever.com", kind: "lever" },
  { domain: "ashbyhq.com", kind: "ashby" },
  { domain: "workable.com", kind: "workable" },
  { domain: "smartrecruiters.com", kind: "smartrecruiters" },
  { domain: "myworkdayjobs.com", kind: "workday" },
  { domain: "workday.com", kind: "workday" },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function nativeRunnerHostAllowed(value: string): boolean {
  const host = (value.includes("://") ? new URL(value).hostname : value).toLowerCase().replace(/\.$/, "");
  if (ATS_DOMAINS.some(({ domain }) => hostMatches(host, domain))) return true;
  if (host === "ir35careers.com" || host === "www.ir35careers.com") return true;
  const configured = (process.env.APPLICATION_RUNNER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  return configured.includes(host);
}

export function detectAts(value: string): AtsDefinition {
  const host = new URL(value).hostname.toLowerCase();
  const match = ATS_DOMAINS.find(({ domain }) => hostMatches(host, domain));
  if (match) return DEFINITIONS[match.kind];
  return DEFINITIONS.generic;
}

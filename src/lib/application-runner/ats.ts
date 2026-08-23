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
  applyPattern: /^(apply|apply now|apply online|apply for this (?:job|position|role)|start application|continue application|begin application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|continue application|review|review application|review and submit)$/i,
  submitPattern: /^(submit|submit (?:my|your)? ?application|send application|apply now|finish application|complete application|confirm and submit)$/i,
  successPattern: /(application (?:has been )?(?:submitted|received|sent)|thank you for (?:your )?application|thank you for applying|we(?:['’]ve| have) received your application|application complete|successfully applied)/i,
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
  { domain: "myworkday.com", kind: "workday" },
  { domain: "workday.com", kind: "workday" },
];

const ATS_SENDER_DOMAINS: Record<Exclude<AtsKind, "generic">, string[]> = {
  greenhouse: ["greenhouse.io", "greenhouse.com"],
  lever: ["lever.co", "lever.com"],
  ashby: ["ashbyhq.com"],
  workable: ["workable.com", "workablemail.com"],
  smartrecruiters: ["smartrecruiters.com"],
  workday: ["workday.com", "myworkday.com", "myworkdayjobs.com"],
};

// These are job-discovery handoff pages rather than employer ATS products.
// The runner may open them and follow their public Apply action, but it still
// sends candidate data only to hosts approved by the request guard.
const JOB_BOARD_DOMAINS = [
  "adzuna.co.uk",
  "reed.co.uk",
  "cv-library.co.uk",
] as const;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function nativeRunnerHostAllowed(value: string): boolean {
  const host = (value.includes("://") ? new URL(value).hostname : value).toLowerCase().replace(/\.$/, "");
  if (ATS_DOMAINS.some(({ domain }) => hostMatches(host, domain))) return true;
  if (JOB_BOARD_DOMAINS.some((domain) => hostMatches(host, domain))) return true;
  if (host === "ir35careers.com" || host === "www.ir35careers.com") return true;
  const configured = (process.env.APPLICATION_RUNNER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  return configured.includes(host);
}

export function isSafeApplicationHandoffNavigation(input: {
  url: string;
  method: string;
  resourceType: string;
  isNavigationRequest: boolean;
  isTopLevel: boolean;
  sensitive: boolean;
}): boolean {
  if (
    input.sensitive ||
    input.method !== "GET" ||
    input.resourceType !== "document" ||
    !input.isNavigationRequest ||
    !input.isTopLevel
  )
    return false;
  try {
    const parsed = new URL(input.url);
    return parsed.protocol === "https:" && (!parsed.port || parsed.port === "443");
  } catch {
    return false;
  }
}

export function isJobBoardUtilityControl(value: string): boolean {
  return /(job.?alert|email.?alert|newsletter|notification|apply.?capture|job,? company|job title|city,? county|town,? city|keyword search|search jobs|search location|what|where)/i.test(
    value,
  );
}

export function isApplicationFormEvidence(input: {
  hasResumeUpload: boolean;
  hasNameField: boolean;
  hasContactField: boolean;
  applicationSignals: number;
}): boolean {
  return (
    input.hasResumeUpload ||
    (input.hasNameField && input.hasContactField) ||
    input.applicationSignals >= 4
  );
}

export function isSourceAccessDeniedPage(
  title: string,
  body: string,
): boolean {
  return /(access denied|request (?:was )?blocked|forbidden|automated access (?:is )?not allowed|you do not have permission to access)/i.test(
    `${title} ${body}`,
  );
}

export function requiresEmployerTermsAcceptance(body: string): boolean {
  return /(?:by\s+(?:creating|registering|signing\s+up)|when\s+you\s+(?:create|register)).{0,220}(?:agree|accept).{0,160}(?:terms|conditions|privacy)/i.test(
    body.replace(/\s+/g, " "),
  );
}

export function isEmployerTermsCheckbox(label: string): boolean {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/(newsletter|marketing|promotion|offers|job alerts|talent community)/i.test(text))
    return false;
  return /(terms(?: and conditions)?|conditions of use|privacy (?:notice|policy)|account agreement|candidate declaration|data processing)/i.test(
    text,
  );
}

export function canAutomaticallyAcceptEmployerTerms(input: {
  label: string;
  required: boolean;
  consent: boolean;
}): boolean {
  return Boolean(
    input.consent &&
      input.required &&
      isEmployerTermsCheckbox(input.label),
  );
}

export function preferEmployerSignIn(input: {
  accountAlreadyExists: boolean;
  accountState?: "created";
}): boolean {
  return input.accountAlreadyExists || input.accountState === "created";
}

export function isClosedListingPage(title: string, body: string): boolean {
  return /(?:job|role|position|vacancy|opportunity|application).{0,80}(?:is |has been |was )?(?:no longer available|closed|expired|filled|removed)|no longer accepting applications|applications? (?:are )?closed|application deadline (?:has )?passed|this job (?:could not be found|does not exist)|page not found/i.test(
    `${title} ${body}`.replace(/\s+/g, " "),
  );
}

export function isVerificationResendControl(label: string): boolean {
  return /^(?:resend|send|request|email)(?: the)?(?: verification)?(?: a| another| new)? code(?: again)?$/i.test(
    label.replace(/\s+/g, " ").trim(),
  );
}

export function isEmployerAccountAccessPage(input: {
  body: string;
  hasEmailInput: boolean;
  hasPasswordInput: boolean;
  hasApplicationForm: boolean;
}): boolean {
  if (input.hasPasswordInput) return true;
  return Boolean(
    input.hasEmailInput &&
      !input.hasApplicationForm &&
      /(sign in|log in|create (?:an )?account|register|sign up|continue with email|email address.{0,80}(?:continue|next))/i.test(
        input.body,
      ),
  );
}

export function detectAts(value: string): AtsDefinition {
  const host = new URL(value).hostname.toLowerCase();
  const match = ATS_DOMAINS.find(({ domain }) => hostMatches(host, domain));
  if (match) return DEFINITIONS[match.kind];
  return DEFINITIONS.generic;
}

/**
 * A message sent to a candidate's unique application alias is still treated
 * as untrusted unless it comes from the same recognised ATS family used for
 * the submitted packet. This permits real confirmation and status mail while
 * preventing an arbitrary sender from changing an application state merely
 * by mentioning a role title.
 */
export function isTrustedApplicationPortalSender(
  sender: string,
  applicationDestination: string,
): boolean {
  const senderMatch = sender
    .toLowerCase()
    .match(/@([a-z0-9.-]+)(?:>|\s|$)/i);
  if (!senderMatch?.[1]) return false;
  let ats: AtsDefinition;
  try {
    ats = detectAts(applicationDestination);
  } catch {
    return false;
  }
  const senderHost = senderMatch[1].replace(/\.$/, "");
  if (ats.kind === "generic") {
    try {
      const destinationHost = new URL(applicationDestination).hostname.toLowerCase();
      // Generic employer career sites commonly send from their parent domain
      // or a notification subdomain. Keep this deliberately conservative:
      // sibling domains and merely similar names are not trusted.
      return (
        hostMatches(senderHost, destinationHost) ||
        hostMatches(destinationHost, senderHost)
      );
    } catch {
      return false;
    }
  }
  return ATS_SENDER_DOMAINS[ats.kind].some((domain) =>
    hostMatches(senderHost, domain),
  );
}

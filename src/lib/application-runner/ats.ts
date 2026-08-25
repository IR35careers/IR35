export type AtsKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "workday"
  | "totaljobs"
  | "icims"
  | "oracle"
  | "adp"
  | "bamboohr"
  | "jobvite"
  | "ukg"
  | "successfactors"
  | "dayforce"
  | "teamtailor"
  | "recruitee"
  | "pinpoint"
  | "rippling"
  | "generic";

export function shouldTreatSingleFileAsResume(input: {
  atsKind: AtsKind;
  fileUploadCount: number;
  pageCopy: string;
}): boolean {
  if (input.fileUploadCount !== 1) return false;
  if (input.atsKind === "totaljobs") return true;
  return /(?:cv|resume|curriculum)/i.test(input.pageCopy);
}

export function shouldSkipConsumedResumeInput(input: {
  fieldType: string;
  resumeAlreadyUploaded: boolean;
}): boolean {
  return input.fieldType === "file" && input.resumeAlreadyUploaded;
}

export function preferredResumeUploadFormat(atsKind: AtsKind): "pdf" | "docx" {
  // Totaljobs runs every upload through its document-scoring service before
  // enabling Send application. Its scorer rejects otherwise valid PDFKit
  // output with HTTP 422. Use the standards-based DOCX upload path instead.
  return atsKind === "totaljobs" ? "docx" : "pdf";
}

export function matchesApplicationAction(
  pattern: RegExp,
  labels: Array<string | null | undefined>,
): boolean {
  return labels.some((value) => {
    const label = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!label) return false;
    pattern.lastIndex = 0;
    return pattern.test(label);
  });
}

export interface AtsDefinition {
  kind: AtsKind;
  label: string;
  applyPattern: RegExp;
  nextPattern: RegExp;
  submitPattern: RegExp;
  successPattern: RegExp;
}

const COMMON = {
  applyPattern: /^(apply|apply now|apply online|apply manually|apply for this (?:job|position|role)|start application|continue application|begin application|i(?:'|’)?m interested)$/i,
  nextPattern: /^(next|continue|proceed|save (?:&|and) (?:continue|next)|continue application|continue to review|review|review application|review and submit)$/i,
  // "Apply now" normally opens the application form. Treating it as a final
  // submission action caused false failures after the first portal click.
  submitPattern: /^(submit|submit (?:my|your)? ?application|send application|finish application|complete application|confirm (?:&|and) submit)$/i,
  successPattern: /(application (?:has been |was )?(?:successfully )?(?:submitted|received|sent)|thank you for (?:your )?application|thank you for applying|we(?:['’]ve| have) received your application|application complete|successfully applied|your application is on its way)/i,
};

const GREENHOUSE = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review application)$/i,
  submitPattern: /^(submit application|submit my application)$/i,
};

const LEVER = {
  ...COMMON,
  applyPattern: /^(apply for this job|apply now)$/i,
  nextPattern: /^(next|continue|review application)$/i,
  submitPattern: /^(submit application|send application)$/i,
};

const ASHBY = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this job)$/i,
  nextPattern: /^(continue|next|review|review application)$/i,
  submitPattern: /^(submit application|submit)$/i,
};

const WORKABLE = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review application)$/i,
  submitPattern: /^(submit application|send application|submit)$/i,
};

const SMARTRECRUITERS = {
  ...COMMON,
  applyPattern: /^(i(?:'|’)?m interested|apply|apply now)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit application|submit)$/i,
};

const WORKDAY = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply manually|autofill with resume|start your application)$/i,
  nextPattern: /^(next|save (?:&|and) continue|continue|review)$/i,
  submitPattern: /^(submit|submit application)$/i,
  successPattern: /(application submitted|your application has been submitted|thank you for applying|you have successfully submitted your application)/i,
};

const TOTALJOBS = {
  ...COMMON,
  // Totaljobs starts its application renderer with an email-first account
  // check. This is a progression control, not the final submission action.
  nextPattern: /^(next|continue|continue with email|save (?:&|and) continue|continue application|review|review application|review and submit)$/i,
  submitPattern: /^(send application|submit application)$/i,
  successPattern: /(application sent|application submitted|your application has been sent|thank you for applying)/i,
};

const ICIMS = {
  ...COMMON,
  applyPattern: /^(apply for this job online|apply now|apply)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit profile|submit application|submit)$/i,
};

const ORACLE = {
  ...COMMON,
  applyPattern: /^(apply now|apply|start application)$/i,
  nextPattern: /^(continue|next|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit|submit application)$/i,
};

const ADP = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review application)$/i,
  submitPattern: /^(submit|submit application|submit my application)$/i,
  successPattern: /(application submitted|application received|thank you for applying|your application has been submitted)/i,
};

const BAMBOOHR = {
  ...COMMON,
  applyPattern: /^(apply for this job|apply now)$/i,
  nextPattern: /^(next|continue|review application)$/i,
  submitPattern: /^(submit application|submit)$/i,
};

const JOBVITE = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review application)$/i,
  submitPattern: /^(submit application|submit my application|submit)$/i,
  successPattern: /(application submitted|application received|thank you for applying|thanks for your application)/i,
};

const UKG = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this position|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review and submit)$/i,
  submitPattern: /^(submit|submit application|complete application)$/i,
  successPattern: /(application submitted|successfully submitted|thank you for applying|application complete)/i,
};

const TEAMTAILOR = {
  ...COMMON,
  applyPattern: /^(apply for this job|apply now|connect)$/i,
  nextPattern: /^(continue|next|review)$/i,
  submitPattern: /^(send application|submit application|submit)$/i,
};

const RECRUITEE = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|apply)$/i,
  nextPattern: /^(continue|next|review application)$/i,
  submitPattern: /^(submit application|send application|submit)$/i,
};

const SUCCESSFACTORS = {
  ...COMMON,
  applyPattern: /^(apply|apply now|start application)$/i,
  nextPattern: /^(next|continue|save|review)$/i,
  // SuccessFactors can use "Apply" on the final reviewed form.
  submitPattern: /^(apply|submit|submit application|complete application)$/i,
};

const DAYFORCE = {
  ...COMMON,
  applyPattern: /^(apply now|apply|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review application)$/i,
  submitPattern: /^(submit|submit application|complete application)$/i,
  successPattern: /(application submitted|application has been submitted|thank you for applying|successfully applied)/i,
};

const PINPOINT = {
  ...COMMON,
  applyPattern: /^(apply for this role|apply for this job|apply now|apply)$/i,
  nextPattern: /^(continue|next|save (?:&|and) continue|review application)$/i,
  submitPattern: /^(submit application|send application|submit)$/i,
  successPattern: /(application received|application submitted|thank you for applying|thanks for applying)/i,
};

const RIPPLING = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|apply)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit application|submit)$/i,
  successPattern: /(application submitted|application received|thank you for applying|successfully submitted)/i,
};

const DEFINITIONS: Record<AtsKind, AtsDefinition> = {
  greenhouse: { kind: "greenhouse", label: "Greenhouse", ...GREENHOUSE },
  lever: { kind: "lever", label: "Lever", ...LEVER },
  ashby: { kind: "ashby", label: "Ashby", ...ASHBY },
  workable: { kind: "workable", label: "Workable", ...WORKABLE },
  smartrecruiters: { kind: "smartrecruiters", label: "SmartRecruiters", ...SMARTRECRUITERS },
  workday: { kind: "workday", label: "Workday", ...WORKDAY },
  totaljobs: { kind: "totaljobs", label: "Totaljobs", ...TOTALJOBS },
  icims: { kind: "icims", label: "iCIMS", ...ICIMS },
  oracle: { kind: "oracle", label: "Oracle Recruiting", ...ORACLE },
  adp: { kind: "adp", label: "ADP", ...ADP },
  bamboohr: { kind: "bamboohr", label: "BambooHR", ...BAMBOOHR },
  jobvite: { kind: "jobvite", label: "Jobvite", ...JOBVITE },
  ukg: { kind: "ukg", label: "UKG", ...UKG },
  successfactors: { kind: "successfactors", label: "SAP SuccessFactors", ...SUCCESSFACTORS },
  dayforce: { kind: "dayforce", label: "Dayforce", ...DAYFORCE },
  teamtailor: { kind: "teamtailor", label: "Teamtailor", ...TEAMTAILOR },
  recruitee: { kind: "recruitee", label: "Recruitee", ...RECRUITEE },
  pinpoint: { kind: "pinpoint", label: "Pinpoint", ...PINPOINT },
  rippling: { kind: "rippling", label: "Rippling", ...RIPPLING },
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
  { domain: "myworkdaysite.com", kind: "workday" },
  { domain: "myworkday.com", kind: "workday" },
  { domain: "workday.com", kind: "workday" },
  { domain: "totaljobs.com", kind: "totaljobs" },
  { domain: "icims.com", kind: "icims" },
  { domain: "oraclecloud.com", kind: "oracle" },
  { domain: "taleo.net", kind: "oracle" },
  { domain: "adp.com", kind: "adp" },
  { domain: "bamboohr.com", kind: "bamboohr" },
  { domain: "jobvite.com", kind: "jobvite" },
  { domain: "ultipro.com", kind: "ukg" },
  { domain: "ukg.com", kind: "ukg" },
  { domain: "successfactors.com", kind: "successfactors" },
  { domain: "dayforcehcm.com", kind: "dayforce" },
  { domain: "teamtailor.com", kind: "teamtailor" },
  { domain: "recruitee.com", kind: "recruitee" },
  { domain: "pinpointhq.com", kind: "pinpoint" },
  { domain: "rippling.com", kind: "rippling" },
];

const ATS_SENDER_DOMAINS: Record<Exclude<AtsKind, "generic">, string[]> = {
  greenhouse: ["greenhouse.io", "greenhouse.com"],
  lever: ["lever.co", "lever.com"],
  ashby: ["ashbyhq.com"],
  workable: ["workable.com", "workablemail.com"],
  smartrecruiters: ["smartrecruiters.com"],
  workday: ["workday.com", "myworkday.com", "myworkdayjobs.com"],
  totaljobs: ["totaljobs.com"],
  icims: ["icims.com"],
  oracle: ["oraclecloud.com", "taleo.net"],
  adp: ["adp.com"],
  bamboohr: ["bamboohr.com"],
  jobvite: ["jobvite.com"],
  ukg: ["ultipro.com", "ukg.com"],
  successfactors: ["successfactors.com", "sap.com"],
  dayforce: ["dayforcehcm.com"],
  teamtailor: ["teamtailor.com"],
  recruitee: ["recruitee.com"],
  pinpoint: ["pinpointhq.com"],
  rippling: ["rippling.com"],
};

// These are job-discovery handoff pages rather than employer ATS products.
// The runner may open them and follow their public Apply action, but it still
// sends candidate data only to hosts approved by the request guard.
const JOB_BOARD_DOMAINS = [
  "adzuna.co.uk",
  "reed.co.uk",
  "cv-library.co.uk",
  "totaljobs.com",
] as const;

// Totaljobs mounts part of its application experience from this fixed bucket
// after the candidate fields are entered. Keep this exact-host only: broad S3
// access would weaken the runner's candidate-data boundary.
const ATS_AUXILIARY_HOSTS = [
  "tjgliveassets.s3.eu-west-1.amazonaws.com",
] as const;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "net.uk",
  "nhs.uk",
  "org.uk",
  "plc.uk",
  "sch.uk",
  "com.au",
  "com.br",
  "com.cn",
  "com.sg",
  "co.in",
  "co.jp",
  "co.nz",
  "co.za",
]);

function organisationalDomain(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const suffix = labels.slice(-2).join(".");
  const labelCount = MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix) ? 3 : 2;
  if (labels.length < labelCount) return null;
  return labels.slice(-labelCount).join(".");
}

export function nativeRunnerHostAllowed(value: string): boolean {
  const host = (value.includes("://") ? new URL(value).hostname : value).toLowerCase().replace(/\.$/, "");
  if (ATS_DOMAINS.some(({ domain }) => hostMatches(host, domain))) return true;
  if (JOB_BOARD_DOMAINS.some((domain) => hostMatches(host, domain))) return true;
  if (ATS_AUXILIARY_HOSTS.includes(host as (typeof ATS_AUXILIARY_HOSTS)[number])) return true;
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
  accountState?: "created" | "verified" | "recovered";
}): boolean {
  return input.accountAlreadyExists || Boolean(input.accountState);
}

export function isEmployerAuthenticationFailure(body: string): boolean {
  return /incorrect (?:email|password)|invalid (?:email|password|credentials)|password (?:is )?(?:incorrect|invalid|wrong)|unable to (?:sign|log) in|(?:sign|log)[ -]?in failed|authentication failed|credentials (?:are )?(?:incorrect|invalid)|account.{0,50}(?:locked|not found)/i.test(
    body.replace(/\s+/g, " "),
  );
}

export function isEmployerAccountMissing(body: string): boolean {
  return /(?:account|candidate|email|user).{0,70}(?:does not exist|doesn't exist|not found|not registered|has not been registered|cannot be found|could not be found)|no account.{0,45}(?:found|exists|registered)|we (?:could not|couldn't|cannot|can't) find.{0,70}(?:account|email|user)/i.test(
    body.replace(/\s+/g, " "),
  );
}

export function isEmployerAccountCreationControl(label: string): boolean {
  const value = label.replace(/\s+/g, " ").trim();
  return /^(?:create(?: (?:a|an|your|new))? (?:candidate |jobseeker |application )?account|register(?: now| with email| as (?:a )?candidate)?|sign up(?: now| with email| for free| as (?:a )?candidate)?)$/i.test(
    value,
  );
}

export function employerPortalPasswordCandidates(input: {
  resolvedPassword?: string;
  destinationPassword?: string;
}): string[] {
  return [input.resolvedPassword, input.destinationPassword].filter(
    (password, index, values): password is string =>
      Boolean(password) && values.indexOf(password) === index,
  );
}

export function isEmployerGuestApplicationControl(label: string): boolean {
  const value = label.replace(/\s+/g, " ").trim();
  return /(?:continue|apply|proceed|start).{0,35}(?:as (?:a )?guest|without (?:an )?account|without sign(?:ing)? in)|^(?:continue as guest|guest application|apply as guest|skip sign[ -]?in|not now)$/i.test(
    value,
  );
}

export function isEmployerAccountRecoveryControl(label: string): boolean {
  const value = label.replace(/\s+/g, " ").trim();
  return /(?:forgot(?:ten)? (?:your )?(?:password|login)|reset (?:my |your )?password|password (?:help|reset)|recover (?:my |your )?account|account recovery|trouble (?:signing|logging) in|can(?:not|'t|’t) (?:sign|log) in|help (?:me )?(?:sign|log) in|get (?:sign[ -]?in|login) help)/i.test(
    value,
  );
}

export function isEmployerPasswordlessAccessControl(label: string): boolean {
  const value = label.replace(/\s+/g, " ").trim();
  return /(?:email|send|get|request|use).{0,45}(?:magic|secure|sign[ -]?in|login|one[ -]?time|verification|access).{0,30}(?:link|code)|(?:email|send) me (?:a )?(?:link|code)|sign in with (?:a )?(?:link|code)|use (?:a )?(?:one[ -]?time )?(?:link|code)/i.test(
    value,
  );
}

export function isEmployerPasswordSetupPage(body: string): boolean {
  return /(?:reset|set|choose|create|update|new) (?:your )?password|password reset|confirm (?:your )?(?:new )?password/i.test(
    body.replace(/\s+/g, " "),
  );
}

export function isEmployerEmailLinkPending(body: string): boolean {
  return /check your (?:email|inbox)|(?:sent|emailed).{0,80}(?:link|verification)|(?:open|use|click).{0,60}(?:login|log[ -]?in|sign[ -]?in|one[ -]?time|verification|magic).{0,40}link|(?:login|log[ -]?in|sign[ -]?in|one[ -]?time).{0,40}link.{0,40}(?:sent|emailed)|an email is on the way|magic link/i.test(
    body.replace(/\s+/g, " "),
  );
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
  if (
    input.hasEmailInput &&
    /continue with email/i.test(input.body)
  )
    return true;
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
      // or a sibling notification subdomain. Trust only the same
      // organisational domain; merely similar names and public suffix peers
      // are not trusted.
      return (
        hostMatches(senderHost, destinationHost) ||
        hostMatches(destinationHost, senderHost) ||
        (organisationalDomain(senderHost) !== null &&
          organisationalDomain(senderHost) ===
            organisationalDomain(destinationHost))
      );
    } catch {
      return false;
    }
  }
  return ATS_SENDER_DOMAINS[ats.kind].some((domain) =>
    hostMatches(senderHost, domain),
  );
}

// services/application-worker/server.ts
import { createServer } from "node:http";
import { hostname } from "node:os";
import { chromium as playwrightChromium } from "playwright-core";

// src/lib/application-worker-auth.ts
import { createHmac, timingSafeEqual } from "node:crypto";
var MAX_CLOCK_SKEW_MS = 5 * 6e4;
function applicationWorkerAppOrigin(value) {
  const url = new URL(value || "https://www.ir35careers.com");
  if (url.protocol !== "https:")
    throw new Error("IR35Careers worker origin must use HTTPS.");
  return url.origin;
}
function workerSecret() {
  const secret = process.env.APPLICATION_WORKER_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new Error(
      "APPLICATION_WORKER_SECRET must contain at least 32 characters."
    );
  return secret;
}
function signApplicationWorkerBody(body, timestamp = Date.now().toString()) {
  const signature = createHmac("sha256", workerSecret()).update(`${timestamp}.${body}`).digest("base64url");
  return { timestamp, signature };
}

// src/lib/application-runner/run.ts
import chromiumBinary from "@sparticuz/chromium";
import {
  chromium
} from "playwright-core";
import { createHash } from "node:crypto";

// src/lib/application-runner/ats.ts
function shouldTreatSingleFileAsResume(input) {
  if (input.fileUploadCount !== 1) return false;
  if (input.atsKind === "totaljobs") return true;
  return /(?:cv|resume|curriculum)/i.test(input.pageCopy);
}
function shouldSkipConsumedResumeInput(input) {
  return input.fieldType === "file" && input.resumeAlreadyUploaded;
}
function preferredResumeUploadFormat(atsKind) {
  return atsKind === "totaljobs" ? "docx" : "pdf";
}
function matchesApplicationAction(pattern, labels) {
  return labels.some((value) => {
    const label = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!label) return false;
    pattern.lastIndex = 0;
    return pattern.test(label);
  });
}
var COMMON = {
  applyPattern: /^(apply|apply now|apply online|apply manually|apply for this (?:job|position|role)|start application|continue application|begin application|i(?:'|’)?m interested)$/i,
  nextPattern: /^(next|continue|proceed|save (?:&|and) (?:continue|next)|continue application|continue to review|review|review application|review and submit)$/i,
  // "Apply now" normally opens the application form. Treating it as a final
  // submission action caused false failures after the first portal click.
  submitPattern: /^(submit|submit (?:my|your)? ?application|send application|finish application|complete application|confirm (?:&|and) submit)$/i,
  successPattern: /(application (?:has been |was )?(?:successfully )?(?:submitted|received|sent)|thank you for (?:your )?application|thank you for applying|we(?:['’]ve| have) received your application|application complete|successfully applied|your application is on its way)/i
};
var GREENHOUSE = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review application)$/i,
  submitPattern: /^(submit application|submit my application)$/i
};
var LEVER = {
  ...COMMON,
  applyPattern: /^(apply for this job|apply now)$/i,
  nextPattern: /^(next|continue|review application)$/i,
  submitPattern: /^(submit application|send application)$/i
};
var ASHBY = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this job)$/i,
  nextPattern: /^(continue|next|review|review application)$/i,
  submitPattern: /^(submit application|submit)$/i
};
var WORKABLE = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review application)$/i,
  submitPattern: /^(submit application|send application|submit)$/i
};
var SMARTRECRUITERS = {
  ...COMMON,
  applyPattern: /^(i(?:'|’)?m interested|apply|apply now)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit application|submit)$/i
};
var WORKDAY = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply manually|autofill with resume|start your application)$/i,
  nextPattern: /^(next|save (?:&|and) continue|continue|review)$/i,
  submitPattern: /^(submit|submit application)$/i,
  successPattern: /(application submitted|your application has been submitted|thank you for applying|you have successfully submitted your application)/i
};
var TOTALJOBS = {
  ...COMMON,
  // Totaljobs starts its application renderer with an email-first account
  // check. This is a progression control, not the final submission action.
  nextPattern: /^(next|continue|continue with email|save (?:&|and) continue|continue application|review|review application|review and submit)$/i,
  submitPattern: /^(send application|submit application)$/i,
  successPattern: /(application sent|application submitted|your application has been sent|thank you for applying)/i
};
var ICIMS = {
  ...COMMON,
  applyPattern: /^(apply for this job online|apply now|apply)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit profile|submit application|submit)$/i
};
var ORACLE = {
  ...COMMON,
  applyPattern: /^(apply now|apply|start application)$/i,
  nextPattern: /^(continue|next|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit|submit application)$/i
};
var ADP = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review application)$/i,
  submitPattern: /^(submit|submit application|submit my application)$/i,
  successPattern: /(application submitted|application received|thank you for applying|your application has been submitted)/i
};
var BAMBOOHR = {
  ...COMMON,
  applyPattern: /^(apply for this job|apply now)$/i,
  nextPattern: /^(next|continue|review application)$/i,
  submitPattern: /^(submit application|submit)$/i
};
var JOBVITE = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review application)$/i,
  submitPattern: /^(submit application|submit my application|submit)$/i,
  successPattern: /(application submitted|application received|thank you for applying|thanks for your application)/i
};
var UKG = {
  ...COMMON,
  applyPattern: /^(apply|apply now|apply for this position|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review and submit)$/i,
  submitPattern: /^(submit|submit application|complete application)$/i,
  successPattern: /(application submitted|successfully submitted|thank you for applying|application complete)/i
};
var TEAMTAILOR = {
  ...COMMON,
  applyPattern: /^(apply for this job|apply now|connect)$/i,
  nextPattern: /^(continue|next|review)$/i,
  submitPattern: /^(send application|submit application|submit)$/i
};
var RECRUITEE = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|apply)$/i,
  nextPattern: /^(continue|next|review application)$/i,
  submitPattern: /^(submit application|send application|submit)$/i
};
var SUCCESSFACTORS = {
  ...COMMON,
  applyPattern: /^(apply|apply now|start application)$/i,
  nextPattern: /^(next|continue|save|review)$/i,
  // SuccessFactors can use "Apply" on the final reviewed form.
  submitPattern: /^(apply|submit|submit application|complete application)$/i
};
var DAYFORCE = {
  ...COMMON,
  applyPattern: /^(apply now|apply|start application)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review|review application)$/i,
  submitPattern: /^(submit|submit application|complete application)$/i,
  successPattern: /(application submitted|application has been submitted|thank you for applying|successfully applied)/i
};
var PINPOINT = {
  ...COMMON,
  applyPattern: /^(apply for this role|apply for this job|apply now|apply)$/i,
  nextPattern: /^(continue|next|save (?:&|and) continue|review application)$/i,
  submitPattern: /^(submit application|send application|submit)$/i,
  successPattern: /(application received|application submitted|thank you for applying|thanks for applying)/i
};
var RIPPLING = {
  ...COMMON,
  applyPattern: /^(apply now|apply for this job|apply)$/i,
  nextPattern: /^(next|continue|save (?:&|and) continue|review)$/i,
  submitPattern: /^(submit application|submit)$/i,
  successPattern: /(application submitted|application received|thank you for applying|successfully submitted)/i
};
var DEFINITIONS = {
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
  generic: { kind: "generic", label: "Employer application portal", ...COMMON }
};
var ATS_DOMAINS = [
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
  { domain: "rippling.com", kind: "rippling" }
];
var JOB_BOARD_DOMAINS = [
  "adzuna.co.uk",
  "reed.co.uk",
  "cv-library.co.uk",
  "totaljobs.com"
];
var ATS_AUXILIARY_HOSTS = [
  "tjgliveassets.s3.eu-west-1.amazonaws.com"
];
function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}
function nativeRunnerHostAllowed(value) {
  const host = (value.includes("://") ? new URL(value).hostname : value).toLowerCase().replace(/\.$/, "");
  if (ATS_DOMAINS.some(({ domain }) => hostMatches(host, domain))) return true;
  if (JOB_BOARD_DOMAINS.some((domain) => hostMatches(host, domain))) return true;
  if (ATS_AUXILIARY_HOSTS.includes(host)) return true;
  if (host === "ir35careers.com" || host === "www.ir35careers.com") return true;
  const configured = (process.env.APPLICATION_RUNNER_ALLOWED_HOSTS ?? "").split(",").map((entry) => entry.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  return configured.includes(host);
}
function isSafeApplicationHandoffNavigation(input) {
  if (input.sensitive || input.method !== "GET" || input.resourceType !== "document" || !input.isNavigationRequest || !input.isTopLevel)
    return false;
  try {
    const parsed = new URL(input.url);
    return parsed.protocol === "https:" && (!parsed.port || parsed.port === "443");
  } catch {
    return false;
  }
}
function isJobBoardUtilityControl(value) {
  return /(job.?alert|email.?alert|newsletter|notification|apply.?capture|job,? company|job title|city,? county|town,? city|keyword search|search jobs|search location|what|where)/i.test(
    value
  );
}
function isApplicationFormEvidence(input) {
  return input.hasResumeUpload || input.hasNameField && input.hasContactField || input.applicationSignals >= 4;
}
function isSourceAccessDeniedPage(title, body) {
  return /(access denied|request (?:was )?blocked|forbidden|automated access (?:is )?not allowed|you do not have permission to access)/i.test(
    `${title} ${body}`
  );
}
function requiresEmployerTermsAcceptance(body) {
  return /(?:by\s+(?:creating|registering|signing\s+up)|when\s+you\s+(?:create|register)).{0,220}(?:agree|accept).{0,160}(?:terms|conditions|privacy)/i.test(
    body.replace(/\s+/g, " ")
  );
}
function isEmployerTermsCheckbox(label) {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/(newsletter|marketing|promotion|offers|job alerts|talent community)/i.test(text))
    return false;
  return /(terms(?: and conditions)?|conditions of use|privacy (?:notice|policy)|account agreement|candidate declaration|data processing)/i.test(
    text
  );
}
function canAutomaticallyAcceptEmployerTerms(input) {
  return Boolean(
    input.consent && input.required && isEmployerTermsCheckbox(input.label)
  );
}
function preferEmployerSignIn(input) {
  return input.accountAlreadyExists || Boolean(input.accountState);
}
function isEmployerAuthenticationFailure(body) {
  return /incorrect (?:email|password)|invalid (?:email|password|credentials)|password (?:is )?(?:incorrect|invalid|wrong)|unable to (?:sign|log) in|(?:sign|log)[ -]?in failed|authentication failed|credentials (?:are )?(?:incorrect|invalid)|account.{0,50}(?:locked|not found)/i.test(
    body.replace(/\s+/g, " ")
  );
}
function isEmployerAccountMissing(body) {
  return /(?:account|candidate|email|user).{0,70}(?:does not exist|doesn't exist|not found|not registered|has not been registered|cannot be found|could not be found)|no account.{0,45}(?:found|exists|registered)|we (?:could not|couldn't|cannot|can't) find.{0,70}(?:account|email|user)/i.test(
    body.replace(/\s+/g, " ")
  );
}
function isEmployerAccountCreationControl(label) {
  const value = label.replace(/\s+/g, " ").trim();
  return /^(?:create(?: (?:a|an|your|new))? (?:candidate |jobseeker |application )?account|register(?: now| with email| as (?:a )?candidate)?|sign up(?: now| with email| for free| as (?:a )?candidate)?)$/i.test(
    value
  );
}
function employerPortalPasswordCandidates(input) {
  return [input.resolvedPassword, input.destinationPassword].filter(
    (password, index, values) => Boolean(password) && values.indexOf(password) === index
  );
}
function isEmployerGuestApplicationControl(label) {
  const value = label.replace(/\s+/g, " ").trim();
  return /(?:continue|apply|proceed|start).{0,35}(?:as (?:a )?guest|without (?:an )?account|without sign(?:ing)? in)|^(?:continue as guest|guest application|apply as guest|skip sign[ -]?in|not now)$/i.test(
    value
  );
}
function isEmployerAccountRecoveryControl(label) {
  const value = label.replace(/\s+/g, " ").trim();
  return /(?:forgot(?:ten)? (?:your )?(?:password|login)|reset (?:my |your )?password|password (?:help|reset)|recover (?:my |your )?account|account recovery|trouble (?:signing|logging) in|can(?:not|'t|’t) (?:sign|log) in|help (?:me )?(?:sign|log) in|get (?:sign[ -]?in|login) help)/i.test(
    value
  );
}
function isEmployerPasswordlessAccessControl(label) {
  const value = label.replace(/\s+/g, " ").trim();
  return /(?:email|send|get|request|use).{0,45}(?:magic|secure|sign[ -]?in|login|one[ -]?time|verification|access).{0,30}(?:link|code)|(?:email|send) me (?:a )?(?:link|code)|sign in with (?:a )?(?:link|code)|use (?:a )?(?:one[ -]?time )?(?:link|code)/i.test(
    value
  );
}
function isEmployerPasswordSetupPage(body) {
  return /(?:reset|set|choose|create|update|new) (?:your )?password|password reset|confirm (?:your )?(?:new )?password/i.test(
    body.replace(/\s+/g, " ")
  );
}
function isEmployerEmailLinkPending(body) {
  return /check your (?:email|inbox)|(?:sent|emailed).{0,80}(?:link|verification)|(?:open|use|click).{0,60}(?:login|log[ -]?in|sign[ -]?in|one[ -]?time|verification|magic).{0,40}link|(?:login|log[ -]?in|sign[ -]?in|one[ -]?time).{0,40}link.{0,40}(?:sent|emailed)|an email is on the way|magic link/i.test(
    body.replace(/\s+/g, " ")
  );
}
function isClosedListingPage(title, body) {
  return /(?:job|role|position|vacancy|opportunity|application).{0,80}(?:is |has been |was )?(?:no longer available|closed|expired|filled|removed)|no longer accepting applications|applications? (?:are )?closed|application deadline (?:has )?passed|this job (?:could not be found|does not exist)|page not found/i.test(
    `${title} ${body}`.replace(/\s+/g, " ")
  );
}
function isVerificationResendControl(label) {
  return /^(?:resend|send|request|email)(?: the)?(?: verification)?(?: a| another| new)? code(?: again)?$/i.test(
    label.replace(/\s+/g, " ").trim()
  );
}
function isEmployerAccountAccessPage(input) {
  if (input.hasPasswordInput) return true;
  if (input.hasEmailInput && /continue with email/i.test(input.body))
    return true;
  return Boolean(
    input.hasEmailInput && !input.hasApplicationForm && /(sign in|log in|create (?:an )?account|register|sign up|continue with email|email address.{0,80}(?:continue|next))/i.test(
      input.body
    )
  );
}
function detectAts(value) {
  const host = new URL(value).hostname.toLowerCase();
  const match = ATS_DOMAINS.find(({ domain }) => hostMatches(host, domain));
  if (match) return DEFINITIONS[match.kind];
  return DEFINITIONS.generic;
}

// src/lib/workspace/answer-memory.ts
function normaliseApplicationQuestionLabel(value) {
  return value.toLocaleLowerCase("en-GB").replace(/\b(?:please|kindly|required)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function mergeApplicationAnswerMemory(saved, current) {
  const merged = /* @__PURE__ */ new Map();
  for (const item of saved ?? []) {
    const key = normaliseApplicationQuestionLabel(item.label);
    if (!key || !item.answer.trim()) continue;
    merged.set(key, {
      id: `remembered:${item.id}`,
      label: item.label,
      answer: item.answer,
      required: false,
      source: "profile",
      reviewed: true
    });
  }
  for (const question of current) {
    const key = normaliseApplicationQuestionLabel(question.label);
    if (key) merged.set(key, question);
  }
  return [...merged.values()];
}

// src/lib/application-runner/types.ts
var FACT_KEYS = [
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "address",
  "city",
  "county",
  "postcode",
  "country",
  "location",
  "linkedin",
  "portfolio",
  "availability",
  "notice_period",
  "right_to_work",
  "needs_sponsorship",
  "can_relocate",
  "can_work_in_person",
  "can_start_immediately",
  "education_institution",
  "education_qualification",
  "security_clearance",
  "limited_company_name",
  "is_over_18",
  "has_transportation",
  "needs_accommodation",
  "worked_for_company_before",
  "has_government_clearance",
  "has_government_ties",
  "willing_to_travel",
  "willing_to_work_shifts",
  "willing_to_work_weekends",
  "background_check_consent",
  "criminal_convictions",
  "target_day_rate",
  "target_annual_salary",
  "years_of_experience",
  "referral_source"
];
function yesNo(value) {
  return value === true ? "Yes" : value === false ? "No" : "";
}
function buildRunnerFacts(candidate, questions) {
  const name = candidate.fullName.trim().split(/\s+/).filter(Boolean);
  return {
    values: {
      full_name: candidate.fullName,
      first_name: name[0] ?? "",
      last_name: name.slice(1).join(" "),
      email: candidate.email,
      phone: candidate.phone,
      address: candidate.addressLine1 ?? "",
      city: candidate.city ?? "",
      county: candidate.county ?? "",
      postcode: candidate.postcode ?? "",
      country: candidate.country ?? "",
      location: candidate.location,
      linkedin: candidate.linkedInUrl,
      portfolio: candidate.portfolioUrl,
      availability: candidate.availability,
      notice_period: candidate.noticePeriod,
      right_to_work: candidate.rightToWork === "yes" ? "Yes" : candidate.rightToWork === "needs_sponsorship" || candidate.rightToWork === "no" ? "No" : "",
      needs_sponsorship: candidate.rightToWork === "needs_sponsorship" ? "Yes" : candidate.rightToWork === "yes" || candidate.rightToWork === "no" ? "No" : "",
      can_relocate: yesNo(candidate.canRelocate),
      can_work_in_person: yesNo(candidate.canWorkInPerson),
      can_start_immediately: yesNo(candidate.canStartImmediately),
      education_institution: candidate.educationInstitution ?? "",
      education_qualification: candidate.educationQualification ?? "",
      security_clearance: candidate.clearance,
      limited_company_name: candidate.limitedCompanyName,
      is_over_18: yesNo(candidate.isOver18),
      has_transportation: yesNo(candidate.hasTransportation),
      needs_accommodation: yesNo(candidate.needsAccommodation),
      worked_for_company_before: yesNo(candidate.workedForCompanyBefore),
      has_government_clearance: yesNo(candidate.hasGovernmentClearance),
      has_government_ties: yesNo(candidate.hasGovernmentTies),
      willing_to_travel: yesNo(candidate.willingToTravel),
      willing_to_work_shifts: yesNo(candidate.willingToWorkShifts),
      willing_to_work_weekends: yesNo(candidate.willingToWorkWeekends),
      background_check_consent: yesNo(candidate.backgroundCheckConsent),
      criminal_convictions: yesNo(candidate.criminalConvictionsToDeclare),
      target_day_rate: candidate.targetDayRate ?? "",
      target_annual_salary: candidate.targetAnnualSalary ?? "",
      years_of_experience: candidate.yearsOfExperience ?? "",
      referral_source: candidate.referralSource ?? ""
    },
    screeningAnswers: mergeApplicationAnswerMemory(
      candidate.savedApplicationAnswers,
      questions
    )
  };
}

// src/lib/application-runner/field-mapping.ts
var PATTERNS = [
  ["first_name", /\b(first|given)\s*name\b/i],
  ["last_name", /\b(last|family|sur)\s*name\b/i],
  ["full_name", /\b(full|legal)\s*name\b|^name$/i],
  ["email", /e-?mail/i],
  ["phone", /phone|mobile|telephone/i],
  ["postcode", /post\s*code|postal\s*code|zip\s*code/i],
  ["address", /street|address\s*(line)?\s*1/i],
  ["city", /\bcity\b|town/i],
  ["county", /county|state|province|region/i],
  ["country", /country/i],
  ["linkedin", /linkedin/i],
  ["portfolio", /portfolio|personal\s*(site|website)|github|website/i],
  ["notice_period", /notice\s*period/i],
  ["availability", /availability|available\s*(from|to start)|start\s*date/i],
  ["needs_sponsorship", /sponsor|visa/i],
  [
    "right_to_work",
    /right\s*to\s*work|authori[sz]ed?\s*to\s*work|work\s*authori[sz]ation/i
  ],
  ["can_relocate", /relocat/i],
  ["can_work_in_person", /work\s*(in person|on.?site)|on.?site/i],
  ["can_start_immediately", /start\s*immediately/i],
  ["education_institution", /university|college|institution|school/i],
  ["education_qualification", /degree|qualification/i],
  ["security_clearance", /security\s*clearance|clearance\s*level/i],
  ["limited_company_name", /limited\s*company|company\s*name/i],
  ["is_over_18", /(?:18|eighteen).*(?:older|over)|age.*(?:eligib|confirm)/i],
  [
    "has_transportation",
    /reliable\s*transport|own\s*transport|driving\s*licen[cs]e/i
  ],
  [
    "needs_accommodation",
    /accommodation|workplace\s*adjustment|reasonable\s*adjustment/i
  ],
  [
    "worked_for_company_before",
    /worked.*(?:company|us).*before|previously\s*(?:employed|worked)/i
  ],
  ["has_government_clearance", /hold.*(?:government|security)\s*clearance/i],
  ["has_government_ties", /government.*(?:ties|employment|contract)/i],
  ["willing_to_travel", /willing.*travel|travel.*required/i],
  ["willing_to_work_shifts", /willing.*shift|shift\s*work/i],
  ["willing_to_work_weekends", /willing.*weekend|weekend\s*work/i],
  ["background_check_consent", /background\s*check|pre-employment\s*screen/i],
  ["criminal_convictions", /criminal|conviction/i],
  [
    "target_day_rate",
    /(?:expected|target|desired).*(?:day\s*rate|rate)|day\s*rate/i
  ],
  [
    "target_annual_salary",
    /(?:expected|target|desired).*(?:annual\s*)?salary|salary\s*expectation/i
  ],
  ["years_of_experience", /years?.*(?:experience|using|working)/i],
  ["referral_source", /how.*(?:hear|find).*(?:role|job|opportun)|source/i],
  ["location", /current\s*location|where\s*are\s*you\s*based/i]
];
var SENSITIVE = /(date of birth|birth date|national insurance|passport|social security|gender|sex|ethnic|race|religion|medical|health|veteran|current salary|signature|terms and conditions|privacy consent)/i;
function fieldText(field) {
  return `${field.label} ${field.name} ${field.placeholder}`.replace(/\s+/g, " ").trim();
}
function deterministicMapping(field) {
  const text = fieldText(field);
  if (SENSITIVE.test(text) || field.type === "password")
    return { fieldId: field.id, factKey: "needs_user" };
  const matched = PATTERNS.find(([, pattern]) => pattern.test(text));
  return matched ? { fieldId: field.id, factKey: matched[0] } : null;
}
function normalise(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function screeningAnswer(field, facts) {
  const label = normalise(field.label || field.name || field.placeholder);
  if (!label) return "";
  const exact = facts.screeningAnswers.find(
    (question) => normalise(question.label) === label && question.reviewed
  );
  if (exact?.answer.trim()) return exact.answer.trim();
  const near = facts.screeningAnswers.find((question) => {
    if (!question.reviewed || !question.answer.trim()) return false;
    const candidate = normalise(question.label);
    return candidate.length >= 12 && (candidate.includes(label) || label.includes(candidate));
  });
  return near?.answer.trim() ?? "";
}
function valueForMapping(mapping, facts) {
  if (!FACT_KEYS.includes(mapping.factKey)) return "";
  return facts.values[mapping.factKey]?.trim() ?? "";
}
function closestOption(value, options) {
  if (!value || options.length === 0) return "";
  const target = normalise(value);
  const exact = options.find((option) => normalise(option) === target);
  if (exact) return exact;
  if (target === "yes")
    return options.find(
      (option) => /^(yes|true|authori[sz]ed|i agree)$/i.test(option.trim())
    ) ?? "";
  if (target === "no")
    return options.find(
      (option) => /^(no|false|not required|i do not agree)$/i.test(option.trim())
    ) ?? "";
  return options.find(
    (option) => normalise(option).includes(target) || target.includes(normalise(option))
  ) ?? "";
}

// src/lib/resume/normalise-text.ts
var EMPTY_BULLET_LINE = /^\s*(?:[•●◦▪‣·*-]\s*)+$/;
function normaliseResumeText(value) {
  const cleaned = [];
  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = EMPTY_BULLET_LINE.test(rawLine) ? "" : rawLine.replace(/[ \t]+$/g, "");
    if (!line.trim() && !cleaned.at(-1)?.trim()) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

// src/lib/security/response-body.ts
var ResponseBodyError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ResponseBodyError";
  }
};
async function readResponseText(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("A positive response limit is required.");
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new ResponseBodyError("The upstream response is too large.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => void 0);
        throw new ResponseBodyError("The upstream response is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
async function readJsonResponse(response, maxBytes) {
  const text = await readResponseText(response, maxBytes);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// src/lib/ai/openrouter-tailoring.ts
function openRouterTailoringConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4.1-mini"
  };
}

// src/lib/application-runner/openrouter-mapper.ts
function extractJson(value) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return (fenced ?? value).trim();
}
async function mapUnknownFields(fields) {
  const config = openRouterTailoringConfig();
  if (!config || fields.length === 0) return [];
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "http-referer": "https://www.ir35careers.com",
      "x-title": "IR35Careers Application Runner"
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 1200,
      provider: { zdr: true, data_collection: "deny" },
      messages: [
        {
          role: "system",
          content: `Map employer form fields to one saved fact key. Return JSON only: {"mappings":[{"field_id":"...","fact_key":"..."}]}. Allowed fact keys: ${FACT_KEYS.join(", ")}, needs_user, skip. Use needs_user for legal, demographic, identity, salary, consent, ambiguous or employer-specific questions. Use skip only for optional fields with no safe mapping. Never invent an answer.`
        },
        {
          role: "user",
          content: JSON.stringify(fields.map((field) => ({ field_id: field.id, label: field.label, name: field.name, type: field.type, required: field.required, options: field.options.slice(0, 30) })))
        }
      ]
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25e3)
  });
  const payload = await readJsonResponse(response, 5e5).catch(() => null);
  if (!response.ok || !payload) return [];
  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    return [];
  }
  const allowed = /* @__PURE__ */ new Set([...FACT_KEYS, "needs_user", "skip"]);
  const fieldIds = new Set(fields.map((field) => field.id));
  return (parsed.mappings ?? []).flatMap((item) => {
    const fieldId = String(item.field_id ?? "");
    const factKey = String(item.fact_key ?? "");
    return fieldIds.has(fieldId) && allowed.has(factKey) ? [{ fieldId, factKey }] : [];
  });
}

// src/lib/application-runner/source-resolution.ts
var DISCOVERY_ONLY_DOMAINS = [
  "adzuna.co.uk",
  "reed.co.uk",
  "cv-library.co.uk",
  "totaljobs.com",
  "jobserve.com",
  "gumtree.com",
  "talent.com",
  "jooble.org",
  "contractoruk.com",
  "itjobswatch.co.uk",
  "opentalent.in",
  "haystack.cv",
  "devitjobs.uk",
  "joinhyra.com"
];
var COMPANY_NOISE_WORDS = /* @__PURE__ */ new Set([
  "and",
  "company",
  "group",
  "international",
  "limited",
  "ltd",
  "plc",
  "recruitment",
  "solutions",
  "technology",
  "technologies",
  "the",
  "uk"
]);
var DIRECT_APPLICATION_DOMAINS = [
  "greenhouse.io",
  "greenhouse.com",
  "lever.co",
  "lever.com",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "myworkdayjobs.com",
  "myworkday.com",
  "workday.com",
  "totaljobs.com",
  "icims.com",
  "oraclecloud.com",
  "taleo.net",
  "adp.com",
  "bamboohr.com",
  "jobvite.com",
  "ultipro.com",
  "ukg.com",
  "successfactors.com",
  "dayforcehcm.com",
  "teamtailor.com",
  "recruitee.com",
  "pinpointhq.com",
  "rippling.com"
];
function hostMatches2(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}
function isDiscoveryOnlyHost(host) {
  const normalised = host.toLowerCase().replace(/^www\./, "");
  return DISCOVERY_ONLY_DOMAINS.some(
    (domain) => hostMatches2(normalised, domain)
  );
}
function compact(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(value) {
  return new Set(
    compact(value).split(" ").filter((token) => token.length > 1)
  );
}
function overlap(left, right) {
  const expected = tokens(left);
  const actual = tokens(right);
  if (!expected.size || !actual.size) return 0;
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  return matches / expected.size;
}
function discoveryProviderFromAdzunaPage(input) {
  const evidence = `${input.body} ${input.html}`;
  if (/(?:cv[\s-]?library|logo_cv_library)/i.test(evidence))
    return "cv_library";
  if (/(?:totaljobs|total jobs)/i.test(evidence)) return "totaljobs";
  return null;
}
function discoveryProviderOrder(input) {
  const detected = discoveryProviderFromAdzunaPage(input);
  if (!detected) return ["totaljobs", "cv_library"];
  return detected === "totaljobs" ? ["totaljobs", "cv_library"] : ["cv_library", "totaljobs"];
}
function decodeSearchHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(
    /&#(\d+);/g,
    (_, code) => String.fromCodePoint(Number(code))
  ).replace(
    /&#x([0-9a-f]+);/gi,
    (_, code) => String.fromCodePoint(Number.parseInt(code, 16))
  ).replace(/\s+/g, " ").trim();
}
function directEmployerCandidatesFromSearchHtml(html) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const attributes = match[1] ?? "";
    const className = attributes.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
    if (!/(?:^|\s)result__a(?:\s|$)/i.test(className)) continue;
    const encodedHref = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "";
    const href = duckDuckGoResultTarget(decodeSearchHtml(encodedHref));
    const title = decodeSearchHtml(match[2] ?? "");
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    candidates.push({ title, context: title, href });
    if (candidates.length >= 12) break;
  }
  return candidates;
}
function discoveryCandidateScore(candidate, job) {
  const titleOverlap = overlap(job.title, candidate.title);
  if (titleOverlap < 0.72) return 0;
  const candidateContext = compact(candidate.context);
  const company = compact(job.company_name);
  const companyMatched = Boolean(
    company && (candidateContext.includes(company) || overlap(company, candidate.context) >= 0.8)
  );
  if (!companyMatched) return 0;
  const exactTitle = compact(candidate.title) === compact(job.title);
  const location = job.location.split(",")[0] ?? job.location;
  const locationMatched = overlap(location, candidate.context) >= 0.5;
  const descriptionMatched = job.description ? overlap(job.description, candidate.context) : 0;
  return Math.round(
    (exactTitle ? 70 : titleOverlap * 60) + 25 + (locationMatched ? 5 : 0) + descriptionMatched * 20
  );
}
function bestDiscoveryCandidate(candidates, job) {
  const ranked = candidates.map((candidate) => ({
    candidate,
    score: discoveryCandidateScore(candidate, job)
  })).filter((entry) => entry.score >= 75).sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].candidate;
}
function duckDuckGoResultTarget(href) {
  try {
    const parsed = new URL(href, "https://html.duckduckgo.com");
    const target = hostMatches2(parsed.hostname.toLowerCase(), "duckduckgo.com") ? parsed.searchParams.get("uddg") : parsed.toString();
    if (!target) return null;
    const destination = new URL(target);
    if (destination.protocol !== "https:" || isDiscoveryOnlyHost(destination.hostname))
      return null;
    return destination.toString();
  } catch {
    return null;
  }
}
function companyHostMatched(company, hostname2) {
  const host = compact(hostname2);
  return compact(company).split(" ").filter((token) => token.length >= 3 && !COMPANY_NOISE_WORDS.has(token)).some((token) => host.includes(token));
}
function directEmployerCandidateScore(candidate, job) {
  let destination;
  try {
    destination = new URL(candidate.href);
  } catch {
    return 0;
  }
  if (destination.protocol !== "https:" || isDiscoveryOnlyHost(destination.hostname))
    return 0;
  const titleOverlap = overlap(job.title, candidate.title);
  if (titleOverlap < 0.72) return 0;
  const directAts = DIRECT_APPLICATION_DOMAINS.some(
    (domain) => hostMatches2(destination.hostname.toLowerCase(), domain)
  );
  if (!directAts && !companyHostMatched(job.company_name, destination.hostname))
    return 0;
  const exactTitle = compact(candidate.title) === compact(job.title);
  const location = job.location.split(",")[0] ?? job.location;
  const locationMatched = overlap(location, candidate.context) >= 0.5;
  const descriptionMatched = job.description ? overlap(job.description, candidate.context) : 0;
  return Math.round(
    (exactTitle ? 70 : titleOverlap * 60) + (directAts ? 20 : 25) + (locationMatched ? 5 : 0) + descriptionMatched * 20
  );
}
function bestDirectEmployerCandidate(candidates, job) {
  const ranked = candidates.map((candidate) => ({
    candidate,
    score: directEmployerCandidateScore(candidate, job)
  })).filter((entry) => entry.score >= 75).sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].candidate;
}

// src/lib/application-runner/runtime-config.ts
function applicationRunnerHeadless(input) {
  if (!input.hasCustomExecutable) return true;
  return !/^(?:0|false|no|off)$/i.test(input.configured?.trim() ?? "");
}
function applicationRunnerWindowArgs(headless) {
  return headless ? [] : ["--window-position=-32000,-32000", "--window-size=1440,1000"];
}

// src/lib/security/public-url.ts
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
var reservedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) reservedIpv4.addSubnet(network, prefix, "ipv4");
var reservedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
]) reservedIpv6.addSubnet(network, prefix, "ipv6");
function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);
  return family === 4 ? reservedIpv4.check(normalized, "ipv4") : family === 6 ? reservedIpv6.check(normalized, "ipv6") : true;
}
function normalizedLookupAddresses(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  const addresses = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return [];
    const record = item;
    if (typeof record.address !== "string") return [];
    const address = record.address.trim().toLowerCase();
    const family = isIP(address);
    if (family !== 4 && family !== 6 || record.family !== family) return [];
    addresses.push({ address, family });
  }
  return addresses;
}
async function resolvePublicHttpsUrl(value) {
  if (!value || value.length > 2048) throw new Error("The application URL is invalid.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new Error("Use a public HTTPS application URL without embedded credentials.");
  }
  const hostname2 = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname2 === "localhost" || hostname2.endsWith(".local") || hostname2.endsWith(".internal")) {
    throw new Error("The URL does not resolve to a public website.");
  }
  const lookupResult = isIP(hostname2) ? [{ address: hostname2, family: isIP(hostname2) }] : await lookup(hostname2, { all: true, verbatim: true });
  const addresses = normalizedLookupAddresses(lookupResult);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("The URL does not resolve to a public website.");
  }
  return { url, addresses };
}
async function validatePublicHttpsUrl(value) {
  return (await resolvePublicHttpsUrl(value)).url;
}

// src/lib/security/pinned-https.ts
import https from "node:https";
import { isIP as isIP2 } from "node:net";
function createPinnedLookup(address, family) {
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}
async function getPinnedPublicHttps(value, options) {
  const resolved = await resolvePublicHttpsUrl(value);
  const tlsHost = resolved.url.hostname.replace(/^\[|\]$/g, "");
  let lastError;
  for (const approvedAddress of resolved.addresses) {
    try {
      return await new Promise((resolve, reject) => {
        const request = https.request(resolved.url, {
          method: "GET",
          headers: options.headers,
          ...isIP2(tlsHost) ? {} : { servername: tlsHost },
          lookup: createPinnedLookup(
            approvedAddress.address,
            approvedAddress.family
          )
        }, (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
            return;
          }
          const declared = Number(response.headers["content-length"] ?? "0");
          if (Number.isFinite(declared) && declared > options.maxBytes) {
            response.destroy();
            reject(new Error("The source page is too large to analyse safely."));
            return;
          }
          const chunks = [];
          let total = 0;
          response.on("data", (chunk) => {
            total += chunk.byteLength;
            if (total > options.maxBytes) {
              response.destroy(new Error("The source page is too large to analyse safely."));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks, total) }));
          response.on("error", reject);
        });
        request.setTimeout(options.timeoutMs, () => request.destroy(new Error("The source took too long to respond.")));
        request.on("error", reject);
        request.end();
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The source page could not be loaded.");
}

// src/lib/resume/export.ts
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun
} from "docx";
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";

// src/lib/candidate-name.ts
var GENERIC_NAME = /^(contractor|candidate|applicant|cv|resume|curriculum vitae|profile|professional profile|summary|professional summary|skills|experience|employment|career history)$/i;
var ROLE_WORD = /^(engineer|developer|manager|consultant|contractor|analyst|architect|specialist|director|officer|lead)$/i;
function cleanName(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
function nameParts(value) {
  const name = cleanName(value);
  if (!name || GENERIC_NAME.test(name) || /[@|:/\\]|https?:|www\.|linkedin|\d{2,}/i.test(name)) return null;
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 6 || parts.some((part) => !/^[\p{L}][\p{L}'’.\-]*$/u.test(part)) || parts.some((part) => ROLE_WORD.test(part))) return null;
  return parts;
}
function looksLikeCvName(value) {
  const parts = nameParts(value);
  if (!parts) return false;
  return parts.filter((part) => new RegExp("^\\p{Lu}", "u").test(part)).length >= 2;
}
function resolveCandidateName(profileName, cvText) {
  const supplied = cleanName(profileName);
  if (nameParts(supplied)) return supplied;
  const cvName = cvText.replace(/\r\n?/g, "\n").split("\n").slice(0, 10).map(cleanName).find(looksLikeCvName);
  return cvName ?? null;
}

// src/lib/resume/export.ts
var SECTION_HEADING = /^(profile|professional profile|summary|professional summary|skills|technical skills|core skills|experience|professional experience|employment|career history|education|qualifications|certifications?|projects?|verified role skills)$/i;
function normaliseExportText(value) {
  return normaliseResumeText(value).replace(/\n{4,}/g, "\n\n\n");
}
function isHeading(line) {
  const value = line.trim();
  return SECTION_HEADING.test(value) || /^[A-Z][A-Z &/+-]{2,}$/.test(value) && value.length <= 42;
}
function safeCandidateName(request) {
  const resolved = resolveCandidateName(request.candidateName, request.resumeText);
  if (resolved) return resolved;
  throw new Error("A candidate name is required before exporting the Resume.");
}
function bodyLines(request) {
  const lines = normaliseExportText(request.resumeText).split("\n");
  const name = safeCandidateName(request).toLocaleLowerCase("en-GB");
  const firstContentIndex = lines.findIndex((line) => line.trim().toLocaleLowerCase("en-GB") !== name);
  return firstContentIndex === -1 ? [] : lines.slice(firstContentIndex);
}
async function buildResumeDocx(request) {
  const name = safeCandidateName(request);
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: name, bold: true, size: 34, color: "087A5B", font: "Arial" })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, color: "A7F3D0", size: 10, space: 10 } },
      children: []
    })
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
          children: [new TextRun({ text: line.toLocaleUpperCase("en-GB"), bold: true, color: "096048", size: 21, font: "Arial" })]
        })
      );
      continue;
    }
    if (/^[•*-]\s+/.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80, line: 286 },
          children: [new TextRun({ text: line.replace(/^[•*-]\s+/, ""), size: 20, color: "1E293B", font: "Arial" })]
        })
      );
      continue;
    }
    children.push(
      new Paragraph({
        spacing: { after: 100, line: 286 },
        children: [new TextRun({ text: line, size: 20, color: "1E293B", font: "Arial" })]
      })
    );
  }
  const document2 = new Document({
    creator: name,
    title: `${name} - Resume`,
    description: "Curriculum Vitae",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20, color: "1E293B" }, paragraph: { spacing: { line: 286 } } },
        heading1: { run: { font: "Arial", size: 21, bold: true, color: "096048" } }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 900, right: 1050, bottom: 900, left: 1050 }
          }
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 120 },
                children: [
                  new TextRun({ text: "Page ", color: "64748B", size: 16, font: "Arial" }),
                  new TextRun({ children: [PageNumber.CURRENT], color: "64748B", size: 16, font: "Arial" })
                ]
              })
            ]
          })
        },
        children
      }
    ]
  });
  return Packer.toBuffer(document2);
}
function pdfSafe(value) {
  return value.normalize("NFKD").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2022/g, "-").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "");
}
async function buildResumePdf(request) {
  const name = safeCandidateName(request);
  const chunks = [];
  const document2 = new PDFDocument({
    size: "A4",
    margins: { top: 48, right: 54, bottom: 54, left: 54 },
    bufferPages: true,
    info: {
      Title: `${name} - Resume`,
      Author: name,
      Subject: "Curriculum Vitae"
    }
  });
  document2.on("data", (chunk) => chunks.push(chunk));
  const completed2 = new Promise((resolve, reject) => {
    document2.on("end", () => resolve(Buffer.concat(chunks)));
    document2.on("error", reject);
  });
  document2.font("Helvetica-Bold").fontSize(22).fillColor("#087A5B").text(pdfSafe(name), { align: "center" });
  document2.moveDown(0.65);
  document2.strokeColor("#A7F3D0").lineWidth(1.2).moveTo(54, document2.y).lineTo(541, document2.y).stroke();
  document2.moveDown(0.8);
  for (const rawLine of bodyLines(request)) {
    const line = rawLine.trim();
    if (!line) {
      document2.moveDown(0.45);
      continue;
    }
    if (isHeading(line)) {
      document2.moveDown(0.55);
      document2.font("Helvetica-Bold").fontSize(10.5).fillColor("#096048").text(pdfSafe(line.toLocaleUpperCase("en-GB")), {
        characterSpacing: 0.7
      });
      document2.moveDown(0.3);
      continue;
    }
    const bullet = /^[•*-]\s+/.test(line);
    document2.font("Helvetica").fontSize(9.6).fillColor("#1E293B");
    document2.text(pdfSafe(bullet ? `- ${line.replace(/^[•*-]\s+/, "")}` : line), {
      indent: bullet ? 12 : 0,
      lineGap: 2.3,
      paragraphGap: 4
    });
  }
  const range = document2.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    document2.switchToPage(page);
    const originalBottomMargin = document2.page.margins.bottom;
    document2.page.margins.bottom = 18;
    document2.font("Helvetica").fontSize(7.5).fillColor("#64748B").text(pdfSafe(`Page ${page + 1} of ${range.count}`), 54, 811, {
      width: 487,
      align: "center",
      lineBreak: false
    });
    document2.page.margins.bottom = originalBottomMargin;
  }
  document2.end();
  return completed2;
}

// src/lib/email/resend.ts
import { Resend } from "resend";

// src/lib/email/inbox-alias.ts
function parseApplicationInboxAlias(value) {
  const address = value.trim().toLowerCase();
  const match = address.match(
    /^([a-z0-9._+-]+)-a([0-9a-f]{32})@([a-z0-9.-]+)$/
  );
  if (!match)
    return { baseAlias: address };
  const compact2 = match[2];
  return {
    baseAlias: `${match[1]}@${match[3]}`,
    applicationId: `${compact2.slice(0, 8)}-${compact2.slice(8, 12)}-${compact2.slice(12, 16)}-${compact2.slice(16, 20)}-${compact2.slice(20)}`
  };
}

// src/lib/application-runner/run.ts
var MAX_STEPS = 24;
var MAX_FIELDS = 180;
var MAX_RESUME_BYTES = 8e6;
function runnerBudgetMs(override) {
  const configured = Number(
    override ?? process.env.APPLICATION_RUNNER_BUDGET_MS ?? 0
  );
  if (!Number.isFinite(configured) || configured <= 0) return 1e5;
  return Math.max(6e4, Math.min(Math.floor(configured), 10 * 6e4));
}
function clean(value, max = 500) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function resultId(applicationId, destination) {
  return `ir35-${createHash("sha256").update(`${applicationId}:${destination}`).digest("hex").slice(0, 18)}`;
}
function reviewReceipt(message, fields, action, destination, diagnostic) {
  return {
    state: "needs_user",
    providerSubmissionId: "",
    submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
    message,
    destination,
    review: {
      action,
      diagnostic,
      questions: fields.slice(0, 30).map((field) => ({
        id: `native:${field.id}`,
        label: field.label || field.name || "Employer question",
        required: field.required,
        options: field.options
      }))
    }
  };
}
async function pageDiagnostic(page, blockedHosts = /* @__PURE__ */ new Set(), networkFailures = /* @__PURE__ */ new Set()) {
  const title = clean(await page.title().catch(() => ""), 160);
  const headingNodes = page.locator(
    "h1:visible, h2:visible, h3:visible, legend:visible"
  );
  const headings = [];
  for (let index = 0; index < Math.min(await headingNodes.count(), 20); index += 1) {
    const label = clean(
      await headingNodes.nth(index).innerText().catch(() => ""),
      180
    );
    if (label && !headings.includes(label)) headings.push(label);
  }
  const actionNodes = page.locator(
    'button:visible, input[type="submit"]:visible, input[type="button"]:visible, [role="button"]:visible, a:visible'
  );
  const actions = [];
  for (let index = 0; index < Math.min(await actionNodes.count(), 80); index += 1) {
    const item = actionNodes.nth(index);
    const label = clean(
      `${await item.innerText().catch(() => "")} ${await item.getAttribute("value") ?? ""} ${await item.getAttribute("aria-label") ?? ""}`,
      180
    );
    if (!label || actions.some((entry) => entry.label === label)) continue;
    actions.push({
      label,
      enabled: await item.isEnabled().catch(() => false),
      role: clean(
        await item.getAttribute("role") || await item.evaluate((node) => node.tagName.toLowerCase()).catch(() => "control"),
        30
      )
    });
  }
  const controlNodes = page.locator(
    'input:not([type="hidden"]):visible, input[type="file"], select:visible, textarea:visible, [role="checkbox"]:visible, [role="radio"]:visible, [role="combobox"]:visible'
  );
  const controls = [];
  for (let index = 0; index < Math.min(await controlNodes.count(), 80); index += 1) {
    const item = controlNodes.nth(index);
    const snapshot = await item.evaluate((node) => {
      const element = node;
      const labels = "labels" in element ? Array.from(element.labels ?? []).map((label2) => label2.textContent ?? "").join(" ") : "";
      return {
        label: element.getAttribute("aria-label") || labels || element.getAttribute("placeholder") || element.getAttribute("name") || element.getAttribute("role") || element.tagName,
        type: element.getAttribute("type") || element.getAttribute("role") || element.tagName.toLowerCase(),
        required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
        completed: element instanceof HTMLInputElement && element.type === "file" ? Boolean(element.files?.length) : element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? element.checked : Boolean(element.value?.trim()),
        valid: typeof element.checkValidity !== "function" || element.checkValidity()
      };
    });
    const label = clean(snapshot.label, 180);
    if (!label) continue;
    controls.push({
      label,
      type: clean(snapshot.type, 40),
      required: snapshot.required,
      completed: snapshot.completed,
      valid: snapshot.valid
    });
  }
  const messageNodes = page.locator(
    '[role="alert"]:visible, [aria-live="assertive"]:visible, [id*="error" i]:visible, [class*="error-message" i]:visible'
  );
  const messages = [];
  for (let index = 0; index < Math.min(await messageNodes.count(), 30); index += 1) {
    const message = clean(
      await messageNodes.nth(index).innerText().catch(() => ""),
      240
    );
    if (message && !messages.includes(message)) messages.push(message);
  }
  return {
    title,
    headings,
    actions,
    controls,
    blockedHosts: Array.from(blockedHosts).slice(0, 30),
    networkFailures: Array.from(networkFailures).slice(0, 30),
    messages
  };
}
function currentDestination(page, fallback) {
  const value = page?.url() ?? "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
  }
  return fallback;
}
async function publicRequestGuard(route, approvedHosts, sensitiveMode, onBlockedHost) {
  const request = route.request();
  const url = request.url();
  if (/^(data|blob|about):/i.test(url)) return route.continue();
  try {
    const parsed = new URL(url);
    const hostname2 = parsed.hostname.toLowerCase();
    if (!approvedHosts.has(hostname2)) {
      if (nativeRunnerHostAllowed(hostname2)) {
        await validatePublicHttpsUrl(url);
        approvedHosts.add(hostname2);
      } else if (isSafeApplicationHandoffNavigation({
        url,
        method: request.method(),
        resourceType: request.resourceType(),
        isNavigationRequest: request.isNavigationRequest(),
        isTopLevel: !request.frame().parentFrame(),
        sensitive: sensitiveMode()
      })) {
        await validatePublicHttpsUrl(url);
        approvedHosts.add(hostname2);
      } else if (!sensitiveMode() && request.method() === "GET" && ["script", "stylesheet", "image", "font"].includes(
        request.resourceType()
      )) {
        await validatePublicHttpsUrl(url);
      } else {
        if (sensitiveMode()) onBlockedHost?.(hostname2);
        throw new Error("blocked");
      }
    } else if (parsed.protocol !== "https:" || parsed.port && parsed.port !== "443") {
      throw new Error("blocked");
    }
    await route.continue();
  } catch {
    await route.abort("blockedbyclient");
  }
}
async function uploadApprovedResumeForKnownPortal(input) {
  if (input.ats.kind !== "totaljobs" || !input.resume) return false;
  const payload = {
    name: input.resume.name,
    mimeType: input.resume.mimeType,
    buffer: input.resume.buffer
  };
  const fileInputs = input.page.locator('input[type="file"]');
  if (await fileInputs.count()) {
    const inputControl = fileInputs.first();
    const attached = await inputControl.setInputFiles(payload).then(
      async () => inputControl.evaluate(
        (node) => Boolean(node.files?.length)
      )
    ).catch(() => false);
    if (attached) return true;
  }
  const chooseFile = await actionLocator(
    input.page,
    /^(choose file|upload (?:a )?(?:file|cv|resume)|add (?:a )?(?:file|cv|resume))$/i
  );
  if (!chooseFile) return false;
  const chooserPromise = input.page.waitForEvent("filechooser", { timeout: 5e3 }).catch(() => null);
  await chooseFile.click().catch(() => void 0);
  const chooser = await chooserPromise;
  if (!chooser) return false;
  await chooser.setFiles(payload);
  return true;
}
async function actionLocator(page, pattern) {
  const actions = page.locator(
    'button, input[type="submit"], input[type="button"], a[role="button"], a'
  );
  const count = Math.min(await actions.count(), 150);
  for (let index = 0; index < count; index += 1) {
    const item = actions.nth(index);
    if (!await item.isVisible().catch(() => false) || !await item.isEnabled().catch(() => false))
      continue;
    if (matchesApplicationAction(pattern, [
      await item.innerText().catch(() => ""),
      await item.getAttribute("value"),
      await item.getAttribute("aria-label")
    ]))
      return item;
  }
  return null;
}
async function actionLocatorMatching(page, matches) {
  const actions = page.locator(
    'button, input[type="submit"], input[type="button"], a[role="button"], a'
  );
  const count = Math.min(await actions.count(), 150);
  for (let index = 0; index < count; index += 1) {
    const item = actions.nth(index);
    if (!await item.isVisible().catch(() => false) || !await item.isEnabled().catch(() => false))
      continue;
    const label = clean(
      `${await item.innerText().catch(() => "")} ${await item.getAttribute("value") ?? ""} ${await item.getAttribute("aria-label") ?? ""}`,
      220
    );
    if (label && matches(label)) return item;
  }
  return null;
}
async function hasApplicationForm(page) {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="search"]), select, textarea'
  );
  const count = Math.min(await controls.count(), 30);
  let applicationSignals = 0;
  let hasResumeUpload = false;
  let hasNameField = false;
  let hasContactField = false;
  for (let index = 0; index < count; index += 1) {
    const item = controls.nth(index);
    if (!await item.isVisible().catch(() => false)) continue;
    const text = clean(
      `${await item.getAttribute("name") ?? ""} ${await item.getAttribute("autocomplete") ?? ""} ${await item.getAttribute("aria-label") ?? ""} ${await item.getAttribute("placeholder") ?? ""}`
    );
    const type = (await item.getAttribute("type") ?? "").toLowerCase();
    if (isJobBoardUtilityControl(text)) continue;
    if (type === "file" && /(resume|cv|curriculum)/i.test(text))
      hasResumeUpload = true;
    if (/(first.?name|last.?name|full.?name|given.?name|family.?name)/i.test(text))
      hasNameField = true;
    if (/(email|phone|mobile)/i.test(text)) hasContactField = true;
    if (/(first.?name|last.?name|full.?name|email|phone|mobile|resume|curriculum|cover.?letter|sponsor|authori[sz]|postal|postcode|address)/i.test(
      text
    ))
      applicationSignals += 1;
  }
  return isApplicationFormEvidence({
    hasResumeUpload,
    hasNameField,
    hasContactField,
    applicationSignals
  });
}
async function clickAndFollow(page, action, settleMs) {
  const popupPromise = page.waitForEvent("popup", { timeout: 1500 }).catch(() => null);
  try {
    await action.click({ timeout: 12e3 });
  } catch (error) {
    const stillActionable = await action.isVisible().catch(() => false) && await action.isEnabled().catch(() => false);
    if (!stillActionable) throw error;
    await action.click({ timeout: 5e3, force: true });
  }
  const popup = await popupPromise;
  const destination = popup ?? page;
  await destination.waitForLoadState("domcontentloaded", { timeout: 2e4 }).catch(() => null);
  await destination.waitForTimeout(settleMs);
  await validatePublicHttpsUrl(destination.url());
  return destination;
}
async function openApplicationForm(initialPage, ats) {
  let page = initialPage;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const dismiss = await actionLocator(
      page,
      /^(decline all|reject all|reject optional cookies|only necessary cookies|just necessary|no,? thanks(?:,? take me to the job)?|continue to job|take me to the job)$/i
    );
    if (dismiss) {
      page = await clickAndFollow(page, dismiss, 300);
      continue;
    }
    if (await hasApplicationForm(page)) break;
    const apply = await actionLocator(page, ats.applyPattern);
    if (!apply) break;
    page = await clickAndFollow(page, apply, 800);
  }
  return page;
}
async function cvLibraryCandidates(page) {
  const anchors = page.locator('a[href^="/job/"]');
  const count = Math.min(await anchors.count(), 80);
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const href = await anchor.getAttribute("href").catch(() => null) ?? "";
    if (!/^\/job\/\d+\//.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = clean(await anchor.innerText().catch(() => ""), 240);
    if (!title) continue;
    const context = clean(
      await anchor.evaluate((node) => {
        let current = node;
        let useful = current.innerText || current.textContent || "";
        for (let depth = 0; depth < 7 && current.parentElement; depth += 1) {
          current = current.parentElement;
          const text = current.innerText || current.textContent || "";
          if (text.length <= 1800) useful = text;
          if (/\b(posted|contract|temporary|per (?:hour|day)|easy apply)\b/i.test(
            text
          ))
            break;
        }
        return useful;
      }).catch(() => ""),
      1800
    );
    candidates.push({ title, context, href });
  }
  return candidates;
}
async function totalJobsCandidates(page) {
  const anchors = page.locator('a[href^="/job/"]');
  const count = Math.min(await anchors.count(), 120);
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const href = await anchor.getAttribute("href").catch(() => null) ?? "";
    if (!/^\/job\/.+-job\d+(?:[/?#]|$)/i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = clean(await anchor.innerText().catch(() => ""), 240);
    if (!title) continue;
    const context = clean(
      await anchor.evaluate((node) => {
        const article = node.closest("article");
        if (article) return article.innerText || article.textContent || "";
        let current = node;
        let useful = current.innerText || current.textContent || "";
        for (let depth = 0; depth < 8 && current.parentElement; depth += 1) {
          current = current.parentElement;
          const text = current.innerText || current.textContent || "";
          if (text.length <= 2200) useful = text;
        }
        return useful;
      }).catch(() => ""),
      2200
    );
    candidates.push({ title, context, href });
  }
  return candidates;
}
function totalJobsSearchUrl(job) {
  const slug = clean(job.title, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const url = new URL(`https://www.totaljobs.com/jobs/${slug || "contract"}`);
  url.searchParams.set("keywords", job.title);
  return url.toString();
}
function directEmployerSearchUrl(job) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set(
    "q",
    `${job.company_name} ${job.title} ${job.location.split(",")[0] || job.location}`
  );
  return url.toString();
}
async function directEmployerSearchCandidates(page) {
  const results = page.locator(".result");
  const count = Math.min(await results.count(), 12);
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < count; index += 1) {
    const result = results.nth(index);
    const anchor = result.locator("a.result__a").first();
    if (!await anchor.count()) continue;
    const href = duckDuckGoResultTarget(
      await anchor.getAttribute("href").catch(() => null) ?? ""
    ) ?? "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const title = clean(await anchor.innerText().catch(() => ""), 240);
    const context = clean(await result.innerText().catch(() => ""), 2400);
    if (title && context) candidates.push({ title, context, href });
  }
  return candidates;
}
async function directEmployerSearchCandidatesFromServer(job) {
  const response = await fetch(directEmployerSearchUrl(job), {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (compatible; IR35Careers/1.0; +https://www.ir35careers.com)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok)
    throw new Error(`direct_source_search_http_${response.status}`);
  const html = await response.text();
  if (html.length > 2e6)
    throw new Error("direct_source_search_too_large");
  return directEmployerCandidatesFromSearchHtml(html);
}
async function resolveDirectEmployerPage(page, job) {
  const searchPage = await page.context().newPage();
  try {
    let candidates = await directEmployerSearchCandidatesFromServer(job).catch(
      () => []
    );
    if (!candidates.length) {
      await searchPage.goto(directEmployerSearchUrl(job), {
        waitUntil: "domcontentloaded",
        timeout: 2e4
      });
      candidates = await directEmployerSearchCandidates(searchPage);
    }
    const match = bestDirectEmployerCandidate(candidates, job);
    if (!match) throw new Error("direct_source_match_unavailable");
    await validatePublicHttpsUrl(match.href);
    await searchPage.goto(match.href, {
      waitUntil: "domcontentloaded",
      timeout: 25e3
    });
    const [heading, body] = await Promise.all([
      searchPage.locator("h1, h2").first().innerText().catch(() => searchPage.title()),
      searchPage.locator("body").innerText().catch(() => "")
    ]);
    const verified = bestDirectEmployerCandidate(
      [
        {
          title: clean(heading, 240),
          context: clean(body, 12e3),
          href: searchPage.url()
        }
      ],
      job
    );
    if (!verified) throw new Error("direct_source_verification_failed");
    await page.close().catch(() => void 0);
    return searchPage;
  } catch {
    await searchPage.close().catch(() => void 0);
    return null;
  }
}
async function resolveDiscoveryApplicationPage(page, job) {
  let host = "";
  try {
    host = new URL(page.url()).hostname.toLowerCase();
  } catch {
    return page;
  }
  if (!isDiscoveryOnlyHost(host)) return page;
  const directEmployerPage = await resolveDirectEmployerPage(page, job);
  if (directEmployerPage) return directEmployerPage;
  if (!(host === "adzuna.co.uk" || host.endsWith(".adzuna.co.uk"))) return page;
  const [body, html] = await Promise.all([
    page.locator("body").innerText().catch(() => ""),
    page.content().catch(() => "")
  ]);
  for (const provider of discoveryProviderOrder({ body, html })) {
    const searchPage = await page.context().newPage();
    try {
      await searchPage.goto(
        provider === "cv_library" ? "https://www.cv-library.co.uk/search-jobs" : totalJobsSearchUrl(job),
        {
          waitUntil: "domcontentloaded",
          timeout: 25e3
        }
      );
      const essentialCookies = await actionLocator(
        searchPage,
        /^(essential cookies only|reject optional cookies|only necessary cookies)$/i
      );
      if (essentialCookies)
        await clickAndFollow(searchPage, essentialCookies, 250).catch(
          () => void 0
        );
      if (provider === "cv_library") {
        const keywordInput = searchPage.getByRole("combobox", {
          name: /keywords/i
        });
        const locationInput = searchPage.getByRole("combobox", {
          name: /location/i
        });
        if (!await keywordInput.count() || !await locationInput.count())
          throw new Error("search_unavailable");
        await keywordInput.first().fill(job.title);
        await locationInput.first().fill(job.location.split(",")[0] || job.location);
        const findJobs = searchPage.getByRole("button", {
          name: /^find jobs$/i
        });
        if (!await findJobs.count()) throw new Error("search_unavailable");
        await clickAndFollow(searchPage, findJobs.first(), 1200);
      }
      const match = bestDiscoveryCandidate(
        provider === "cv_library" ? await cvLibraryCandidates(searchPage) : await totalJobsCandidates(searchPage),
        job
      );
      if (!match) throw new Error("source_match_unavailable");
      const directUrl = new URL(match.href, searchPage.url());
      await validatePublicHttpsUrl(directUrl.toString());
      await searchPage.goto(directUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 25e3
      });
      await page.close().catch(() => void 0);
      return searchPage;
    } catch {
      await searchPage.close().catch(() => void 0);
    }
  }
  return page;
}
async function blocker(page) {
  const captcha = page.locator(
    'iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]'
  );
  if (await captcha.first().isVisible().catch(() => false))
    return {
      message: "The employer requires a CAPTCHA. Complete this verification before the application can continue.",
      action: "captcha"
    };
  const password = page.locator('input[type="password"]:visible');
  if (await password.count())
    return {
      message: "The employer requires an account sign-in or verification step. Complete it before the application can continue.",
      action: "employer_login"
    };
  const verificationText = clean(
    await page.locator("body").innerText().catch(() => ""),
    2e4
  );
  if (/(enter the verification code|two-factor authentication|2-step verification|check your email for a code)/i.test(
    verificationText
  )) {
    return {
      message: "The employer requires a verification code. Enter it before the application can continue.",
      action: "verification_code"
    };
  }
  if (/(sign in to (?:continue|apply)|log in to (?:continue|apply)|create an account to apply|register to apply)/i.test(
    verificationText
  )) {
    return {
      message: "The job board requires your account sign-in before it will accept this application.",
      action: "employer_login"
    };
  }
  return null;
}
async function visibleInput(page, selector) {
  const inputs = page.locator(selector);
  const count = Math.min(await inputs.count(), 20);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (await input.isVisible().catch(() => false)) return input;
  }
  return null;
}
async function handlePortalAccess(page, payload, runtime, ats, requestedAfter, accountState, accountAccessAttempts = 0, accountRecoveryAttempted = false, passwordAttemptCount = 0) {
  const captcha = page.locator(
    'iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]'
  );
  if (await captcha.first().isVisible().catch(() => false)) {
    return {
      handled: false,
      stop: {
        message: "The employer has requested a CAPTCHA. Open the employer page, complete the security check, then retry this application.",
        action: "captcha"
      }
    };
  }
  const bodyText = clean(
    await page.locator("body").innerText().catch(() => ""),
    25e3
  );
  const managedAlias = parseApplicationInboxAlias(payload.candidate.email).applicationId === payload.applicationId;
  const codeInput = await visibleInput(
    page,
    'input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[aria-label*="code" i], input[placeholder*="code" i]'
  );
  if (codeInput && /(verification|verify|security code|one.?time|check your email|enter.*code)/i.test(
    bodyText
  )) {
    if (!payload.candidate.automaticEmailVerification || !runtime?.resolveEmailVerificationCode) {
      return {
        handled: false,
        stop: {
          message: "The employer sent a verification code. Enable email verification in your profile, or open the employer page and enter the code yourself.",
          action: "verification_code"
        }
      };
    }
    const resendControls = page.locator(
      'button:visible, a:visible, input[type="button"]:visible'
    );
    const resendCount = Math.min(await resendControls.count(), 40);
    for (let index = 0; index < resendCount; index += 1) {
      const control = resendControls.nth(index);
      const label = clean(
        await control.innerText().catch(() => "") || await control.getAttribute("value").catch(() => "") || "",
        120
      );
      if (!isVerificationResendControl(label)) continue;
      if (await control.isEnabled().catch(() => false))
        await clickAndFollow(page, control, 600).catch(() => void 0);
      break;
    }
    const code = await runtime.resolveEmailVerificationCode({
      hostname: new URL(page.url()).hostname,
      requestedAfter
    });
    if (!code)
      return {
        handled: false,
        stop: {
          message: "The employer verification email has not arrived in your IR35Careers inbox yet. IR35Careers will keep checking and continue automatically when it arrives.",
          action: "verification_code"
        }
      };
    await codeInput.fill(code);
    const verify = await actionLocator(
      page,
      /^(verify|confirm|continue|submit|next)$/i
    );
    if (!verify)
      return {
        handled: false,
        stop: {
          message: "The verification code was received, but the employer's confirmation control could not be identified.",
          action: "unsupported_form"
        }
      };
    await clickAndFollow(page, verify, 800);
    return { handled: true, accountCreated: true };
  }
  if (managedAlias && payload.candidate.automaticEmailVerification && runtime?.resolveEmailActionLink && isEmployerEmailLinkPending(bodyText)) {
    const actionLink = await runtime.resolveEmailActionLink({
      hostname: new URL(page.url()).hostname,
      requestedAfter,
      purpose: accountRecoveryAttempted ? "account_recovery" : "account_verification"
    });
    if (!actionLink)
      return {
        handled: false,
        recoveryAttempted: accountRecoveryAttempted,
        stop: {
          message: "The employer email link has not arrived in your IR35Careers inbox yet. IR35Careers will keep checking and continue automatically when it arrives.",
          action: "verification_link"
        }
      };
    const verifiedActionLink = await validatePublicHttpsUrl(actionLink);
    await page.goto(verifiedActionLink.toString(), {
      waitUntil: "domcontentloaded"
    });
    return {
      handled: true,
      accountCreated: !accountRecoveryAttempted,
      accountRecovered: accountRecoveryAttempted,
      recoveryAttempted: accountRecoveryAttempted
    };
  }
  const passwordInputs = page.locator('input[type="password"]:visible');
  const passwordCount = Math.min(await passwordInputs.count(), 3);
  const emailInput = await visibleInput(
    page,
    'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]'
  );
  const emailContinuation = emailInput ? await actionLocator(page, /^continue with email$/i) : null;
  const applicationFormVisible = await hasApplicationForm(page);
  const accountAccessPage = Boolean(emailContinuation) || isEmployerAccountAccessPage({
    body: bodyText,
    hasEmailInput: Boolean(emailInput),
    hasPasswordInput: passwordCount > 0,
    hasApplicationForm: applicationFormVisible
  });
  if (accountAccessPage) {
    const guestApplication = await actionLocatorMatching(
      page,
      isEmployerGuestApplicationControl
    );
    if (guestApplication) {
      await clickAndFollow(page, guestApplication, 900);
      return { handled: true };
    }
    const canUseManagedEmail = Boolean(
      managedAlias && payload.candidate.automaticEmailVerification && runtime?.resolveEmailActionLink
    );
    const passwordlessAccess = canUseManagedEmail ? await actionLocatorMatching(page, isEmployerPasswordlessAccessControl) : null;
    if (passwordlessAccess) {
      if (emailInput) await emailInput.fill(payload.candidate.email);
      await clickAndFollow(page, passwordlessAccess, 900);
      return {
        handled: true,
        recoveryAttempted: true
      };
    }
    const createAccount = await actionLocatorMatching(
      page,
      isEmployerAccountCreationControl
    );
    const signIn = await actionLocator(page, /^(sign in|log in)$/i);
    const accountMissing = isEmployerAccountMissing(bodyText);
    const accountAlreadyExists = /(account|email).{0,40}(already exists|already registered|is registered)|sign in instead/i.test(
      bodyText
    );
    const resolvedPortalPassword = await runtime?.resolvePortalPassword?.(
      new URL(page.url()).hostname.toLowerCase()
    );
    const portalPasswords = employerPortalPasswordCandidates({
      resolvedPassword: resolvedPortalPassword,
      destinationPassword: runtime?.portalPassword
    });
    const portalPassword = portalPasswords[Math.min(passwordAttemptCount, Math.max(0, portalPasswords.length - 1))];
    if (!payload.candidate.portalAccountConsent || !portalPassword) {
      return {
        handled: false,
        stop: {
          message: "This employer requires an application account. Enable employer account automation in your profile, or sign in on the employer page.",
          action: "employer_login"
        }
      };
    }
    const authenticationFailed = isEmployerAuthenticationFailure(bodyText);
    const passwordSetupPage = isEmployerPasswordSetupPage(bodyText);
    const triedEveryPassword = passwordAttemptCount >= Math.max(1, portalPasswords.length);
    const shouldRecoverAccount = Boolean(
      managedAlias && payload.candidate.automaticEmailVerification && payload.candidate.employerTermsConsent && runtime?.resolveEmailActionLink && !passwordSetupPage && !accountMissing && !accountRecoveryAttempted && (authenticationFailed && triedEveryPassword || accountAccessAttempts >= Math.max(4, portalPasswords.length + 2))
    );
    if (shouldRecoverAccount) {
      const resetControl = await actionLocatorMatching(
        page,
        isEmployerAccountRecoveryControl
      );
      if (!resetControl)
        return {
          handled: false,
          clearSession: authenticationFailed,
          stop: {
            message: "IR35Careers tried the employer's available sign-in, account creation, email-link and password-recovery routes. The employer still requires its own account access. Your prepared application is saved.",
            action: "employer_login"
          }
        };
      await clickAndFollow(page, resetControl, 700);
      const recoveryEmail = await visibleInput(
        page,
        'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]'
      );
      if (recoveryEmail) await recoveryEmail.fill(payload.candidate.email);
      const sendRecovery = await actionLocator(
        page,
        /^(send|continue|next|send (?:reset|recovery|sign[ -]?in|magic) link|email me|reset password)$/i
      );
      const recoveryRequestedAfter = new Date(
        Date.now() - 3e4
      ).toISOString();
      if (sendRecovery) await clickAndFollow(page, sendRecovery, 800);
      const actionLink = await runtime?.resolveEmailActionLink?.({
        hostname: new URL(page.url()).hostname,
        requestedAfter: recoveryRequestedAfter,
        purpose: "account_recovery"
      });
      if (!actionLink)
        return {
          handled: false,
          recoveryAttempted: true,
          stop: {
            message: "IR35Careers requested an employer account recovery email and is waiting for its secure link. The application will continue automatically when the email arrives.",
            action: "account_recovery_email"
          }
        };
      const verifiedActionLink = await validatePublicHttpsUrl(actionLink);
      await page.goto(verifiedActionLink.toString(), {
        waitUntil: "domcontentloaded"
      });
      return {
        handled: true,
        accountRecovered: true,
        recoveryAttempted: true
      };
    }
    if (emailInput) await emailInput.fill(payload.candidate.email);
    const names = payload.candidate.fullName.trim().split(/\s+/);
    const firstName = await visibleInput(
      page,
      'input[autocomplete="given-name"], input[name*="first" i]'
    );
    const lastName = await visibleInput(
      page,
      'input[autocomplete="family-name"], input[name*="last" i]'
    );
    if (firstName) await firstName.fill(names[0] ?? "");
    if (lastName) await lastName.fill(names.slice(1).join(" "));
    for (let index = 0; index < passwordCount; index += 1)
      await passwordInputs.nth(index).fill(portalPassword);
    const uncheckedLegal = page.locator(
      'input[type="checkbox"]:visible:not(:checked)'
    );
    const legalCount = Math.min(await uncheckedLegal.count(), 20);
    for (let index = 0; index < legalCount; index += 1) {
      const checkbox = uncheckedLegal.nth(index);
      const label = clean(
        await checkbox.evaluate(
          (node) => node.labels?.[0]?.textContent ?? ""
        ).catch(() => ""),
        300
      );
      if (isEmployerTermsCheckbox(label)) {
        if (!payload.candidate.employerTermsConsent) {
          return {
            handled: false,
            stop: {
              message: "Allow required employer account terms in your Application Profile, then IR35Careers can continue this approved application.",
              action: "employer_terms"
            }
          };
        }
        await checkbox.check();
      }
    }
    const resetPassword = passwordSetupPage ? await actionLocator(
      page,
      /^(reset|set|save|update|change|continue)(?: (?:my|your|new))? password$|^continue$/i
    ) : null;
    if (createAccount && !preferEmployerSignIn({ accountAlreadyExists, accountState }) && requiresEmployerTermsAcceptance(bodyText) && !payload.candidate.employerTermsConsent) {
      return {
        handled: false,
        stop: {
          message: "Allow required employer account terms in your Application Profile, then IR35Careers can create the account and continue this approved application.",
          action: "employer_terms"
        }
      };
    }
    const useSignIn = !accountMissing && preferEmployerSignIn({
      accountAlreadyExists,
      accountState
    });
    const portalContinuation = emailContinuation ?? await actionLocator(page, ats.nextPattern);
    const accessAction = resetPassword ?? (useSignIn ? signIn ?? createAccount ?? portalContinuation : createAccount ?? signIn ?? portalContinuation);
    if (!accessAction)
      return {
        handled: false,
        stop: {
          message: "The employer account form could not be completed automatically. Open the employer page to finish this step.",
          action: "employer_login"
        }
      };
    await clickAndFollow(page, accessAction, 900);
    return {
      handled: true,
      accountRecovered: Boolean(resetPassword),
      recoveryAttempted: accountRecoveryAttempted || Boolean(resetPassword),
      passwordAttempted: Boolean(
        signIn && accessAction === signIn && passwordCount > 0
      ),
      accountCreationStarted: Boolean(
        createAccount && accessAction === createAccount && !useSignIn
      )
    };
  }
  return { handled: false };
}
async function snapshotFields(page, step, atsKind) {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
  );
  const fileUploadCount = await page.locator('input[type="file"]').count();
  const pageCopy = fileUploadCount === 1 ? clean(
    await page.locator("body").innerText().catch(() => ""),
    25e3
  ) : "";
  const singleResumeUpload = shouldTreatSingleFileAsResume({
    atsKind,
    fileUploadCount,
    pageCopy
  });
  const count = Math.min(await controls.count(), MAX_FIELDS);
  const fields = [];
  for (let index = 0; index < count; index += 1) {
    const locator = controls.nth(index);
    const inputType = clean(
      await locator.getAttribute("type").catch(() => "") ?? "",
      40
    ).toLowerCase();
    const isFileUpload = inputType === "file";
    if (!isFileUpload && !await locator.isVisible().catch(() => false) || !await locator.isEnabled().catch(() => false))
      continue;
    const snapshot = await locator.evaluate((node) => {
      const element = node;
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : element.tagName.toLowerCase();
      const ownLabel = "labels" in element ? Array.from(element.labels ?? []).map((label2) => label2.textContent ?? "").join(" ") : "";
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.textContent ?? "";
      const described = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      const label = legend || described || element.getAttribute("aria-label") || ownLabel || element.getAttribute("placeholder") || element.getAttribute("name") || "";
      let options = [];
      if (element instanceof HTMLSelectElement)
        options = Array.from(element.options).map((option) => option.textContent || option.value).filter(Boolean);
      if (element instanceof HTMLInputElement && (type === "radio" || type === "checkbox") && element.name) {
        options = Array.from(
          document.querySelectorAll(
            `input[type="${type}"][name="${CSS.escape(element.name)}"]`
          )
        ).map((input) => input.labels?.[0]?.textContent || input.value).filter(Boolean);
      }
      return {
        type,
        label,
        name: element.getAttribute("name") || "",
        placeholder: element.getAttribute("placeholder") || "",
        required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
        options,
        optionValue: element instanceof HTMLInputElement ? element.value : "",
        optionLabel: ownLabel
      };
    });
    fields.push({
      locator,
      field: {
        id: `step_${step}_field_${index}`,
        index,
        type: clean(snapshot.type, 40),
        label: clean(
          `${snapshot.label}${snapshot.type === "file" && singleResumeUpload ? " Resume upload" : ""}`,
          500
        ),
        name: clean(snapshot.name, 200),
        placeholder: clean(snapshot.placeholder, 300),
        required: snapshot.required,
        options: snapshot.options.map((option) => clean(option, 200)).filter(Boolean).slice(0, 50),
        optionValue: clean(snapshot.optionValue, 200),
        optionLabel: clean(snapshot.optionLabel, 200)
      }
    });
  }
  return fields;
}
async function waitForFillableControls(page) {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea, input[type="file"]'
  );
  const deadline = Date.now() + 12e3;
  while (Date.now() < deadline) {
    const count = Math.min(await controls.count(), MAX_FIELDS);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const type = (await control.getAttribute("type") ?? "").toLowerCase();
      if ((type === "file" || await control.isVisible().catch(() => false)) && await control.isEnabled().catch(() => false))
        return;
    }
    await page.waitForTimeout(300);
  }
}
async function loadResume(url) {
  if (!url) return null;
  const approved = await validatePublicHttpsUrl(url);
  const configuredStorageHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.toLowerCase() : "";
  if (![configuredStorageHost, "ir35careers.com", "www.ir35careers.com"].filter(Boolean).includes(approved.hostname.toLowerCase()))
    return null;
  const response = await getPinnedPublicHttps(approved.toString(), {
    maxBytes: MAX_RESUME_BYTES,
    timeoutMs: 2e4
  });
  if (response.status < 200 || response.status >= 300) return null;
  const bytes = response.body;
  return bytes.length > 0 && bytes.length <= MAX_RESUME_BYTES ? bytes : null;
}
function uploadFromDownloadedResume(buffer) {
  const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const isDocx = buffer[0] === 80 && buffer[1] === 75;
  if (isDocx)
    return {
      buffer,
      name: "IR35Careers-Application-Resume.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
  return {
    buffer,
    name: isPdf ? "IR35Careers-Application-Resume.pdf" : "IR35Careers-Application-Resume.txt",
    mimeType: isPdf ? "application/pdf" : "text/plain"
  };
}
async function approvedResumeUpload(payload, atsKind) {
  const resumeText = payload.resume.text.trim();
  if (atsKind !== "totaljobs") {
    const downloaded = await loadResume(payload.resume.url).catch(() => null);
    if (downloaded) return uploadFromDownloadedResume(downloaded);
  }
  if (!resumeText) {
    const downloaded = await loadResume(payload.resume.url).catch(() => null);
    return downloaded ? uploadFromDownloadedResume(downloaded) : null;
  }
  const format = preferredResumeUploadFormat(atsKind);
  const request = {
    format,
    resumeText,
    candidateName: payload.candidate.fullName,
    jobTitle: payload.job.title,
    companyName: payload.job.company_name,
    versionLabel: payload.resume.label || "Application Resume"
  };
  const generated = format === "docx" ? await buildResumeDocx(request) : await buildResumePdf(request);
  if (generated.length <= 0 || generated.length > MAX_RESUME_BYTES) return null;
  return format === "docx" ? {
    buffer: generated,
    name: "IR35Careers-Application-Resume.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  } : {
    buffer: generated,
    name: "IR35Careers-Application-Resume.pdf",
    mimeType: "application/pdf"
  };
}
function isApplicationMessageField(field) {
  const text = `${field.label} ${field.name} ${field.placeholder}`;
  return /cover\s*letter|supporting\s*(?:statement|information)|application\s*message|^\s*message\b/i.test(
    text
  );
}
async function fillField(input) {
  const { locator, field } = input;
  if (field.type === "file") {
    if (!/(resume|cv|curriculum)/i.test(`${field.label} ${field.name}`) || !input.resume)
      return false;
    await locator.setInputFiles({
      name: input.resume.name,
      mimeType: input.resume.mimeType,
      buffer: input.resume.buffer
    });
    return true;
  }
  let value = isApplicationMessageField(field) ? input.coverLetter : input.value;
  if (input.atsKind === "totaljobs" && /phone|mobile|telephone/i.test(
    `${field.label} ${field.name} ${field.placeholder}`
  )) {
    value = value.replace(/\D/g, "");
    if (value.startsWith("0044")) value = value.slice(4);
    else if (value.startsWith("44") && value.length > 10)
      value = value.slice(2);
    if (value.startsWith("0")) value = value.slice(1);
  }
  if (!value) return false;
  if (field.type === "select") {
    const option = closestOption(value, field.options);
    if (!option) return false;
    await locator.selectOption({ label: option }).catch(async () => locator.selectOption(option));
    await locator.blur().catch(() => void 0);
    return true;
  }
  if (field.type === "radio") {
    if (!closestOption(
      value,
      [field.optionLabel, field.optionValue].filter(Boolean)
    ))
      return false;
    await locator.check();
    return true;
  }
  if (field.type === "checkbox") {
    if (!/^(yes|true|1|agree)$/i.test(value.trim())) return false;
    await locator.check();
    return true;
  }
  if (["text", "tel", "email", "url", "number"].includes(field.type) && value.length <= 300) {
    await locator.fill("");
    await locator.pressSequentially(value, { delay: 1 });
  } else {
    await locator.fill(value);
  }
  await locator.blur().catch(() => void 0);
  return true;
}
async function fillStep(page, step, ats, facts, resume, coverLetter, employerTermsConsent) {
  const resumeUploaded = await uploadApprovedResumeForKnownPortal({
    page,
    ats,
    resume
  }).catch(() => false);
  const controls = await snapshotFields(page, step, ats.kind);
  const unknown = [];
  const mappings = /* @__PURE__ */ new Map();
  for (const { field } of controls) {
    const deterministic = deterministicMapping(field);
    if (deterministic) mappings.set(field.id, deterministic);
    else unknown.push(field);
  }
  const aiMappings = await mapUnknownFields(unknown);
  for (const mapping of aiMappings) mappings.set(mapping.fieldId, mapping);
  const needsUser = [];
  const requiredRadioGroups = /* @__PURE__ */ new Map();
  for (const control of controls) {
    const { field } = control;
    if (shouldSkipConsumedResumeInput({
      fieldType: field.type,
      resumeAlreadyUploaded: resumeUploaded
    }))
      continue;
    if (field.type === "checkbox" && canAutomaticallyAcceptEmployerTerms({
      label: `${field.label} ${field.name}`,
      required: field.required,
      consent: employerTermsConsent
    })) {
      await control.locator.check().catch(() => void 0);
      if (await control.locator.isChecked().catch(() => false)) continue;
    }
    if (field.type === "radio") {
      const groupKey = field.name || field.label || field.id;
      if (field.required && !requiredRadioGroups.has(groupKey))
        requiredRadioGroups.set(groupKey, control);
      const groupChecked = await control.locator.evaluate((node) => {
        const input = node;
        if (!input.name) return input.checked;
        return Array.from(document.getElementsByName(input.name)).some(
          (item) => item instanceof HTMLInputElement && item.checked
        );
      }).catch(() => false);
      if (groupChecked) continue;
    }
    if (field.type === "checkbox" && await control.locator.isChecked().catch(() => false))
      continue;
    if (field.type !== "file") {
      const current = await control.locator.inputValue().catch(() => "");
      if (current.trim() && field.type !== "radio" && field.type !== "checkbox")
        continue;
    }
    const directAnswer = screeningAnswer(field, facts);
    const mapping = mappings.get(field.id);
    const value = directAnswer || (mapping ? valueForMapping(mapping, facts) : "");
    const carriesApplicationMaterial = field.type === "file" || isApplicationMessageField(field);
    const canUseMapping = Boolean(
      mapping && mapping.factKey !== "needs_user" && mapping.factKey !== "skip"
    );
    const filled = carriesApplicationMaterial || Boolean(directAnswer) || canUseMapping ? await fillField({
      ...control,
      value,
      resume,
      coverLetter,
      atsKind: ats.kind
    }).catch(() => false) : false;
    if (!filled && field.required && field.type !== "radio")
      needsUser.push(field);
  }
  for (const control of requiredRadioGroups.values()) {
    const groupChecked = await control.locator.evaluate((node) => {
      const input = node;
      if (!input.name) return input.checked;
      return Array.from(document.getElementsByName(input.name)).some(
        (item) => item instanceof HTMLInputElement && item.checked
      );
    }).catch(() => false);
    if (!groupChecked) needsUser.push(control.field);
  }
  return needsUser.filter(
    (field, index, all) => all.findIndex(
      (item) => item.label === field.label && item.name === field.name
    ) === index
  );
}
async function successMessage(page, ats) {
  const body = clean(
    await page.locator("body").innerText().catch(() => ""),
    3e4
  );
  const match = body.match(ats.successPattern)?.[0] ?? "";
  const urlSuccess = /(thank|success|confirmation|application-submitted)/i.test(
    page.url()
  );
  return match || urlSuccess ? clean(match || "Application submitted successfully.", 500) : "";
}
async function waitForSubmissionConfirmation(page, ats) {
  const deadline = Date.now() + 2e4;
  while (Date.now() < deadline) {
    const confirmed = await successMessage(page, ats);
    if (confirmed) return confirmed;
    await page.waitForTimeout(500);
  }
  return "";
}
async function invalidRequiredFields(page, step, ats) {
  const fields = await snapshotFields(page, step, ats.kind);
  const invalid = await Promise.all(
    fields.map(async ({ field, locator }) => {
      if (!field.required) return null;
      const failed2 = await locator.evaluate((node) => {
        const element = node;
        return element.getAttribute("aria-invalid") === "true" || typeof element.checkValidity === "function" && !element.checkValidity();
      }).catch(() => false);
      return failed2 ? field : null;
    })
  );
  return invalid.filter((field) => Boolean(field));
}
async function runNativeApplication(payload, runtime) {
  const startedAt = Date.now();
  const budgetMs = runnerBudgetMs(runtime?.budgetMs);
  const requestedAfter = new Date(startedAt - 10 * 6e4).toISOString();
  let browser = null;
  let context = null;
  let page = null;
  let sessionDisposition = "save";
  let portalAccountState;
  let accountCreationPending = false;
  let accountRecoveryAttempted = false;
  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => null);
  }, budgetMs);
  try {
    const destination = await validatePublicHttpsUrl(payload.destination);
    let ats = detectAts(destination.toString());
    const savedSession = payload.candidate.portalAccountConsent ? await runtime?.loadPortalSession?.().catch(() => null) : null;
    portalAccountState = savedSession?.accountState;
    let startUrl = destination;
    if (savedSession?.currentUrl) {
      try {
        startUrl = await validatePublicHttpsUrl(savedSession.currentUrl);
      } catch {
        startUrl = destination;
      }
    }
    const resume = await approvedResumeUpload(payload, ats.kind);
    const facts = buildRunnerFacts(
      payload.candidate,
      payload.screeningAnswers.map((answer, index) => ({
        id: `saved_${index}`,
        label: answer.label,
        answer: answer.answer,
        source: answer.source,
        required: true,
        reviewed: Boolean(answer.answer.trim())
      }))
    );
    const customExecutablePath = process.env.CHROME_EXECUTABLE_PATH?.trim();
    const executablePath = customExecutablePath || await chromiumBinary.executablePath();
    const headless = applicationRunnerHeadless({
      configured: process.env.APPLICATION_RUNNER_HEADLESS,
      hasCustomExecutable: Boolean(customExecutablePath)
    });
    browser = await chromium.launch({
      executablePath,
      args: customExecutablePath ? [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        ...applicationRunnerWindowArgs(headless)
      ] : chromiumBinary.args,
      headless
    });
    context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: "en-GB",
      timezoneId: "Europe/London",
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1e3 },
      storageState: savedSession?.storageState
    });
    context.setDefaultTimeout(12e3);
    context.setDefaultNavigationTimeout(25e3);
    const approvedHosts = /* @__PURE__ */ new Set([
      destination.hostname,
      startUrl.hostname
    ]);
    const blockedHosts = /* @__PURE__ */ new Set();
    const networkFailures = /* @__PURE__ */ new Set();
    let sensitive = false;
    await context.route(
      "**/*",
      (route) => publicRequestGuard(
        route,
        approvedHosts,
        () => sensitive,
        (hostname2) => blockedHosts.add(hostname2)
      )
    );
    page = await context.newPage();
    context.on("response", (response) => {
      if (response.status() < 400) return;
      try {
        const failed2 = new URL(response.url());
        if (!approvedHosts.has(failed2.hostname.toLowerCase())) return;
        networkFailures.add(
          `${response.request().method()} ${failed2.hostname}${failed2.pathname} returned ${response.status()}`
        );
      } catch {
      }
    });
    context.on("requestfailed", (request) => {
      try {
        const failed2 = new URL(request.url());
        if (!approvedHosts.has(failed2.hostname.toLowerCase())) return;
        networkFailures.add(
          `${request.method()} ${failed2.hostname}${failed2.pathname} failed`
        );
      } catch {
      }
    });
    let navigationStatus = null;
    try {
      const navigation = await page.goto(startUrl.toString(), {
        waitUntil: "domcontentloaded"
      });
      navigationStatus = navigation?.status() ?? null;
    } catch (error) {
      console.warn("application_runner_navigation_failed", {
        host: startUrl.hostname,
        reason: error instanceof Error ? clean(error.message, 240) : "unknown"
      });
      return reviewReceipt(
        "This job listing is no longer available at its original source.",
        [],
        "listing_unavailable",
        currentDestination(page, startUrl.toString())
      );
    }
    const discoveryPage = await resolveDiscoveryApplicationPage(
      page,
      payload.job
    );
    if (discoveryPage !== page) {
      page = discoveryPage;
      navigationStatus = null;
    }
    if (navigationStatus && [401, 403, 429].includes(navigationStatus)) {
      return reviewReceipt(
        "The job board requires a sign-in or browser verification before it will accept this application.",
        [],
        "employer_login",
        currentDestination(page, startUrl.toString())
      );
    }
    if (navigationStatus && navigationStatus >= 400) {
      return reviewReceipt(
        "This job listing is no longer available at its original source.",
        [],
        "listing_unavailable",
        currentDestination(page, startUrl.toString())
      );
    }
    await validatePublicHttpsUrl(page.url());
    ats = detectAts(page.url());
    page = await openApplicationForm(page, ats);
    const handoffBody = clean(
      await page.locator("body").innerText().catch(() => ""),
      8e3
    );
    if (isClosedListingPage(await page.title().catch(() => ""), handoffBody)) {
      sessionDisposition = "clear";
      return reviewReceipt(
        "This role is no longer accepting applications at its original source.",
        [],
        "listing_unavailable",
        currentDestination(page, startUrl.toString())
      );
    }
    if (isSourceAccessDeniedPage(await page.title().catch(() => ""), handoffBody)) {
      const sourceAccountAccess = await actionLocator(
        page,
        /^(login to continue|log in to continue|sign in to continue|continue with email|create account|register)$/i
      );
      if (sourceAccountAccess && payload.candidate.portalAccountConsent) {
        page = await clickAndFollow(page, sourceAccountAccess, 900);
      } else {
        sessionDisposition = "clear";
        return reviewReceipt(
          "The job board blocked access to the employer application page. Continue the same prepared application in your secure desktop browser.",
          [],
          "source_access_denied",
          currentDestination(page, startUrl.toString())
        );
      }
    }
    const applicationDestination = await validatePublicHttpsUrl(page.url());
    approvedHosts.add(applicationDestination.hostname.toLowerCase());
    ats = detectAts(applicationDestination.toString());
    let portalAccessAttempts = 0;
    let portalPasswordAttempts = 0;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (Date.now() - startedAt >= budgetMs) {
        return reviewReceipt(
          "The employer portal did not finish within the safe application window. Your approved application is ready to retry.",
          [],
          "runner_timeout",
          currentDestination(page, startUrl.toString())
        );
      }
      const portalAccess = await handlePortalAccess(
        page,
        payload,
        runtime,
        ats,
        requestedAfter,
        portalAccountState,
        portalAccessAttempts,
        accountRecoveryAttempted,
        portalPasswordAttempts
      );
      if (portalAccess.accountCreated) {
        portalAccountState = "created";
        accountCreationPending = false;
      }
      if (portalAccess.accountCreationStarted) accountCreationPending = true;
      if (portalAccess.accountRecovered) {
        portalAccountState = "recovered";
        accountCreationPending = false;
      }
      if (portalAccess.recoveryAttempted) accountRecoveryAttempted = true;
      if (portalAccess.passwordAttempted) portalPasswordAttempts += 1;
      if (portalAccess.clearSession) sessionDisposition = "clear";
      if (portalAccess.stop)
        return reviewReceipt(
          portalAccess.stop.message,
          [],
          portalAccess.stop.action,
          currentDestination(page, startUrl.toString()),
          await pageDiagnostic(page, blockedHosts, networkFailures)
        );
      if (portalAccess.handled) {
        portalAccessAttempts += 1;
        if (portalAccessAttempts > 6)
          return reviewReceipt(
            accountRecoveryAttempted ? "The employer did not accept the recovered application account. Continue on the prepared employer page to complete its security step, then IR35Careers will resume the application." : "The employer did not accept the automatic account sign-in. Continue on the prepared employer page to sign in, then IR35Careers will resume the application.",
            [],
            "employer_login",
            currentDestination(page, startUrl.toString())
          );
        continue;
      }
      const stop = await blocker(page);
      if (stop)
        return reviewReceipt(
          stop.message,
          [],
          stop.action,
          currentDestination(page, startUrl.toString())
        );
      if (accountCreationPending) {
        portalAccountState = "created";
        accountCreationPending = false;
      }
      await waitForFillableControls(page);
      sensitive = true;
      const needsUser = await fillStep(
        page,
        step,
        ats,
        facts,
        resume,
        payload.coverLetter,
        Boolean(payload.candidate.employerTermsConsent)
      );
      await page.keyboard.press("Tab").catch(() => void 0);
      await page.waitForTimeout(350);
      if (needsUser.length)
        return reviewReceipt(
          "The employer requires information that is not in your saved profile. Continue on the prepared employer form to answer only the highlighted questions.",
          needsUser,
          "browser_continue",
          currentDestination(page, startUrl.toString())
        );
      let submit = await actionLocator(page, ats.submitPattern);
      let next = await actionLocator(page, ats.nextPattern);
      for (let renderAttempt = 0; !submit && !next && renderAttempt < 20; renderAttempt += 1) {
        if (await successMessage(page, ats)) break;
        await page.waitForTimeout(500);
        submit = await actionLocator(page, ats.submitPattern);
        next = await actionLocator(page, ats.nextPattern);
      }
      const action = submit ?? next;
      if (!action) {
        const confirmed2 = await successMessage(page, ats);
        if (confirmed2) {
          sessionDisposition = "clear";
          return {
            state: "submitted",
            providerSubmissionId: resultId(
              payload.applicationId,
              payload.destination
            ),
            submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
            message: confirmed2,
            destination: page.url()
          };
        }
        return reviewReceipt(
          "IR35Careers could not identify the next employer-form action. Review this application before continuing.",
          [],
          "unsupported_form",
          currentDestination(page, startUrl.toString()),
          await pageDiagnostic(page, blockedHosts, networkFailures)
        );
      }
      const isSubmit = action === submit;
      page = await clickAndFollow(page, action, isSubmit ? 1e3 : 700);
      const confirmed = isSubmit ? await waitForSubmissionConfirmation(page, ats) : await successMessage(page, ats);
      if (confirmed) {
        sessionDisposition = "clear";
        return {
          state: "submitted",
          providerSubmissionId: resultId(
            payload.applicationId,
            payload.destination
          ),
          submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
          message: confirmed,
          destination: page.url()
        };
      }
      if (isSubmit) {
        const fields = await invalidRequiredFields(page, step + 1, ats);
        return reviewReceipt(
          "The employer did not confirm submission. Review the highlighted fields before another attempt.",
          fields,
          "validation_failed",
          currentDestination(page, startUrl.toString())
        );
      }
    }
    return reviewReceipt(
      "The employer application contains more steps than the automatic runner can safely complete.",
      [],
      "form_too_long",
      currentDestination(page, startUrl.toString())
    );
  } catch (error) {
    if (timedOut) {
      return reviewReceipt(
        "The employer portal did not finish within the safe application window. Your approved application is ready to retry.",
        [],
        "runner_timeout",
        currentDestination(page, payload.destination)
      );
    }
    throw error;
  } finally {
    clearTimeout(budgetTimer);
    if (runtime && payload.candidate.portalAccountConsent) {
      if (sessionDisposition === "clear") {
        await runtime.clearPortalSession?.().catch(() => null);
      } else if (context && page && !page.isClosed()) {
        try {
          const currentUrl = await validatePublicHttpsUrl(page.url());
          await runtime.savePortalSession?.({
            storageState: await context.storageState(),
            currentUrl: currentUrl.toString(),
            accountState: portalAccountState
          });
        } catch {
        }
      }
    }
    await browser?.close().catch(() => null);
  }
}

// src/lib/application-worker-executor.ts
function safeApplicationWorkerError(error) {
  return (error instanceof Error ? error.message : "Application worker error").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1e3);
}
function callbackUrl(task, appOrigin) {
  const url = new URL(task.callback_url);
  if (url.protocol !== "https:" || url.origin !== appOrigin || url.pathname !== "/api/applications/worker/callback")
    throw new Error("The worker callback destination is invalid.");
  url.search = "";
  url.hash = "";
  return url.toString();
}
async function signedPost(url, payload, timeoutMs = 6e4) {
  const body = JSON.stringify(payload);
  const signed = signApplicationWorkerBody(body);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ir35-worker-timestamp": signed.timestamp,
      "x-ir35-worker-signature": signed.signature
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(`IR35Careers worker API returned HTTP ${response.status}.`);
  if (raw.length > 2e6)
    throw new Error("IR35Careers worker API response was too large.");
  return JSON.parse(raw);
}
async function remoteVerificationCode(input) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await signedPost(
      `${input.appOrigin}/api/applications/worker/verification-code`,
      {
        userId: input.task.user_id,
        applicationId: input.task.application_id,
        alias: input.alias,
        requestedAfter: input.requestedAfter,
        providerSync: attempt % 5 === 0
      },
      2e4
    ).catch(() => ({ code: null }));
    if (result.code && /^[A-Z0-9-]{4,12}$/i.test(result.code))
      return result.code;
    if (attempt < 29)
      await new Promise((resolve) => setTimeout(resolve, 3e3));
  }
  return null;
}
async function remoteEmailActionLink(input) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await signedPost(
      `${input.appOrigin}/api/applications/worker/email-action`,
      {
        userId: input.task.user_id,
        applicationId: input.task.application_id,
        alias: input.alias,
        requestedAfter: input.requestedAfter,
        providerSync: attempt % 5 === 0
      },
      2e4
    ).catch(() => ({ actionLink: null }));
    if (result.actionLink) {
      try {
        const url = new URL(result.actionLink);
        if (url.protocol === "https:" && !url.username && !url.password && !url.port)
          return url.toString();
      } catch {
      }
    }
    if (attempt < 29)
      await new Promise((resolve) => setTimeout(resolve, 3e3));
  }
  return null;
}
async function buildAndRun(assignment, appOrigin, budgetMs) {
  if (assignment.preflightError) throw new Error(assignment.preflightError);
  if (!assignment.payload)
    throw new Error("The worker assignment did not include an approved packet.");
  let portalSession;
  let clearPortalSession = false;
  const task = assignment.task;
  const candidate = assignment.payload.candidate;
  const receipt = await runNativeApplication(assignment.payload, {
    budgetMs,
    portalPassword: assignment.portalPassword,
    resolvePortalPassword: assignment.portalPassword ? async () => assignment.portalPassword : void 0,
    resolveEmailVerificationCode: candidate.automaticEmailVerification ? ({ requestedAfter }) => remoteVerificationCode({
      task,
      alias: candidate.email,
      requestedAfter,
      appOrigin
    }) : void 0,
    resolveEmailActionLink: candidate.automaticEmailVerification ? ({ requestedAfter }) => remoteEmailActionLink({
      task,
      alias: candidate.email,
      requestedAfter,
      appOrigin
    }) : void 0,
    loadPortalSession: candidate.portalAccountConsent ? async () => assignment.portalSession ?? null : void 0,
    savePortalSession: candidate.portalAccountConsent ? async (session) => {
      portalSession = session;
      clearPortalSession = false;
    } : void 0,
    clearPortalSession: candidate.portalAccountConsent ? async () => {
      portalSession = void 0;
      clearPortalSession = true;
    } : void 0
  });
  return { receipt, portalSession, clearPortalSession };
}
async function executeApplicationWorkerAssignment(input) {
  const task = input.assignment.task;
  if (input.assignment.preflightError) {
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    return {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt,
      receipt: {
        state: "needs_user",
        providerSubmissionId: `preflight:${task.id}`,
        submittedAt: completedAt,
        message: input.assignment.preflightError,
        review: { action: input.assignment.preflightAction || "/profile" }
      }
    };
  }
  try {
    const result = await buildAndRun(
      input.assignment,
      input.appOrigin,
      input.budgetMs
    );
    return {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      receipt: result.receipt,
      portalSession: result.portalSession,
      clearPortalSession: result.clearPortalSession
    };
  } catch (error) {
    return {
      taskId: task.id,
      userId: task.user_id,
      applicationId: task.application_id,
      idempotencyKey: task.idempotency_key,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      error: safeApplicationWorkerError(error)
    };
  }
}
async function postApplicationWorkerCallback(input) {
  await signedPost(
    callbackUrl(input.task, input.appOrigin),
    input.callback,
    6e4
  );
}
async function claimApplicationWorkerAssignment(input) {
  const result = await signedPost(`${input.appOrigin}/api/applications/worker/claim`, input.claim, 3e4);
  return result.assignment ?? null;
}

// services/application-worker/server.ts
var PORT = Math.max(1, Math.min(Number(process.env.PORT || 8787), 65535));
var POLL_MS = Math.max(
  1e3,
  Math.min(Number(process.env.APPLICATION_WORKER_POLL_MS || 3e4), 6e4)
);
var CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.APPLICATION_WORKER_CONCURRENCY || 2), 4)
);
var WORKER_ID = `${hostname().replace(/[^a-z0-9-]/gi, "-").slice(0, 50)}-${process.pid}`;
var WORKER_STARTED_AT = (/* @__PURE__ */ new Date()).toISOString();
var WORKER_VERSION = process.env.APPLICATION_WORKER_VERSION?.trim().slice(0, 80) || "development";
var APP_ORIGIN = applicationWorkerAppOrigin(process.env.IR35CAREERS_APP_URL);
var active = 0;
var completed = 0;
var failed = 0;
var stopping = false;
var claiming = false;
var lastControlPlaneAt = null;
var lastControlPlaneError = null;
var consecutiveControlPlaneFailures = 0;
var CONTROL_PLANE_FAILURE_RESTART_LIMIT = 6;
function restartAfterRepeatedControlPlaneFailures() {
  if (stopping || active > 0 || consecutiveControlPlaneFailures < CONTROL_PLANE_FAILURE_RESTART_LIMIT)
    return;
  console.error("worker_control_plane_restart", {
    failures: consecutiveControlPlaneFailures,
    reason: lastControlPlaneError
  });
  process.exit(2);
}
async function executeTask(assignment) {
  const task = assignment.task;
  const callback = await executeApplicationWorkerAssignment({
    assignment,
    appOrigin: APP_ORIGIN
  });
  const review = callback.receipt?.review && typeof callback.receipt.review === "object" ? callback.receipt.review : null;
  const diagnostic = review?.diagnostic && typeof review.diagnostic === "object" ? review.diagnostic : null;
  if (callback.receipt?.state === "needs_user") {
    let destinationHost = "";
    try {
      destinationHost = new URL(callback.receipt.destination ?? "").hostname;
    } catch {
      destinationHost = "";
    }
    console.info("application_worker_attention", {
      taskId: task.id,
      applicationId: task.application_id,
      action: String(review?.action ?? ""),
      destinationHost,
      title: String(diagnostic?.title ?? "").slice(0, 160),
      headings: Array.isArray(diagnostic?.headings) ? diagnostic.headings.slice(0, 20) : [],
      actions: Array.isArray(diagnostic?.actions) ? diagnostic.actions.slice(0, 30) : [],
      controls: Array.isArray(diagnostic?.controls) ? diagnostic.controls.slice(0, 80) : [],
      blockedHosts: Array.isArray(diagnostic?.blockedHosts) ? diagnostic.blockedHosts.slice(0, 30) : [],
      networkFailures: Array.isArray(diagnostic?.networkFailures) ? diagnostic.networkFailures.slice(0, 30) : []
    });
  }
  try {
    await postApplicationWorkerCallback({
      task,
      callback,
      appOrigin: APP_ORIGIN
    });
    completed += 1;
  } catch (error) {
    failed += 1;
    console.error("worker_callback_failed", {
      taskId: task.id,
      reason: safeApplicationWorkerError(error)
    });
  }
}
async function claimTask(acceptTask) {
  const claim = {
    workerId: WORKER_ID,
    startedAt: WORKER_STARTED_AT,
    acceptTask,
    active,
    concurrency: CONCURRENCY,
    completed,
    failed,
    version: WORKER_VERSION
  };
  try {
    const assignment = await claimApplicationWorkerAssignment({
      appOrigin: APP_ORIGIN,
      claim
    });
    lastControlPlaneAt = (/* @__PURE__ */ new Date()).toISOString();
    lastControlPlaneError = null;
    consecutiveControlPlaneFailures = 0;
    return assignment;
  } catch (error) {
    lastControlPlaneError = safeApplicationWorkerError(error);
    consecutiveControlPlaneFailures += 1;
    throw error;
  }
}
async function pump() {
  if (stopping || claiming || active >= CONCURRENCY) return;
  claiming = true;
  try {
    while (!stopping && active < CONCURRENCY) {
      let assignment = null;
      try {
        assignment = await claimTask(true);
      } catch (error) {
        console.error("worker_claim_failed", {
          reason: safeApplicationWorkerError(error)
        });
        restartAfterRepeatedControlPlaneFailures();
        return;
      }
      if (!assignment?.task) return;
      active += 1;
      void executeTask(assignment).finally(() => {
        active -= 1;
        void pump();
      });
    }
  } finally {
    claiming = false;
  }
}
async function heartbeat() {
  try {
    await claimTask(false);
  } catch (error) {
    console.error("worker_heartbeat_failed", {
      reason: safeApplicationWorkerError(error)
    });
    restartAfterRepeatedControlPlaneFailures();
  }
}
if (!process.env.CHROME_EXECUTABLE_PATH)
  process.env.CHROME_EXECUTABLE_PATH = playwrightChromium.executablePath();
if (!process.env.APPLICATION_RUNNER_BUDGET_MS)
  process.env.APPLICATION_RUNNER_BUDGET_MS = "300000";
if (!process.env.APPLICATION_RUNNER_HEADLESS)
  process.env.APPLICATION_RUNNER_HEADLESS = "false";
var server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store"
    });
    response.end(
      JSON.stringify({
        ok: true,
        service: "ir35careers-application-worker",
        active,
        concurrency: CONCURRENCY,
        completed,
        failed,
        version: WORKER_VERSION,
        controlPlane: {
          connected: Boolean(lastControlPlaneAt),
          lastConnectedAt: lastControlPlaneAt,
          consecutiveFailures: consecutiveControlPlaneFailures,
          error: lastControlPlaneError
        }
      })
    );
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});
server.listen(PORT, "0.0.0.0", () => {
  console.info("application_worker_ready", {
    workerId: WORKER_ID,
    port: PORT,
    concurrency: CONCURRENCY
  });
});
var timer = setInterval(() => void pump(), POLL_MS);
var heartbeatTimer = setInterval(() => void heartbeat(), 3e4);
void heartbeat();
void pump();
function shutdown() {
  stopping = true;
  clearInterval(timer);
  clearInterval(heartbeatTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2e4).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

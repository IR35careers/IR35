import chromiumBinary from "@sparticuz/chromium";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { createHash } from "node:crypto";
import {
  detectAts,
  isApplicationFormEvidence,
  isEmployerAccountAccessPage,
  isJobBoardUtilityControl,
  isSafeApplicationHandoffNavigation,
  isSourceAccessDeniedPage,
  nativeRunnerHostAllowed,
  type AtsDefinition,
} from "@/lib/application-runner/ats";
import {
  closestOption,
  deterministicMapping,
  screeningAnswer,
  valueForMapping,
} from "@/lib/application-runner/field-mapping";
import { mapUnknownFields } from "@/lib/application-runner/openrouter-mapper";
import {
  buildRunnerFacts,
  type FieldMapping,
  type RunnerFacts,
  type RunnerField,
} from "@/lib/application-runner/types";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";
import { getPinnedPublicHttps } from "@/lib/security/pinned-https";
import { buildResumePdf } from "@/lib/resume/export";
import type {
  NativeSubmissionRuntime,
  SubmissionProviderPayload,
  SubmissionProviderReceipt,
} from "@/lib/application-submission";

const MAX_STEPS = 8;
const MAX_FIELDS = 120;
const MAX_RESUME_BYTES = 8_000_000;

function runnerBudgetMs(): number {
  const configured = Number(process.env.APPLICATION_RUNNER_BUDGET_MS || 0);
  if (!Number.isFinite(configured) || configured <= 0) return 100_000;
  return Math.max(60_000, Math.min(Math.floor(configured), 10 * 60_000));
}

function clean(value: string, max = 500): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function resultId(applicationId: string, destination: string): string {
  return `ir35-${createHash("sha256").update(`${applicationId}:${destination}`).digest("hex").slice(0, 18)}`;
}

function reviewReceipt(
  message: string,
  fields: RunnerField[],
  action?: string,
): SubmissionProviderReceipt {
  return {
    state: "needs_user",
    providerSubmissionId: "",
    submittedAt: new Date().toISOString(),
    message,
    review: {
      action,
      questions: fields.slice(0, 30).map((field) => ({
        id: `native:${field.id}`,
        label: field.label || field.name || "Employer question",
        required: field.required,
        options: field.options,
      })),
    },
  };
}

async function publicRequestGuard(
  route: import("playwright-core").Route,
  approvedHosts: Set<string>,
  sensitiveMode: () => boolean,
): Promise<void> {
  const request = route.request();
  const url = request.url();
  if (/^(data|blob|about):/i.test(url)) return route.continue();
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!approvedHosts.has(hostname)) {
      if (nativeRunnerHostAllowed(hostname)) {
        await validatePublicHttpsUrl(url);
        approvedHosts.add(hostname);
      } else if (
        isSafeApplicationHandoffNavigation({
          url,
          method: request.method(),
          resourceType: request.resourceType(),
          isNavigationRequest: request.isNavigationRequest(),
          isTopLevel: !request.frame().parentFrame(),
          sensitive: sensitiveMode(),
        })
      ) {
        // Discovery partners such as Reed and Adzuna legitimately hand the
        // candidate from their listing page to the employer's own ATS. Admit
        // only a validated, public HTTPS top-level navigation, and only before
        // any candidate data has been entered. Once filling starts, the guard
        // returns to the strict approved-host policy below.
        await validatePublicHttpsUrl(url);
        approvedHosts.add(hostname);
      } else if (
        !sensitiveMode() &&
        request.method() === "GET" &&
        ["script", "stylesheet", "image", "font"].includes(
          request.resourceType(),
        )
      ) {
        // Permit public static dependencies while the page is loading, but do
        // not trust their hosts with candidate data after fields are filled.
        await validatePublicHttpsUrl(url);
      } else {
        throw new Error("blocked");
      }
    } else if (
      parsed.protocol !== "https:" ||
      (parsed.port && parsed.port !== "443")
    ) {
      throw new Error("blocked");
    }
    await route.continue();
  } catch {
    await route.abort("blockedbyclient");
  }
}

async function actionLocator(
  page: Page,
  pattern: RegExp,
): Promise<Locator | null> {
  const actions = page.locator(
    'button, input[type="submit"], input[type="button"], a[role="button"], a',
  );
  const count = Math.min(await actions.count(), 150);
  for (let index = 0; index < count; index += 1) {
    const item = actions.nth(index);
    if (
      !(await item.isVisible().catch(() => false)) ||
      !(await item.isEnabled().catch(() => false))
    )
      continue;
    const text = clean(
      `${await item.innerText().catch(() => "")} ${(await item.getAttribute("value")) ?? ""} ${(await item.getAttribute("aria-label")) ?? ""}`,
      160,
    );
    if (pattern.test(text)) return item;
  }
  return null;
}

async function hasApplicationForm(page: Page): Promise<boolean> {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="search"]), select, textarea',
  );
  const count = Math.min(await controls.count(), 30);
  let applicationSignals = 0;
  let hasResumeUpload = false;
  let hasNameField = false;
  let hasContactField = false;
  for (let index = 0; index < count; index += 1) {
    const item = controls.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = clean(
      `${(await item.getAttribute("name")) ?? ""} ${(await item.getAttribute("autocomplete")) ?? ""} ${(await item.getAttribute("aria-label")) ?? ""} ${(await item.getAttribute("placeholder")) ?? ""}`,
    );
    const type = ((await item.getAttribute("type")) ?? "").toLowerCase();
    if (isJobBoardUtilityControl(text)) continue;
    if (type === "file" && /(resume|cv|curriculum)/i.test(text))
      hasResumeUpload = true;
    if (/(first.?name|last.?name|full.?name|given.?name|family.?name)/i.test(text))
      hasNameField = true;
    if (/(email|phone|mobile)/i.test(text)) hasContactField = true;
    if (
      /(first.?name|last.?name|full.?name|email|phone|mobile|resume|curriculum|cover.?letter|sponsor|authori[sz]|postal|postcode|address)/i.test(
        text,
      )
    )
      applicationSignals += 1;
  }
  return isApplicationFormEvidence({
    hasResumeUpload,
    hasNameField,
    hasContactField,
    applicationSignals,
  });
}

async function clickAndFollow(
  page: Page,
  action: Locator,
  settleMs: number,
): Promise<Page> {
  const popupPromise = page
    .waitForEvent("popup", { timeout: 1_500 })
    .catch(() => null);
  await Promise.all([
    page
      .waitForLoadState("domcontentloaded", { timeout: 15_000 })
      .catch(() => null),
    action.click({ timeout: 12_000 }),
  ]);
  const popup = await popupPromise;
  const destination = popup ?? page;
  if (popup)
    await popup
      .waitForLoadState("domcontentloaded", { timeout: 20_000 })
      .catch(() => null);
  await destination.waitForTimeout(settleMs);
  await validatePublicHttpsUrl(destination.url());
  return destination;
}

async function openApplicationForm(
  initialPage: Page,
  ats: AtsDefinition,
): Promise<Page> {
  let page = initialPage;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const dismiss = await actionLocator(
      page,
      /^(decline all|reject all|reject optional cookies|only necessary cookies|no,? thanks(?:,? take me to the job)?|continue to job|take me to the job)$/i,
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

async function blocker(
  page: Page,
): Promise<{ message: string; action?: string } | null> {
  const captcha = page.locator(
    'iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]',
  );
  if (
    await captcha
      .first()
      .isVisible()
      .catch(() => false)
  )
    return {
      message:
        "The employer requires a CAPTCHA. Complete this verification before the application can continue.",
      action: "captcha",
    };
  const password = page.locator('input[type="password"]:visible');
  if (await password.count())
    return {
      message:
        "The employer requires an account sign-in or verification step. Complete it before the application can continue.",
      action: "employer_login",
    };
  const verificationText = clean(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
    20_000,
  );
  if (
    /(enter the verification code|two-factor authentication|2-step verification|check your email for a code)/i.test(
      verificationText,
    )
  ) {
    return {
      message:
        "The employer requires a verification code. Enter it before the application can continue.",
      action: "verification_code",
    };
  }
  if (
    /(sign in to (?:continue|apply)|log in to (?:continue|apply)|create an account to apply|register to apply)/i.test(
      verificationText,
    )
  ) {
    return {
      message:
        "The job board requires your account sign-in before it will accept this application.",
      action: "employer_login",
    };
  }
  return null;
}

async function visibleInput(
  page: Page,
  selector: string,
): Promise<Locator | null> {
  const inputs = page.locator(selector);
  const count = Math.min(await inputs.count(), 20);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (await input.isVisible().catch(() => false)) return input;
  }
  return null;
}

async function handlePortalAccess(
  page: Page,
  payload: SubmissionProviderPayload,
  runtime: NativeSubmissionRuntime | undefined,
  requestedAfter: string,
  hasSavedSession: boolean,
): Promise<{ handled: boolean; stop?: { message: string; action: string } }> {
  const captcha = page.locator(
    'iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]',
  );
  if (
    await captcha
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return {
      handled: false,
      stop: {
        message:
          "The employer has requested a CAPTCHA. Open the employer page, complete the security check, then retry this application.",
        action: "captcha",
      },
    };
  }

  const bodyText = clean(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
    25_000,
  );
  const codeInput = await visibleInput(
    page,
    'input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[aria-label*="code" i], input[placeholder*="code" i]',
  );
  if (
    codeInput &&
    /(verification|verify|security code|one.?time|check your email|enter.*code)/i.test(
      bodyText,
    )
  ) {
    if (
      !payload.candidate.automaticEmailVerification ||
      !runtime?.resolveEmailVerificationCode
    ) {
      return {
        handled: false,
        stop: {
          message:
            "The employer sent a verification code. Enable email verification in your profile, or open the employer page and enter the code yourself.",
          action: "verification_code",
        },
      };
    }
    const code = await runtime.resolveEmailVerificationCode({
      hostname: new URL(page.url()).hostname,
      requestedAfter,
    });
    if (!code)
      return {
        handled: false,
        stop: {
          message:
            "The employer verification email has not arrived in your IR35Careers inbox yet. Wait a minute, then select Apply again.",
          action: "verification_code",
        },
      };
    await codeInput.fill(code);
    const verify = await actionLocator(
      page,
      /^(verify|confirm|continue|submit|next)$/i,
    );
    if (!verify)
      return {
        handled: false,
        stop: {
          message:
            "The verification code was received, but the employer's confirmation control could not be identified.",
          action: "unsupported_form",
        },
      };
    await clickAndFollow(page, verify, 800);
    return { handled: true };
  }

  const passwordInputs = page.locator('input[type="password"]:visible');
  const passwordCount = Math.min(await passwordInputs.count(), 3);
  const emailInput = await visibleInput(
    page,
    'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]',
  );
  const applicationFormVisible = await hasApplicationForm(page);
  const accountAccessPage = isEmployerAccountAccessPage({
    body: bodyText,
    hasEmailInput: Boolean(emailInput),
    hasPasswordInput: passwordCount > 0,
    hasApplicationForm: applicationFormVisible,
  });
  if (accountAccessPage) {
    const portalPassword =
      (await runtime?.resolvePortalPassword?.(
        new URL(page.url()).hostname.toLowerCase(),
      )) ?? runtime?.portalPassword;
    if (!payload.candidate.portalAccountConsent || !portalPassword) {
      return {
        handled: false,
        stop: {
          message:
            "This employer requires an application account. Enable employer account automation in your profile, or sign in on the employer page.",
          action: "employer_login",
        },
      };
    }
    if (emailInput) await emailInput.fill(payload.candidate.email);
    const names = payload.candidate.fullName.trim().split(/\s+/);
    const firstName = await visibleInput(
      page,
      'input[autocomplete="given-name"], input[name*="first" i]',
    );
    const lastName = await visibleInput(
      page,
      'input[autocomplete="family-name"], input[name*="last" i]',
    );
    if (firstName) await firstName.fill(names[0] ?? "");
    if (lastName) await lastName.fill(names.slice(1).join(" "));
    for (let index = 0; index < passwordCount; index += 1)
      await passwordInputs.nth(index).fill(portalPassword);

    const uncheckedLegal = page.locator(
      'input[type="checkbox"]:visible:not(:checked)',
    );
    const legalCount = Math.min(await uncheckedLegal.count(), 20);
    for (let index = 0; index < legalCount; index += 1) {
      const checkbox = uncheckedLegal.nth(index);
      const label = clean(
        await checkbox
          .evaluate(
            (node) => (node as HTMLInputElement).labels?.[0]?.textContent ?? "",
          )
          .catch(() => ""),
        300,
      );
      if (/(terms|privacy|agreement|consent|declaration)/i.test(label)) {
        return {
          handled: false,
          stop: {
            message:
              "The employer requires you to accept its account terms or declaration. Open the employer page to review and accept it, then retry.",
            action: "employer_login",
          },
        };
      }
    }
    const createAccount = await actionLocator(
      page,
      /^(create account|create an account|register|sign up)$/i,
    );
    const signIn = await actionLocator(page, /^(sign in|log in)$/i);
    const accountAlreadyExists =
      /(account|email).{0,40}(already exists|already registered|is registered)|sign in instead/i.test(
        bodyText,
      );
    const accessAction =
      hasSavedSession || accountAlreadyExists
        ? signIn ??
          createAccount ??
          (await actionLocator(page, /^(continue|next|continue with email)$/i))
        : createAccount ??
          signIn ??
          (await actionLocator(page, /^(continue|next|continue with email)$/i));
    if (!accessAction)
      return {
        handled: false,
        stop: {
          message:
            "The employer account form could not be completed automatically. Open the employer page to finish this step.",
          action: "employer_login",
        },
      };
    await clickAndFollow(page, accessAction, 900);
    return { handled: true };
  }
  return { handled: false };
}

async function snapshotFields(
  page: Page,
  step: number,
): Promise<Array<{ field: RunnerField; locator: Locator }>> {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
  );
  const count = Math.min(await controls.count(), MAX_FIELDS);
  const fields: Array<{ field: RunnerField; locator: Locator }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = controls.nth(index);
    if (
      !(await locator.isVisible().catch(() => false)) ||
      !(await locator.isEnabled().catch(() => false))
    )
      continue;
    const snapshot = await locator.evaluate((node) => {
      const element = node as
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const type =
        element instanceof HTMLInputElement
          ? element.type.toLowerCase()
          : element.tagName.toLowerCase();
      const ownLabel =
        "labels" in element
          ? Array.from(element.labels ?? [])
              .map((label) => label.textContent ?? "")
              .join(" ")
          : "";
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.textContent ?? "";
      const described = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const label =
        legend ||
        described ||
        element.getAttribute("aria-label") ||
        ownLabel ||
        element.getAttribute("placeholder") ||
        element.getAttribute("name") ||
        "";
      let options: string[] = [];
      if (element instanceof HTMLSelectElement)
        options = Array.from(element.options)
          .map((option) => option.textContent || option.value)
          .filter(Boolean);
      if (
        element instanceof HTMLInputElement &&
        (type === "radio" || type === "checkbox") &&
        element.name
      ) {
        options = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            `input[type="${type}"][name="${CSS.escape(element.name)}"]`,
          ),
        )
          .map((input) => input.labels?.[0]?.textContent || input.value)
          .filter(Boolean) as string[];
      }
      return {
        type,
        label,
        name: element.getAttribute("name") || "",
        placeholder: element.getAttribute("placeholder") || "",
        required:
          element.hasAttribute("required") ||
          element.getAttribute("aria-required") === "true",
        options,
        optionValue: element instanceof HTMLInputElement ? element.value : "",
        optionLabel: ownLabel,
      };
    });
    fields.push({
      locator,
      field: {
        id: `step_${step}_field_${index}`,
        index,
        type: clean(snapshot.type, 40),
        label: clean(snapshot.label, 500),
        name: clean(snapshot.name, 200),
        placeholder: clean(snapshot.placeholder, 300),
        required: snapshot.required,
        options: snapshot.options
          .map((option) => clean(option, 200))
          .filter(Boolean)
          .slice(0, 50),
        optionValue: clean(snapshot.optionValue, 200),
        optionLabel: clean(snapshot.optionLabel, 200),
      },
    });
  }
  return fields;
}

async function loadResume(url: string | undefined): Promise<Buffer | null> {
  if (!url) return null;
  const approved = await validatePublicHttpsUrl(url);
  const configuredStorageHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.toLowerCase()
    : "";
  if (
    ![configuredStorageHost, "ir35careers.com", "www.ir35careers.com"]
      .filter(Boolean)
      .includes(approved.hostname.toLowerCase())
  )
    return null;
  const response = await getPinnedPublicHttps(approved.toString(), {
    maxBytes: MAX_RESUME_BYTES,
    timeoutMs: 20_000,
  });
  if (response.status < 200 || response.status >= 300) return null;
  const bytes = response.body;
  return bytes.length > 0 && bytes.length <= MAX_RESUME_BYTES ? bytes : null;
}

async function approvedResumePdf(
  payload: SubmissionProviderPayload,
): Promise<Buffer | null> {
  const downloaded = await loadResume(payload.resume.url).catch(() => null);
  if (downloaded) return downloaded;

  const resumeText = payload.resume.text.trim();
  if (!resumeText) return null;
  const generated = await buildResumePdf({
    format: "pdf",
    resumeText,
    candidateName: payload.candidate.fullName,
    jobTitle: payload.job.title,
    companyName: payload.job.company_name,
    versionLabel: payload.resume.label || "Application CV",
  });
  return generated.length > 0 && generated.length <= MAX_RESUME_BYTES
    ? generated
    : null;
}

async function fillField(input: {
  locator: Locator;
  field: RunnerField;
  value: string;
  resume: Buffer | null;
  coverLetter: string;
}): Promise<boolean> {
  const { locator, field } = input;
  if (field.type === "file") {
    if (
      !/(resume|cv|curriculum)/i.test(`${field.label} ${field.name}`) ||
      !input.resume
    )
      return false;
    await locator.setInputFiles({
      name: "IR35Careers-Application-CV.pdf",
      mimeType: "application/pdf",
      buffer: input.resume,
    });
    return true;
  }
  const value = /cover\s*letter/i.test(`${field.label} ${field.name}`)
    ? input.coverLetter
    : input.value;
  if (!value) return false;
  if (field.type === "select") {
    const option = closestOption(value, field.options);
    if (!option) return false;
    await locator
      .selectOption({ label: option })
      .catch(async () => locator.selectOption(option));
    return true;
  }
  if (field.type === "radio") {
    if (
      !closestOption(
        value,
        [field.optionLabel, field.optionValue].filter(Boolean),
      )
    )
      return false;
    await locator.check();
    return true;
  }
  if (field.type === "checkbox") {
    if (!/^(yes|true|1|agree)$/i.test(value.trim())) return false;
    await locator.check();
    return true;
  }
  await locator.fill(value);
  return true;
}

async function fillStep(
  page: Page,
  step: number,
  facts: RunnerFacts,
  resume: Buffer | null,
  coverLetter: string,
): Promise<RunnerField[]> {
  const controls = await snapshotFields(page, step);
  const unknown: RunnerField[] = [];
  const mappings = new Map<string, FieldMapping>();
  for (const { field } of controls) {
    const deterministic = deterministicMapping(field);
    if (deterministic) mappings.set(field.id, deterministic);
    else unknown.push(field);
  }
  const aiMappings = await mapUnknownFields(unknown);
  for (const mapping of aiMappings) mappings.set(mapping.fieldId, mapping);

  const needsUser: RunnerField[] = [];
  const requiredRadioGroups = new Map<
    string,
    { field: RunnerField; locator: Locator }
  >();
  for (const control of controls) {
    const { field } = control;
    if (field.type === "radio") {
      const groupKey = field.name || field.label || field.id;
      if (field.required && !requiredRadioGroups.has(groupKey))
        requiredRadioGroups.set(groupKey, control);
      const groupChecked = await control.locator
        .evaluate((node) => {
          const input = node as HTMLInputElement;
          if (!input.name) return input.checked;
          return Array.from(document.getElementsByName(input.name)).some(
            (item) => item instanceof HTMLInputElement && item.checked,
          );
        })
        .catch(() => false);
      if (groupChecked) continue;
    }
    if (
      field.type === "checkbox" &&
      (await control.locator.isChecked().catch(() => false))
    )
      continue;
    if (field.type !== "file") {
      const current = await control.locator.inputValue().catch(() => "");
      if (current.trim() && field.type !== "radio" && field.type !== "checkbox")
        continue;
    }
    const directAnswer = screeningAnswer(field, facts);
    const mapping = mappings.get(field.id);
    const value =
      directAnswer || (mapping ? valueForMapping(mapping, facts) : "");
    const carriesApplicationMaterial =
      field.type === "file" ||
      /cover\s*letter/i.test(`${field.label} ${field.name}`);
    const canUseMapping = Boolean(
      mapping && mapping.factKey !== "needs_user" && mapping.factKey !== "skip",
    );
    const filled =
      carriesApplicationMaterial || Boolean(directAnswer) || canUseMapping
        ? await fillField({ ...control, value, resume, coverLetter }).catch(
            () => false,
          )
        : false;
    // A radio group is complete when any option is selected. Do not mark an
    // earlier option unresolved before a later matching option is processed.
    if (!filled && field.required && field.type !== "radio")
      needsUser.push(field);
  }
  for (const control of requiredRadioGroups.values()) {
    const groupChecked = await control.locator
      .evaluate((node) => {
        const input = node as HTMLInputElement;
        if (!input.name) return input.checked;
        return Array.from(document.getElementsByName(input.name)).some(
          (item) => item instanceof HTMLInputElement && item.checked,
        );
      })
      .catch(() => false);
    if (!groupChecked) needsUser.push(control.field);
  }
  return needsUser.filter(
    (field, index, all) =>
      all.findIndex(
        (item) => item.label === field.label && item.name === field.name,
      ) === index,
  );
}

async function successMessage(page: Page, ats: AtsDefinition): Promise<string> {
  const body = clean(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
    30_000,
  );
  const match = body.match(ats.successPattern)?.[0] ?? "";
  const urlSuccess = /(thank|success|confirmation|application-submitted)/i.test(
    page.url(),
  );
  return match || urlSuccess
    ? clean(match || "Application submitted successfully.", 500)
    : "";
}

async function waitForSubmissionConfirmation(
  page: Page,
  ats: AtsDefinition,
): Promise<string> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const confirmed = await successMessage(page, ats);
    if (confirmed) return confirmed;
    await page.waitForTimeout(500);
  }
  return "";
}

export async function runNativeApplication(
  payload: SubmissionProviderPayload,
  runtime?: NativeSubmissionRuntime,
): Promise<SubmissionProviderReceipt> {
  const startedAt = Date.now();
  const budgetMs = runnerBudgetMs();
  // A resumed employer session may already have a fresh code waiting in the
  // contractor inbox. Keep the lookup application-scoped, but include the
  // normal validity window used by employer one-time codes.
  const requestedAfter = new Date(startedAt - 10 * 60_000).toISOString();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let sessionDisposition: "save" | "clear" = "save";
  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => null);
  }, budgetMs);
  try {
    const destination = await validatePublicHttpsUrl(payload.destination);
    if (!nativeRunnerHostAllowed(destination.hostname)) {
      return reviewReceipt(
        "This employer portal is not yet on the approved automatic-submission list. Review the role before continuing.",
        [],
        "unsupported_portal",
      );
    }
    let ats = detectAts(destination.toString());
    const savedSession = payload.candidate.portalAccountConsent
      ? await runtime?.loadPortalSession?.().catch(() => null)
      : null;
    let startUrl = destination;
    if (savedSession?.currentUrl) {
      try {
        startUrl = await validatePublicHttpsUrl(savedSession.currentUrl);
      } catch {
        startUrl = destination;
      }
    }
    // A short-lived storage link can expire or be temporarily unavailable
    // before the hosted browser reaches the upload step. The approved CV text
    // is already part of this packet, so generate the same truthful PDF in the
    // runner instead of asking the candidate to upload it again.
    const resume = await approvedResumePdf(payload);
    const facts = buildRunnerFacts(
      payload.candidate,
      payload.screeningAnswers.map((answer, index) => ({
        id: `saved_${index}`,
        label: answer.label,
        answer: answer.answer,
        source: answer.source,
        required: true,
        reviewed: Boolean(answer.answer.trim()),
      })),
    );
    const customExecutablePath = process.env.CHROME_EXECUTABLE_PATH?.trim();
    const executablePath =
      customExecutablePath || (await chromiumBinary.executablePath());
    browser = await chromium.launch({
      executablePath,
      args: customExecutablePath
        ? ["--disable-dev-shm-usage", "--no-sandbox"]
        : chromiumBinary.args,
      headless: true,
    });
    context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: "en-GB",
      timezoneId: "Europe/London",
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
      storageState: savedSession?.storageState,
    });
    context.setDefaultTimeout(12_000);
    context.setDefaultNavigationTimeout(25_000);
    const approvedHosts = new Set<string>([
      destination.hostname,
      startUrl.hostname,
    ]);
    let sensitive = false;
    await context.route("**/*", (route) =>
      publicRequestGuard(route, approvedHosts, () => sensitive),
    );
    page = await context.newPage();
    let navigationStatus: number | null = null;
    try {
      const navigation = await page.goto(startUrl.toString(), {
        waitUntil: "domcontentloaded",
      });
      navigationStatus = navigation?.status() ?? null;
    } catch (error) {
      console.warn("application_runner_navigation_failed", {
        host: startUrl.hostname,
        reason: error instanceof Error ? clean(error.message, 240) : "unknown",
      });
      throw new Error(
        "The employer application page is unavailable or closed.",
      );
    }
    if (navigationStatus && [401, 403, 429].includes(navigationStatus)) {
      return reviewReceipt(
        "The job board requires a sign-in or browser verification before it will accept this application.",
        [],
        "employer_login",
      );
    }
    if (navigationStatus && navigationStatus >= 400) {
      throw new Error(
        "The employer application page is unavailable or closed.",
      );
    }
    await validatePublicHttpsUrl(page.url());
    page = await openApplicationForm(page, ats);
    const handoffBody = clean(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
      8_000,
    );
    if (
      isSourceAccessDeniedPage(
        await page.title().catch(() => ""),
        handoffBody,
      )
    ) {
      sessionDisposition = "clear";
      return reviewReceipt(
        "The job board blocked access to the employer application page. This role cannot be submitted from its current source and will not be retried automatically.",
        [],
        "source_access_denied",
      );
    }
    const applicationDestination = await validatePublicHttpsUrl(page.url());
    approvedHosts.add(applicationDestination.hostname.toLowerCase());
    ats = detectAts(applicationDestination.toString());

    let portalAccessAttempts = 0;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (Date.now() - startedAt >= budgetMs) {
        return reviewReceipt(
          "The employer portal did not finish within the safe application window. Your approved application is ready to retry.",
          [],
          "runner_timeout",
        );
      }
      const portalAccess = await handlePortalAccess(
        page,
        payload,
        runtime,
        requestedAfter,
        Boolean(savedSession),
      );
      if (portalAccess.stop)
        return reviewReceipt(
          portalAccess.stop.message,
          [],
          portalAccess.stop.action,
        );
      if (portalAccess.handled) {
        portalAccessAttempts += 1;
        if (portalAccessAttempts > 6)
          return reviewReceipt(
            "The employer did not accept the automatic account sign-in. Open the employer page to sign in or reset the account, then retry.",
            [],
            "employer_login",
          );
        continue;
      }
      const stop = await blocker(page);
      if (stop) return reviewReceipt(stop.message, [], stop.action);
      sensitive = true;
      const needsUser = await fillStep(
        page,
        step,
        facts,
        resume,
        payload.coverLetter,
      );
      if (needsUser.length)
        return reviewReceipt(
          "The employer requires information that is not safely available in your saved profile.",
          needsUser,
          "/profile",
        );

      const submit = await actionLocator(page, ats.submitPattern);
      const next = await actionLocator(page, ats.nextPattern);
      const action = submit ?? next;
      if (!action) {
        const confirmed = await successMessage(page, ats);
        if (confirmed) {
          sessionDisposition = "clear";
          return {
            state: "submitted",
            providerSubmissionId: resultId(
              payload.applicationId,
              payload.destination,
            ),
            submittedAt: new Date().toISOString(),
            message: confirmed,
            destination: page.url(),
          };
        }
        return reviewReceipt(
          "IR35Careers could not identify the next employer-form action. Review this application before continuing.",
          [],
          "unsupported_form",
        );
      }

      const isSubmit = action === submit;
      page = await clickAndFollow(page, action, isSubmit ? 1_000 : 700);
      const confirmed = isSubmit
        ? await waitForSubmissionConfirmation(page, ats)
        : await successMessage(page, ats);
      if (confirmed) {
        sessionDisposition = "clear";
        return {
          state: "submitted",
          providerSubmissionId: resultId(
            payload.applicationId,
            payload.destination,
          ),
          submittedAt: new Date().toISOString(),
          message: confirmed,
          destination: page.url(),
        };
      }
      if (isSubmit) {
        const validationFields = await snapshotFields(page, step + 1);
        const resolved = await Promise.all(
          validationFields.map(async ({ field, locator }) =>
            field.required &&
            (await locator.getAttribute("aria-invalid").catch(() => null)) ===
              "true"
              ? field
              : null,
          ),
        );
        const fields = resolved.filter((field): field is RunnerField =>
          Boolean(field),
        );
        return reviewReceipt(
          "The employer did not confirm submission. Review the highlighted fields before another attempt.",
          fields,
          "validation_failed",
        );
      }
    }
    return reviewReceipt(
      "The employer application contains more steps than the automatic runner can safely complete.",
      [],
      "form_too_long",
    );
  } catch (error) {
    if (timedOut) {
      return reviewReceipt(
        "The employer portal did not finish within the safe application window. Your approved application is ready to retry.",
        [],
        "runner_timeout",
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
          });
        } catch {
          // A failed session snapshot must not replace the useful application
          // result or expose browser state outside the encrypted store.
        }
      }
    }
    await browser?.close().catch(() => null);
  }
}

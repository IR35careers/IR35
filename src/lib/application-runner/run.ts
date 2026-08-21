import chromiumBinary from "@sparticuz/chromium";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { createHash } from "node:crypto";
import { detectAts, type AtsDefinition } from "@/lib/application-runner/ats";
import { closestOption, deterministicMapping, screeningAnswer, valueForMapping } from "@/lib/application-runner/field-mapping";
import { mapUnknownFields } from "@/lib/application-runner/openrouter-mapper";
import { buildRunnerFacts, type FieldMapping, type RunnerFacts, type RunnerField } from "@/lib/application-runner/types";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";
import type { SubmissionProviderPayload, SubmissionProviderReceipt } from "@/lib/application-submission";

const MAX_STEPS = 8;
const MAX_FIELDS = 120;
const MAX_RESUME_BYTES = 8_000_000;
const RUNNER_BUDGET_MS = 100_000;

function clean(value: string, max = 500): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function resultId(applicationId: string, destination: string): string {
  return `ir35-${createHash("sha256").update(`${applicationId}:${destination}`).digest("hex").slice(0, 18)}`;
}

function reviewReceipt(message: string, fields: RunnerField[], action?: string): SubmissionProviderReceipt {
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

async function publicRequestGuard(route: import("playwright-core").Route, approvedHosts: Set<string>): Promise<void> {
  const request = route.request();
  const url = request.url();
  if (/^(data|blob|about):/i.test(url)) return route.continue();
  try {
    const parsed = new URL(url);
    if (!approvedHosts.has(parsed.hostname)) {
      await validatePublicHttpsUrl(url);
      approvedHosts.add(parsed.hostname);
    } else if (parsed.protocol !== "https:" || (parsed.port && parsed.port !== "443")) {
      throw new Error("blocked");
    }
    await route.continue();
  } catch {
    await route.abort("blockedbyclient");
  }
}

async function actionLocator(page: Page, pattern: RegExp): Promise<Locator | null> {
  const actions = page.locator('button, input[type="submit"], input[type="button"], a[role="button"], a');
  const count = Math.min(await actions.count(), 150);
  for (let index = 0; index < count; index += 1) {
    const item = actions.nth(index);
    if (!(await item.isVisible().catch(() => false)) || !(await item.isEnabled().catch(() => false))) continue;
    const text = clean(`${await item.innerText().catch(() => "")} ${await item.getAttribute("value") ?? ""} ${await item.getAttribute("aria-label") ?? ""}`, 160);
    if (pattern.test(text)) return item;
  }
  return null;
}

async function hasApplicationForm(page: Page): Promise<boolean> {
  const controls = page.locator('input:not([type="hidden"]):not([type="search"]), select, textarea');
  const count = Math.min(await controls.count(), 30);
  let meaningful = 0;
  for (let index = 0; index < count; index += 1) {
    const item = controls.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = clean(`${await item.getAttribute("name") ?? ""} ${await item.getAttribute("autocomplete") ?? ""} ${await item.getAttribute("aria-label") ?? ""}`);
    if (!/search|newsletter|subscribe/i.test(text)) meaningful += 1;
  }
  return meaningful >= 2;
}

async function clickAndFollow(page: Page, action: Locator, settleMs: number): Promise<Page> {
  const popupPromise = page.waitForEvent("popup", { timeout: 1_500 }).catch(() => null);
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => null),
    action.click({ timeout: 12_000 }),
  ]);
  const popup = await popupPromise;
  const destination = popup ?? page;
  if (popup) await popup.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => null);
  await destination.waitForTimeout(settleMs);
  await validatePublicHttpsUrl(destination.url());
  return destination;
}

async function openApplicationForm(initialPage: Page, ats: AtsDefinition): Promise<Page> {
  let page = initialPage;
  for (let attempt = 0; attempt < 4 && !(await hasApplicationForm(page)); attempt += 1) {
    const apply = await actionLocator(page, ats.applyPattern);
    if (!apply) break;
    page = await clickAndFollow(page, apply, 800);
  }
  return page;
}

async function blocker(page: Page): Promise<{ message: string; action?: string } | null> {
  const captcha = page.locator('iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]');
  if (await captcha.first().isVisible().catch(() => false)) return { message: "The employer requires a CAPTCHA. Complete this verification before the application can continue.", action: "captcha" };
  const password = page.locator('input[type="password"]:visible');
  if (await password.count()) return { message: "The employer requires an account sign-in or verification step. Complete it before the application can continue.", action: "employer_login" };
  const verificationText = clean(await page.locator("body").innerText().catch(() => ""), 20_000);
  if (/(enter the verification code|two-factor authentication|2-step verification|check your email for a code)/i.test(verificationText)) {
    return { message: "The employer requires a verification code. Enter it before the application can continue.", action: "verification_code" };
  }
  return null;
}

async function snapshotFields(page: Page, step: number): Promise<Array<{ field: RunnerField; locator: Locator }>> {
  const controls = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
  const count = Math.min(await controls.count(), MAX_FIELDS);
  const fields: Array<{ field: RunnerField; locator: Locator }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = controls.nth(index);
    if (!(await locator.isVisible().catch(() => false)) || !(await locator.isEnabled().catch(() => false))) continue;
    const snapshot = await locator.evaluate((node) => {
      const element = node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : element.tagName.toLowerCase();
      const ownLabel = "labels" in element ? Array.from(element.labels ?? []).map((label) => label.textContent ?? "").join(" ") : "";
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.textContent ?? "";
      const described = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      const label = legend || described || element.getAttribute("aria-label") || ownLabel || element.getAttribute("placeholder") || element.getAttribute("name") || "";
      let options: string[] = [];
      if (element instanceof HTMLSelectElement) options = Array.from(element.options).map((option) => option.textContent || option.value).filter(Boolean);
      if (element instanceof HTMLInputElement && (type === "radio" || type === "checkbox") && element.name) {
        options = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="${type}"][name="${CSS.escape(element.name)}"]`)).map((input) => input.labels?.[0]?.textContent || input.value).filter(Boolean) as string[];
      }
      return {
        type,
        label,
        name: element.getAttribute("name") || "",
        placeholder: element.getAttribute("placeholder") || "",
        required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
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
        options: snapshot.options.map((option) => clean(option, 200)).filter(Boolean).slice(0, 50),
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
  const response = await fetch(approved, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESUME_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAX_RESUME_BYTES ? bytes : null;
}

async function fillField(input: { locator: Locator; field: RunnerField; value: string; resume: Buffer | null; coverLetter: string }): Promise<boolean> {
  const { locator, field } = input;
  if (field.type === "file") {
    if (!/(resume|cv|curriculum)/i.test(`${field.label} ${field.name}`) || !input.resume) return false;
    await locator.setInputFiles({ name: "IR35Careers-Application-CV.pdf", mimeType: "application/pdf", buffer: input.resume });
    return true;
  }
  const value = /cover\s*letter/i.test(`${field.label} ${field.name}`) ? input.coverLetter : input.value;
  if (!value) return false;
  if (field.type === "select") {
    const option = closestOption(value, field.options);
    if (!option) return false;
    await locator.selectOption({ label: option }).catch(async () => locator.selectOption(option));
    return true;
  }
  if (field.type === "radio") {
    if (!closestOption(value, [field.optionLabel, field.optionValue].filter(Boolean))) return false;
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

async function fillStep(page: Page, step: number, facts: RunnerFacts, resume: Buffer | null, coverLetter: string): Promise<RunnerField[]> {
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
  const requiredRadioGroups = new Map<string, { field: RunnerField; locator: Locator }>();
  for (const control of controls) {
    const { field } = control;
    if (field.type === "radio") {
      const groupKey = field.name || field.label || field.id;
      if (field.required && !requiredRadioGroups.has(groupKey)) requiredRadioGroups.set(groupKey, control);
      const groupChecked = await control.locator.evaluate((node) => {
        const input = node as HTMLInputElement;
        if (!input.name) return input.checked;
        return Array.from(document.getElementsByName(input.name)).some((item) => item instanceof HTMLInputElement && item.checked);
      }).catch(() => false);
      if (groupChecked) continue;
    }
    if (field.type === "checkbox" && await control.locator.isChecked().catch(() => false)) continue;
    if (field.type !== "file") {
      const current = await control.locator.inputValue().catch(() => "");
      if (current.trim() && field.type !== "radio" && field.type !== "checkbox") continue;
    }
    const directAnswer = screeningAnswer(field, facts);
    const mapping = mappings.get(field.id);
    const value = directAnswer || (mapping ? valueForMapping(mapping, facts) : "");
    const carriesApplicationMaterial = field.type === "file" || /cover\s*letter/i.test(`${field.label} ${field.name}`);
    const canUseMapping = Boolean(mapping && mapping.factKey !== "needs_user" && mapping.factKey !== "skip");
    const filled = carriesApplicationMaterial || Boolean(directAnswer) || canUseMapping
      ? await fillField({ ...control, value, resume, coverLetter }).catch(() => false)
      : false;
    // A radio group is complete when any option is selected. Do not mark an
    // earlier option unresolved before a later matching option is processed.
    if (!filled && field.required && field.type !== "radio") needsUser.push(field);
  }
  for (const control of requiredRadioGroups.values()) {
    const groupChecked = await control.locator.evaluate((node) => {
      const input = node as HTMLInputElement;
      if (!input.name) return input.checked;
      return Array.from(document.getElementsByName(input.name)).some((item) => item instanceof HTMLInputElement && item.checked);
    }).catch(() => false);
    if (!groupChecked) needsUser.push(control.field);
  }
  return needsUser.filter((field, index, all) => all.findIndex((item) => item.label === field.label && item.name === field.name) === index);
}

async function successMessage(page: Page, ats: AtsDefinition): Promise<string> {
  const body = clean(await page.locator("body").innerText().catch(() => ""), 30_000);
  const match = body.match(ats.successPattern)?.[0] ?? "";
  const urlSuccess = /(thank|success|confirmation|application-submitted)/i.test(page.url());
  return match || urlSuccess ? clean(match || "Application submitted successfully.", 500) : "";
}

async function waitForSubmissionConfirmation(page: Page, ats: AtsDefinition): Promise<string> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const confirmed = await successMessage(page, ats);
    if (confirmed) return confirmed;
    await page.waitForTimeout(500);
  }
  return "";
}

export async function runNativeApplication(payload: SubmissionProviderPayload): Promise<SubmissionProviderReceipt> {
  const startedAt = Date.now();
  let browser: Browser | null = null;
  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => null);
  }, RUNNER_BUDGET_MS);
  try {
    const destination = await validatePublicHttpsUrl(payload.destination);
    const ats = detectAts(destination.toString());
    const resume = await loadResume(payload.resume.url);
    const facts = buildRunnerFacts(payload.candidate, payload.screeningAnswers.map((answer, index) => ({
      id: `saved_${index}`,
      label: answer.label,
      answer: answer.answer,
      source: answer.source,
      required: true,
      reviewed: Boolean(answer.answer.trim()),
    })));
    const customExecutablePath = process.env.CHROME_EXECUTABLE_PATH?.trim();
    const executablePath = customExecutablePath || await chromiumBinary.executablePath();
    browser = await chromium.launch({
      executablePath,
      args: customExecutablePath ? ["--disable-dev-shm-usage", "--no-sandbox"] : chromiumBinary.args,
      headless: true,
    });
    const context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: "en-GB",
      timezoneId: "Europe/London",
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
    });
    context.setDefaultTimeout(12_000);
    context.setDefaultNavigationTimeout(25_000);
    const approvedHosts = new Set<string>([destination.hostname]);
    await context.route("**/*", (route) => publicRequestGuard(route, approvedHosts));
    let page = await context.newPage();
    try {
      await page.goto(destination.toString(), { waitUntil: "domcontentloaded" });
    } catch (error) {
      console.warn("application_runner_navigation_failed", {
        host: destination.hostname,
        reason: error instanceof Error ? clean(error.message, 240) : "unknown",
      });
      throw new Error("The employer application page is unavailable or closed.");
    }
    await validatePublicHttpsUrl(page.url());
    page = await openApplicationForm(page, ats);

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (Date.now() - startedAt >= RUNNER_BUDGET_MS) {
        return reviewReceipt("The employer portal did not finish within the safe application window. Your approved application is ready to retry.", [], "runner_timeout");
      }
      const stop = await blocker(page);
      if (stop) return reviewReceipt(stop.message, [], stop.action);
      const needsUser = await fillStep(page, step, facts, resume, payload.coverLetter);
      if (needsUser.length) return reviewReceipt("The employer requires information that is not safely available in your saved profile.", needsUser, "/profile");

      const submit = await actionLocator(page, ats.submitPattern);
      const next = await actionLocator(page, ats.nextPattern);
      const action = submit ?? next;
      if (!action) {
        const confirmed = await successMessage(page, ats);
        if (confirmed) return { state: "submitted", providerSubmissionId: resultId(payload.applicationId, payload.destination), submittedAt: new Date().toISOString(), message: confirmed };
        return reviewReceipt("IR35Careers could not identify the next employer-form action. Review this application before continuing.", [], "unsupported_form");
      }

      const isSubmit = action === submit;
      page = await clickAndFollow(page, action, isSubmit ? 1_000 : 700);
      const confirmed = isSubmit ? await waitForSubmissionConfirmation(page, ats) : await successMessage(page, ats);
      if (confirmed) return { state: "submitted", providerSubmissionId: resultId(payload.applicationId, payload.destination), submittedAt: new Date().toISOString(), message: confirmed };
      if (isSubmit) {
        const validationFields = await snapshotFields(page, step + 1);
        const resolved = await Promise.all(validationFields.map(async ({ field, locator }) => (
          field.required && (await locator.getAttribute("aria-invalid").catch(() => null)) === "true" ? field : null
        )));
        const fields = resolved.filter((field): field is RunnerField => Boolean(field));
        return reviewReceipt("The employer did not confirm submission. Review the highlighted fields before another attempt.", fields, "validation_failed");
      }
    }
    return reviewReceipt("The employer application contains more steps than the automatic runner can safely complete.", [], "form_too_long");
  } catch (error) {
    if (timedOut) {
      return reviewReceipt("The employer portal did not finish within the safe application window. Your approved application is ready to retry.", [], "runner_timeout");
    }
    throw error;
  } finally {
    clearTimeout(budgetTimer);
    await browser?.close().catch(() => null);
  }
}

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
  canAutomaticallyAcceptEmployerTerms,
  detectAts,
  isApplicationFormEvidence,
  isClosedListingPage,
  employerPortalPasswordCandidates,
  isEmployerAccountCreationControl,
  isEmployerAccountMissing,
  isEmployerAuthenticationFailure,
  isEmployerAccountRecoveryControl,
  isEmployerAccountAccessPage,
  isEmployerEmailLinkPending,
  isEmployerGuestApplicationControl,
  isEmployerPasswordlessAccessControl,
  isEmployerPasswordSetupPage,
  isJobBoardUtilityControl,
  matchesApplicationAction,
  requiresEmployerTermsAcceptance,
  isEmployerTermsCheckbox,
  isVerificationResendControl,
  isSafeApplicationHandoffNavigation,
  isSourceAccessDeniedPage,
  nativeRunnerHostAllowed,
  preferEmployerSignIn,
  preferredResumeUploadFormat,
  shouldTreatSingleFileAsResume,
  shouldSkipConsumedResumeInput,
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
import {
  bestDirectEmployerCandidate,
  bestDiscoveryCandidate,
  directEmployerCandidatesFromSearchHtml,
  duckDuckGoResultTarget,
  discoveryProviderOrder,
  isDiscoveryOnlyHost,
  type DiscoveryCandidate,
} from "@/lib/application-runner/source-resolution";
import {
  applicationRunnerHeadless,
  applicationRunnerWindowArgs,
} from "@/lib/application-runner/runtime-config";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";
import { getPinnedPublicHttps } from "@/lib/security/pinned-https";
import { buildResumeDocx, buildResumePdf } from "@/lib/resume/export";
import { parseApplicationInboxAlias } from "@/lib/email/inbox-alias";
import type {
  NativeSubmissionRuntime,
  SubmissionProviderPayload,
  SubmissionProviderReceipt,
} from "@/lib/application-submission";

const MAX_STEPS = 24;
const MAX_FIELDS = 180;
const MAX_RESUME_BYTES = 8_000_000;

type ApprovedResumeUpload = {
  buffer: Buffer;
  name: string;
  mimeType: string;
};

function runnerBudgetMs(override?: number): number {
  const configured = Number(
    override ?? process.env.APPLICATION_RUNNER_BUDGET_MS ?? 0,
  );
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
  destination?: string,
  diagnostic?: RunnerPageDiagnostic,
): SubmissionProviderReceipt {
  return {
    state: "needs_user",
    providerSubmissionId: "",
    submittedAt: new Date().toISOString(),
    message,
    destination,
    review: {
      action,
      diagnostic,
      questions: fields.slice(0, 30).map((field) => ({
        id: `native:${field.id}`,
        label: field.label || field.name || "Employer question",
        required: field.required,
        options: field.options,
      })),
    },
  };
}

type RunnerPageDiagnostic = {
  title: string;
  headings: string[];
  actions: Array<{ label: string; enabled: boolean; role: string }>;
  controls: Array<{
    label: string;
    type: string;
    required: boolean;
    completed: boolean;
    valid: boolean;
  }>;
  blockedHosts: string[];
  networkFailures: string[];
  messages: string[];
};

/**
 * Captures labels and control state only. Field values and page HTML are
 * deliberately excluded because this snapshot is retained for protected
 * administrator diagnostics when an employer changes its form.
 */
async function pageDiagnostic(
  page: Page,
  blockedHosts: ReadonlySet<string> = new Set(),
  networkFailures: ReadonlySet<string> = new Set(),
): Promise<RunnerPageDiagnostic> {
  const title = clean(await page.title().catch(() => ""), 160);
  const headingNodes = page.locator(
    "h1:visible, h2:visible, h3:visible, legend:visible",
  );
  const headings: string[] = [];
  for (
    let index = 0;
    index < Math.min(await headingNodes.count(), 20);
    index += 1
  ) {
    const label = clean(
      await headingNodes
        .nth(index)
        .innerText()
        .catch(() => ""),
      180,
    );
    if (label && !headings.includes(label)) headings.push(label);
  }

  const actionNodes = page.locator(
    'button:visible, input[type="submit"]:visible, input[type="button"]:visible, [role="button"]:visible, a:visible',
  );
  const actions: RunnerPageDiagnostic["actions"] = [];
  for (
    let index = 0;
    index < Math.min(await actionNodes.count(), 80);
    index += 1
  ) {
    const item = actionNodes.nth(index);
    const label = clean(
      `${await item.innerText().catch(() => "")} ${(await item.getAttribute("value")) ?? ""} ${(await item.getAttribute("aria-label")) ?? ""}`,
      180,
    );
    if (!label || actions.some((entry) => entry.label === label)) continue;
    actions.push({
      label,
      enabled: await item.isEnabled().catch(() => false),
      role: clean(
        (await item.getAttribute("role")) ||
          (await item
            .evaluate((node) => node.tagName.toLowerCase())
            .catch(() => "control")),
        30,
      ),
    });
  }

  const controlNodes = page.locator(
    'input:not([type="hidden"]):visible, input[type="file"], select:visible, textarea:visible, [role="checkbox"]:visible, [role="radio"]:visible, [role="combobox"]:visible',
  );
  const controls: RunnerPageDiagnostic["controls"] = [];
  for (
    let index = 0;
    index < Math.min(await controlNodes.count(), 80);
    index += 1
  ) {
    const item = controlNodes.nth(index);
    const snapshot = await item.evaluate((node) => {
      const element = node as
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const labels =
        "labels" in element
          ? Array.from(element.labels ?? [])
              .map((label) => label.textContent ?? "")
              .join(" ")
          : "";
      return {
        label:
          element.getAttribute("aria-label") ||
          labels ||
          element.getAttribute("placeholder") ||
          element.getAttribute("name") ||
          element.getAttribute("role") ||
          element.tagName,
        type:
          element.getAttribute("type") ||
          element.getAttribute("role") ||
          element.tagName.toLowerCase(),
        required:
          element.hasAttribute("required") ||
          element.getAttribute("aria-required") === "true",
        completed:
          element instanceof HTMLInputElement && element.type === "file"
            ? Boolean(element.files?.length)
            : element instanceof HTMLInputElement &&
                (element.type === "checkbox" || element.type === "radio")
              ? element.checked
              : Boolean(element.value?.trim()),
        valid:
          typeof element.checkValidity !== "function" ||
          element.checkValidity(),
      };
    });
    const label = clean(snapshot.label, 180);
    if (!label) continue;
    controls.push({
      label,
      type: clean(snapshot.type, 40),
      required: snapshot.required,
      completed: snapshot.completed,
      valid: snapshot.valid,
    });
  }

  const messageNodes = page.locator(
    '[role="alert"]:visible, [aria-live="assertive"]:visible, [id*="error" i]:visible, [class*="error-message" i]:visible',
  );
  const messages: string[] = [];
  for (
    let index = 0;
    index < Math.min(await messageNodes.count(), 30);
    index += 1
  ) {
    const message = clean(
      await messageNodes
        .nth(index)
        .innerText()
        .catch(() => ""),
      240,
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
    messages,
  };
}

function currentDestination(page: Page | null, fallback: string): string {
  const value = page?.url() ?? "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    // Keep the approved public destination when navigation did not complete.
  }
  return fallback;
}

async function publicRequestGuard(
  route: import("playwright-core").Route,
  approvedHosts: Set<string>,
  sensitiveMode: () => boolean,
  onBlockedHost?: (hostname: string) => void,
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
        if (sensitiveMode()) onBlockedHost?.(hostname);
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

async function uploadApprovedResumeForKnownPortal(input: {
  page: Page;
  ats: AtsDefinition;
  resume: ApprovedResumeUpload | null;
}): Promise<boolean> {
  if (input.ats.kind !== "totaljobs" || !input.resume) return false;
  const payload = {
    name: input.resume.name,
    mimeType: input.resume.mimeType,
    buffer: input.resume.buffer,
  };
  const fileInputs = input.page.locator('input[type="file"]');
  if (await fileInputs.count()) {
    const inputControl = fileInputs.first();
    const attached = await inputControl
      .setInputFiles(payload)
      .then(async () =>
        inputControl.evaluate((node) =>
          Boolean((node as HTMLInputElement).files?.length),
        ),
      )
      .catch(() => false);
    if (attached) return true;
  }

  const chooseFile = await actionLocator(
    input.page,
    /^(choose file|upload (?:a )?(?:file|cv|resume)|add (?:a )?(?:file|cv|resume))$/i,
  );
  if (!chooseFile) return false;
  const chooserPromise = input.page
    .waitForEvent("filechooser", { timeout: 5_000 })
    .catch(() => null);
  await chooseFile.click().catch(() => undefined);
  const chooser = await chooserPromise;
  if (!chooser) return false;
  await chooser.setFiles(payload);
  return true;
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
    if (
      matchesApplicationAction(pattern, [
        await item.innerText().catch(() => ""),
        await item.getAttribute("value"),
        await item.getAttribute("aria-label"),
      ])
    )
      return item;
  }
  return null;
}

async function actionLocatorMatching(
  page: Page,
  matches: (label: string) => boolean,
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
    const label = clean(
      `${await item.innerText().catch(() => "")} ${(await item.getAttribute("value")) ?? ""} ${(await item.getAttribute("aria-label")) ?? ""}`,
      220,
    );
    if (label && matches(label)) return item;
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
    if (
      /(first.?name|last.?name|full.?name|given.?name|family.?name)/i.test(text)
    )
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
  try {
    await action.click({ timeout: 12_000 });
  } catch (error) {
    const stillActionable =
      (await action.isVisible().catch(() => false)) &&
      (await action.isEnabled().catch(() => false));
    if (!stillActionable) throw error;
    await action.click({ timeout: 5_000, force: true });
  }
  const popup = await popupPromise;
  const destination = popup ?? page;
  await destination
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
      /^(decline all|reject all|reject optional cookies|only necessary cookies|just necessary|no,? thanks(?:,? take me to the job)?|continue to job|take me to the job)$/i,
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

async function cvLibraryCandidates(page: Page): Promise<DiscoveryCandidate[]> {
  const anchors = page.locator('a[href^="/job/"]');
  const count = Math.min(await anchors.count(), 80);
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const href = (await anchor.getAttribute("href").catch(() => null)) ?? "";
    if (!/^\/job\/\d+\//.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = clean(await anchor.innerText().catch(() => ""), 240);
    if (!title) continue;
    const context = clean(
      await anchor
        .evaluate((node) => {
          let current: HTMLElement | null = node as HTMLElement;
          let useful = current.innerText || current.textContent || "";
          for (let depth = 0; depth < 7 && current.parentElement; depth += 1) {
            current = current.parentElement;
            const text = current.innerText || current.textContent || "";
            if (text.length <= 1_800) useful = text;
            if (
              /\b(posted|contract|temporary|per (?:hour|day)|easy apply)\b/i.test(
                text,
              )
            )
              break;
          }
          return useful;
        })
        .catch(() => ""),
      1_800,
    );
    candidates.push({ title, context, href });
  }
  return candidates;
}

async function totalJobsCandidates(page: Page): Promise<DiscoveryCandidate[]> {
  const anchors = page.locator('a[href^="/job/"]');
  const count = Math.min(await anchors.count(), 120);
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors.nth(index);
    const href = (await anchor.getAttribute("href").catch(() => null)) ?? "";
    if (!/^\/job\/.+-job\d+(?:[/?#]|$)/i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = clean(await anchor.innerText().catch(() => ""), 240);
    if (!title) continue;
    const context = clean(
      await anchor
        .evaluate((node) => {
          const article = node.closest("article");
          if (article) return article.innerText || article.textContent || "";
          let current: HTMLElement | null = node as HTMLElement;
          let useful = current.innerText || current.textContent || "";
          for (let depth = 0; depth < 8 && current.parentElement; depth += 1) {
            current = current.parentElement;
            const text = current.innerText || current.textContent || "";
            if (text.length <= 2_200) useful = text;
          }
          return useful;
        })
        .catch(() => ""),
      2_200,
    );
    candidates.push({ title, context, href });
  }
  return candidates;
}

function totalJobsSearchUrl(job: SubmissionProviderPayload["job"]): string {
  const slug = clean(job.title, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const url = new URL(`https://www.totaljobs.com/jobs/${slug || "contract"}`);
  url.searchParams.set("keywords", job.title);
  return url.toString();
}

function directEmployerSearchUrl(
  job: SubmissionProviderPayload["job"],
): string {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set(
    "q",
    `${job.company_name} ${job.title} ${job.location.split(",")[0] || job.location}`,
  );
  return url.toString();
}

async function directEmployerSearchCandidates(
  page: Page,
): Promise<DiscoveryCandidate[]> {
  const results = page.locator(".result");
  const count = Math.min(await results.count(), 12);
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const result = results.nth(index);
    const anchor = result.locator("a.result__a").first();
    if (!(await anchor.count())) continue;
    const href =
      duckDuckGoResultTarget(
        (await anchor.getAttribute("href").catch(() => null)) ?? "",
      ) ?? "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const title = clean(await anchor.innerText().catch(() => ""), 240);
    const context = clean(await result.innerText().catch(() => ""), 2_400);
    if (title && context) candidates.push({ title, context, href });
  }
  return candidates;
}

async function directEmployerSearchCandidatesFromServer(
  job: SubmissionProviderPayload["job"],
): Promise<DiscoveryCandidate[]> {
  const response = await fetch(directEmployerSearchUrl(job), {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent":
        "Mozilla/5.0 (compatible; IR35Careers/1.0; +https://www.ir35careers.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`direct_source_search_http_${response.status}`);
  const html = await response.text();
  if (html.length > 2_000_000)
    throw new Error("direct_source_search_too_large");
  return directEmployerCandidatesFromSearchHtml(html);
}

async function resolveDirectEmployerPage(
  page: Page,
  job: SubmissionProviderPayload["job"],
): Promise<Page | null> {
  const searchPage = await page.context().newPage();
  try {
    let candidates = await directEmployerSearchCandidatesFromServer(job).catch(
      () => [],
    );
    if (!candidates.length) {
      await searchPage.goto(directEmployerSearchUrl(job), {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      candidates = await directEmployerSearchCandidates(searchPage);
    }
    const match = bestDirectEmployerCandidate(candidates, job);
    if (!match) throw new Error("direct_source_match_unavailable");
    await validatePublicHttpsUrl(match.href);
    await searchPage.goto(match.href, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });
    const [heading, body] = await Promise.all([
      searchPage
        .locator("h1, h2")
        .first()
        .innerText()
        .catch(() => searchPage.title()),
      searchPage
        .locator("body")
        .innerText()
        .catch(() => ""),
    ]);
    const verified = bestDirectEmployerCandidate(
      [
        {
          title: clean(heading, 240),
          context: clean(body, 12_000),
          href: searchPage.url(),
        },
      ],
      job,
    );
    if (!verified) throw new Error("direct_source_verification_failed");
    await page.close().catch(() => undefined);
    return searchPage;
  } catch {
    await searchPage.close().catch(() => undefined);
    return null;
  }
}

async function resolveDiscoveryApplicationPage(
  page: Page,
  job: SubmissionProviderPayload["job"],
): Promise<Page> {
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
    page
      .locator("body")
      .innerText()
      .catch(() => ""),
    page.content().catch(() => ""),
  ]);
  for (const provider of discoveryProviderOrder({ body, html })) {
    const searchPage = await page.context().newPage();
    try {
      await searchPage.goto(
        provider === "cv_library"
          ? "https://www.cv-library.co.uk/search-jobs"
          : totalJobsSearchUrl(job),
        {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        },
      );
      const essentialCookies = await actionLocator(
        searchPage,
        /^(essential cookies only|reject optional cookies|only necessary cookies)$/i,
      );
      if (essentialCookies)
        await clickAndFollow(searchPage, essentialCookies, 250).catch(
          () => undefined,
        );
      if (provider === "cv_library") {
        const keywordInput = searchPage.getByRole("combobox", {
          name: /keywords/i,
        });
        const locationInput = searchPage.getByRole("combobox", {
          name: /location/i,
        });
        if (!(await keywordInput.count()) || !(await locationInput.count()))
          throw new Error("search_unavailable");
        await keywordInput.first().fill(job.title);
        await locationInput
          .first()
          .fill(job.location.split(",")[0] || job.location);
        const findJobs = searchPage.getByRole("button", {
          name: /^find jobs$/i,
        });
        if (!(await findJobs.count())) throw new Error("search_unavailable");
        await clickAndFollow(searchPage, findJobs.first(), 1_200);
      }
      const match = bestDiscoveryCandidate(
        provider === "cv_library"
          ? await cvLibraryCandidates(searchPage)
          : await totalJobsCandidates(searchPage),
        job,
      );
      if (!match) throw new Error("source_match_unavailable");
      const directUrl = new URL(match.href, searchPage.url());
      await validatePublicHttpsUrl(directUrl.toString());
      await searchPage.goto(directUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
      await page.close().catch(() => undefined);
      return searchPage;
    } catch {
      await searchPage.close().catch(() => undefined);
    }
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
  ats: AtsDefinition,
  requestedAfter: string,
  accountState?: "created" | "verified" | "recovered",
  accountAccessAttempts = 0,
  accountRecoveryAttempted = false,
  passwordAttemptCount = 0,
): Promise<{
  handled: boolean;
  accountCreated?: boolean;
  accountCreationStarted?: boolean;
  accountRecovered?: boolean;
  recoveryAttempted?: boolean;
  passwordAttempted?: boolean;
  clearSession?: boolean;
  stop?: { message: string; action: string };
}> {
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
  const managedAlias =
    parseApplicationInboxAlias(payload.candidate.email).applicationId ===
    payload.applicationId;
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
    const resendControls = page.locator(
      'button:visible, a:visible, input[type="button"]:visible',
    );
    const resendCount = Math.min(await resendControls.count(), 40);
    for (let index = 0; index < resendCount; index += 1) {
      const control = resendControls.nth(index);
      const label = clean(
        (await control.innerText().catch(() => "")) ||
          (await control.getAttribute("value").catch(() => "")) ||
          "",
        120,
      );
      if (!isVerificationResendControl(label)) continue;
      if (await control.isEnabled().catch(() => false))
        await clickAndFollow(page, control, 600).catch(() => undefined);
      break;
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
            "The employer verification email has not arrived in your IR35Careers inbox yet. IR35Careers will keep checking and continue automatically when it arrives.",
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
    return { handled: true, accountCreated: true };
  }

  if (
    managedAlias &&
    payload.candidate.automaticEmailVerification &&
    runtime?.resolveEmailActionLink &&
    isEmployerEmailLinkPending(bodyText)
  ) {
    const actionLink = await runtime.resolveEmailActionLink({
      hostname: new URL(page.url()).hostname,
      requestedAfter,
      purpose: accountRecoveryAttempted
        ? "account_recovery"
        : "account_verification",
    });
    if (!actionLink)
      return {
        handled: false,
        recoveryAttempted: accountRecoveryAttempted,
        stop: {
          message:
            "The employer email link has not arrived in your IR35Careers inbox yet. IR35Careers will keep checking and continue automatically when it arrives.",
          action: "verification_link",
        },
      };
    const verifiedActionLink = await validatePublicHttpsUrl(actionLink);
    await page.goto(verifiedActionLink.toString(), {
      waitUntil: "domcontentloaded",
    });
    return {
      handled: true,
      accountCreated: !accountRecoveryAttempted,
      accountRecovered: accountRecoveryAttempted,
      recoveryAttempted: accountRecoveryAttempted,
    };
  }

  const passwordInputs = page.locator('input[type="password"]:visible');
  const passwordCount = Math.min(await passwordInputs.count(), 3);
  const emailInput = await visibleInput(
    page,
    'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]',
  );
  const emailContinuation = emailInput
    ? await actionLocator(page, /^continue with email$/i)
    : null;
  const applicationFormVisible = await hasApplicationForm(page);
  const accountAccessPage =
    Boolean(emailContinuation) ||
    isEmployerAccountAccessPage({
      body: bodyText,
      hasEmailInput: Boolean(emailInput),
      hasPasswordInput: passwordCount > 0,
      hasApplicationForm: applicationFormVisible,
    });
  if (accountAccessPage) {
    const guestApplication = await actionLocatorMatching(
      page,
      isEmployerGuestApplicationControl,
    );
    if (guestApplication) {
      await clickAndFollow(page, guestApplication, 900);
      return { handled: true };
    }

    const canUseManagedEmail = Boolean(
      managedAlias &&
      payload.candidate.automaticEmailVerification &&
      runtime?.resolveEmailActionLink,
    );
    const passwordlessAccess = canUseManagedEmail
      ? await actionLocatorMatching(page, isEmployerPasswordlessAccessControl)
      : null;
    if (passwordlessAccess) {
      if (emailInput) await emailInput.fill(payload.candidate.email);
      await clickAndFollow(page, passwordlessAccess, 900);
      return {
        handled: true,
        recoveryAttempted: true,
      };
    }

    const createAccount = await actionLocatorMatching(
      page,
      isEmployerAccountCreationControl,
    );
    const signIn = await actionLocator(page, /^(sign in|log in)$/i);
    const accountMissing = isEmployerAccountMissing(bodyText);
    const accountAlreadyExists =
      /(account|email).{0,40}(already exists|already registered|is registered)|sign in instead/i.test(
        bodyText,
      );
    const resolvedPortalPassword = await runtime?.resolvePortalPassword?.(
      new URL(page.url()).hostname.toLowerCase(),
    );
    const portalPasswords = employerPortalPasswordCandidates({
      resolvedPassword: resolvedPortalPassword,
      destinationPassword: runtime?.portalPassword,
    });
    const portalPassword =
      portalPasswords[
        Math.min(passwordAttemptCount, Math.max(0, portalPasswords.length - 1))
      ];
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
    const authenticationFailed = isEmployerAuthenticationFailure(bodyText);
    const passwordSetupPage = isEmployerPasswordSetupPage(bodyText);
    const triedEveryPassword =
      passwordAttemptCount >= Math.max(1, portalPasswords.length);
    const shouldRecoverAccount = Boolean(
      managedAlias &&
      payload.candidate.automaticEmailVerification &&
      payload.candidate.employerTermsConsent &&
      runtime?.resolveEmailActionLink &&
      !passwordSetupPage &&
      !accountMissing &&
      !accountRecoveryAttempted &&
      ((authenticationFailed && triedEveryPassword) ||
        accountAccessAttempts >= Math.max(4, portalPasswords.length + 2)),
    );
    if (shouldRecoverAccount) {
      const resetControl = await actionLocatorMatching(
        page,
        isEmployerAccountRecoveryControl,
      );
      if (!resetControl)
        return {
          handled: false,
          clearSession: authenticationFailed,
          stop: {
            message:
              "IR35Careers tried the employer's available sign-in, account creation, email-link and password-recovery routes. The employer still requires its own account access. Your prepared application is saved.",
            action: "employer_login",
          },
        };
      await clickAndFollow(page, resetControl, 700);
      const recoveryEmail = await visibleInput(
        page,
        'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]',
      );
      if (recoveryEmail) await recoveryEmail.fill(payload.candidate.email);
      const sendRecovery = await actionLocator(
        page,
        /^(send|continue|next|send (?:reset|recovery|sign[ -]?in|magic) link|email me|reset password)$/i,
      );
      const recoveryRequestedAfter = new Date(
        Date.now() - 30_000,
      ).toISOString();
      if (sendRecovery) await clickAndFollow(page, sendRecovery, 800);
      const actionLink = await runtime?.resolveEmailActionLink?.({
        hostname: new URL(page.url()).hostname,
        requestedAfter: recoveryRequestedAfter,
        purpose: "account_recovery",
      });
      if (!actionLink)
        return {
          handled: false,
          recoveryAttempted: true,
          stop: {
            message:
              "IR35Careers requested an employer account recovery email and is waiting for its secure link. The application will continue automatically when the email arrives.",
            action: "account_recovery_email",
          },
        };
      const verifiedActionLink = await validatePublicHttpsUrl(actionLink);
      await page.goto(verifiedActionLink.toString(), {
        waitUntil: "domcontentloaded",
      });
      return {
        handled: true,
        accountRecovered: true,
        recoveryAttempted: true,
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
      if (isEmployerTermsCheckbox(label)) {
        if (!payload.candidate.employerTermsConsent) {
          return {
            handled: false,
            stop: {
              message:
                "Allow required employer account terms in your Application Profile, then IR35Careers can continue this approved application.",
              action: "employer_terms",
            },
          };
        }
        await checkbox.check();
      }
    }
    const resetPassword = passwordSetupPage
      ? await actionLocator(
          page,
          /^(reset|set|save|update|change|continue)(?: (?:my|your|new))? password$|^continue$/i,
        )
      : null;
    if (
      createAccount &&
      !preferEmployerSignIn({ accountAlreadyExists, accountState }) &&
      requiresEmployerTermsAcceptance(bodyText) &&
      !payload.candidate.employerTermsConsent
    ) {
      return {
        handled: false,
        stop: {
          message:
            "Allow required employer account terms in your Application Profile, then IR35Careers can create the account and continue this approved application.",
          action: "employer_terms",
        },
      };
    }
    const useSignIn =
      !accountMissing &&
      preferEmployerSignIn({
        accountAlreadyExists,
        accountState,
      });
    const portalContinuation =
      emailContinuation ?? (await actionLocator(page, ats.nextPattern));
    const accessAction =
      resetPassword ??
      (useSignIn
        ? (signIn ?? createAccount ?? portalContinuation)
        : (createAccount ?? signIn ?? portalContinuation));
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
    return {
      handled: true,
      accountRecovered: Boolean(resetPassword),
      recoveryAttempted: accountRecoveryAttempted || Boolean(resetPassword),
      passwordAttempted: Boolean(
        signIn && accessAction === signIn && passwordCount > 0,
      ),
      accountCreationStarted: Boolean(
        createAccount && accessAction === createAccount && !useSignIn,
      ),
    };
  }
  return { handled: false };
}

async function snapshotFields(
  page: Page,
  step: number,
  atsKind: AtsDefinition["kind"],
): Promise<Array<{ field: RunnerField; locator: Locator }>> {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea',
  );
  const fileUploadCount = await page.locator('input[type="file"]').count();
  const pageCopy =
    fileUploadCount === 1
      ? clean(
          await page
            .locator("body")
            .innerText()
            .catch(() => ""),
          25_000,
        )
      : "";
  const singleResumeUpload = shouldTreatSingleFileAsResume({
    atsKind,
    fileUploadCount,
    pageCopy,
  });
  const count = Math.min(await controls.count(), MAX_FIELDS);
  const fields: Array<{ field: RunnerField; locator: Locator }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = controls.nth(index);
    const inputType = clean(
      (await locator.getAttribute("type").catch(() => "")) ?? "",
      40,
    ).toLowerCase();
    const isFileUpload = inputType === "file";
    if (
      (!isFileUpload && !(await locator.isVisible().catch(() => false))) ||
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
        label: clean(
          `${snapshot.label}${snapshot.type === "file" && singleResumeUpload ? " Resume upload" : ""}`,
          500,
        ),
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

async function waitForFillableControls(page: Page): Promise<void> {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea, input[type="file"]',
  );
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const count = Math.min(await controls.count(), MAX_FIELDS);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const type = ((await control.getAttribute("type")) ?? "").toLowerCase();
      if (
        (type === "file" || (await control.isVisible().catch(() => false))) &&
        (await control.isEnabled().catch(() => false))
      )
        return;
    }
    await page.waitForTimeout(300);
  }
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

function uploadFromDownloadedResume(buffer: Buffer): ApprovedResumeUpload {
  const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isDocx)
    return {
      buffer,
      name: "IR35Careers-Application-Resume.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  return {
    buffer,
    name: isPdf
      ? "IR35Careers-Application-Resume.pdf"
      : "IR35Careers-Application-Resume.txt",
    mimeType: isPdf ? "application/pdf" : "text/plain",
  };
}

async function approvedResumeUpload(
  payload: SubmissionProviderPayload,
  atsKind: AtsDefinition["kind"],
): Promise<ApprovedResumeUpload | null> {
  const resumeText = payload.resume.text.trim();
  // Totaljobs' scorer rejected the generated PDF in the live application.
  // Prefer a fresh DOCX from the same approved text even when a PDF download
  // URL is available. Other portals retain the exact downloaded attachment.
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
    versionLabel: payload.resume.label || "Application Resume",
  } as const;
  const generated =
    format === "docx"
      ? await buildResumeDocx(request)
      : await buildResumePdf(request);
  if (generated.length <= 0 || generated.length > MAX_RESUME_BYTES) return null;
  return format === "docx"
    ? {
        buffer: generated,
        name: "IR35Careers-Application-Resume.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }
    : {
        buffer: generated,
        name: "IR35Careers-Application-Resume.pdf",
        mimeType: "application/pdf",
      };
}

function isApplicationMessageField(field: RunnerField): boolean {
  const text = `${field.label} ${field.name} ${field.placeholder}`;
  return /cover\s*letter|supporting\s*(?:statement|information)|application\s*message|^\s*message\b/i.test(
    text,
  );
}

async function fillField(input: {
  locator: Locator;
  field: RunnerField;
  value: string;
  resume: ApprovedResumeUpload | null;
  coverLetter: string;
  atsKind: AtsDefinition["kind"];
}): Promise<boolean> {
  const { locator, field } = input;
  if (field.type === "file") {
    if (
      !/(resume|cv|curriculum)/i.test(`${field.label} ${field.name}`) ||
      !input.resume
    )
      return false;
    await locator.setInputFiles({
      name: input.resume.name,
      mimeType: input.resume.mimeType,
      buffer: input.resume.buffer,
    });
    return true;
  }
  let value = isApplicationMessageField(field)
    ? input.coverLetter
    : input.value;
  // Totaljobs renders the calling code and subscriber number as separate
  // controls. Supplying the profile's full international number (for example
  // +44 7700...) leaves its React form invalid even though the native input
  // reports valid. Send only the national subscriber digits to that control.
  if (
    input.atsKind === "totaljobs" &&
    /phone|mobile|telephone/i.test(
      `${field.label} ${field.name} ${field.placeholder}`,
    )
  ) {
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
    await locator
      .selectOption({ label: option })
      .catch(async () => locator.selectOption(option));
    await locator.blur().catch(() => undefined);
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
  if (
    ["text", "tel", "email", "url", "number"].includes(field.type) &&
    value.length <= 300
  ) {
    await locator.fill("");
    await locator.pressSequentially(value, { delay: 1 });
  } else {
    await locator.fill(value);
  }
  // React employer forms often validate on focusout rather than input. Without
  // this transition the DOM contains a valid value while the submit control
  // remains disabled in the application's internal form state.
  await locator.blur().catch(() => undefined);
  return true;
}

async function fillStep(
  page: Page,
  step: number,
  ats: AtsDefinition,
  facts: RunnerFacts,
  resume: ApprovedResumeUpload | null,
  coverLetter: string,
  employerTermsConsent: boolean,
): Promise<RunnerField[]> {
  const resumeUploaded = await uploadApprovedResumeForKnownPortal({
    page,
    ats,
    resume,
  }).catch(() => false);
  const controls = await snapshotFields(page, step, ats.kind);
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
    // Totaljobs uses a custom upload component which consumes and then clears
    // its hidden file input. Re-filling that cleared input starts a second,
    // concurrent Resume parsing request and can leave the final submit action
    // disabled even though the first upload was accepted.
    if (
      shouldSkipConsumedResumeInput({
        fieldType: field.type,
        resumeAlreadyUploaded: resumeUploaded,
      })
    )
      continue;
    if (
      field.type === "checkbox" &&
      canAutomaticallyAcceptEmployerTerms({
        label: `${field.label} ${field.name}`,
        required: field.required,
        consent: employerTermsConsent,
      })
    ) {
      await control.locator.check().catch(() => undefined);
      if (await control.locator.isChecked().catch(() => false)) continue;
    }
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
      field.type === "file" || isApplicationMessageField(field);
    const canUseMapping = Boolean(
      mapping && mapping.factKey !== "needs_user" && mapping.factKey !== "skip",
    );
    const filled =
      carriesApplicationMaterial || Boolean(directAnswer) || canUseMapping
        ? await fillField({
            ...control,
            value,
            resume,
            coverLetter,
            atsKind: ats.kind,
          }).catch(() => false)
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
  // Several ATS products acknowledge a submission only after an asynchronous
  // profile or attachment request completes. A short wait produced false
  // failures even though the employer was still processing the final click.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const confirmed = await successMessage(page, ats);
    if (confirmed) return confirmed;
    await page.waitForTimeout(500);
  }
  return "";
}

async function invalidRequiredFields(
  page: Page,
  step: number,
  ats: AtsDefinition,
): Promise<RunnerField[]> {
  const fields = await snapshotFields(page, step, ats.kind);
  const invalid = await Promise.all(
    fields.map(async ({ field, locator }) => {
      if (!field.required) return null;
      const failed = await locator
        .evaluate((node) => {
          const element = node as
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          return (
            element.getAttribute("aria-invalid") === "true" ||
            (typeof element.checkValidity === "function" &&
              !element.checkValidity())
          );
        })
        .catch(() => false);
      return failed ? field : null;
    }),
  );
  return invalid.filter((field): field is RunnerField => Boolean(field));
}

export async function runNativeApplication(
  payload: SubmissionProviderPayload,
  runtime?: NativeSubmissionRuntime,
): Promise<SubmissionProviderReceipt> {
  const startedAt = Date.now();
  const budgetMs = runnerBudgetMs(runtime?.budgetMs);
  // A resumed employer session may already have a fresh code waiting in the
  // contractor inbox. Keep the lookup application-scoped, but include the
  // normal validity window used by employer one-time codes.
  const requestedAfter = new Date(startedAt - 10 * 60_000).toISOString();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let sessionDisposition: "save" | "clear" = "save";
  let portalAccountState: "created" | "verified" | "recovered" | undefined;
  let accountCreationPending = false;
  let accountRecoveryAttempted = false;
  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    void browser?.close().catch(() => null);
  }, budgetMs);
  try {
    const destination = await validatePublicHttpsUrl(payload.destination);
    // The packet reaches this function only after the signed-in contractor has
    // approved a stored job snapshot. Accept its validated public HTTPS
    // destination even when the employer uses a private or uncommon ATS
    // hostname. The request guard still prevents local-network access and
    // blocks new third-party hosts after candidate data begins to be entered.
    let ats = detectAts(destination.toString());
    const savedSession = payload.candidate.portalAccountConsent
      ? await runtime?.loadPortalSession?.().catch(() => null)
      : null;
    portalAccountState = savedSession?.accountState;
    let startUrl = destination;
    if (savedSession?.currentUrl) {
      try {
        startUrl = await validatePublicHttpsUrl(savedSession.currentUrl);
      } catch {
        startUrl = destination;
      }
    }
    // A short-lived storage link can expire or be temporarily unavailable
    // before the hosted browser reaches the upload step. The approved Resume text
    // is already part of this packet, so generate the same truthful document
    // in the runner instead of asking the candidate to upload it again.
    const resume = await approvedResumeUpload(payload, ats.kind);
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
    const headless = applicationRunnerHeadless({
      configured: process.env.APPLICATION_RUNNER_HEADLESS,
      hasCustomExecutable: Boolean(customExecutablePath),
    });
    browser = await chromium.launch({
      executablePath,
      args: customExecutablePath
        ? [
            "--disable-dev-shm-usage",
            "--no-sandbox",
            ...applicationRunnerWindowArgs(headless),
          ]
        : chromiumBinary.args,
      headless,
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
    const blockedHosts = new Set<string>();
    const networkFailures = new Set<string>();
    let sensitive = false;
    await context.route("**/*", (route) =>
      publicRequestGuard(
        route,
        approvedHosts,
        () => sensitive,
        (hostname) => blockedHosts.add(hostname),
      ),
    );
    page = await context.newPage();
    context.on("response", (response) => {
      if (response.status() < 400) return;
      try {
        const failed = new URL(response.url());
        if (!approvedHosts.has(failed.hostname.toLowerCase())) return;
        networkFailures.add(
          `${response.request().method()} ${failed.hostname}${failed.pathname} returned ${response.status()}`,
        );
      } catch {
        // Keep diagnostics value-free when a browser reports a malformed URL.
      }
    });
    context.on("requestfailed", (request) => {
      try {
        const failed = new URL(request.url());
        if (!approvedHosts.has(failed.hostname.toLowerCase())) return;
        networkFailures.add(
          `${request.method()} ${failed.hostname}${failed.pathname} failed`,
        );
      } catch {
        // Keep diagnostics value-free when a browser reports a malformed URL.
      }
    });
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
      return reviewReceipt(
        "This job listing is no longer available at its original source.",
        [],
        "listing_unavailable",
        currentDestination(page, startUrl.toString()),
      );
    }
    // Aggregator redirect pages can reject hosted browsers while the original
    // public employer form is still available. Recover the direct listing
    // before treating the response as an account or verification blocker.
    const discoveryPage = await resolveDiscoveryApplicationPage(
      page,
      payload.job,
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
        currentDestination(page, startUrl.toString()),
      );
    }
    if (navigationStatus && navigationStatus >= 400) {
      return reviewReceipt(
        "This job listing is no longer available at its original source.",
        [],
        "listing_unavailable",
        currentDestination(page, startUrl.toString()),
      );
    }
    await validatePublicHttpsUrl(page.url());
    ats = detectAts(page.url());
    page = await openApplicationForm(page, ats);
    const handoffBody = clean(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
      8_000,
    );
    if (isClosedListingPage(await page.title().catch(() => ""), handoffBody)) {
      sessionDisposition = "clear";
      return reviewReceipt(
        "This role is no longer accepting applications at its original source.",
        [],
        "listing_unavailable",
        currentDestination(page, startUrl.toString()),
      );
    }
    if (
      isSourceAccessDeniedPage(await page.title().catch(() => ""), handoffBody)
    ) {
      const sourceAccountAccess = await actionLocator(
        page,
        /^(login to continue|log in to continue|sign in to continue|continue with email|create account|register)$/i,
      );
      if (sourceAccountAccess && payload.candidate.portalAccountConsent) {
        page = await clickAndFollow(page, sourceAccountAccess, 900);
      } else {
        sessionDisposition = "clear";
        return reviewReceipt(
          "The job board blocked access to the employer application page. Continue the same prepared application in your secure desktop browser.",
          [],
          "source_access_denied",
          currentDestination(page, startUrl.toString()),
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
          currentDestination(page, startUrl.toString()),
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
        portalPasswordAttempts,
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
          await pageDiagnostic(page, blockedHosts, networkFailures),
        );
      if (portalAccess.handled) {
        portalAccessAttempts += 1;
        if (portalAccessAttempts > 6)
          return reviewReceipt(
            accountRecoveryAttempted
              ? "The employer did not accept the recovered application account. Continue on the prepared employer page to complete its security step, then IR35Careers will resume the application."
              : "The employer did not accept the automatic account sign-in. Continue on the prepared employer page to sign in, then IR35Careers will resume the application.",
            [],
            "employer_login",
            currentDestination(page, startUrl.toString()),
          );
        continue;
      }
      const stop = await blocker(page);
      if (stop)
        return reviewReceipt(
          stop.message,
          [],
          stop.action,
          currentDestination(page, startUrl.toString()),
        );
      if (accountCreationPending) {
        portalAccountState = "created";
        accountCreationPending = false;
      }
      // Totaljobs and other React application forms can show their shell before
      // mounting the actual controls. Filling before the controls exist leaves
      // the later-rendered form empty and its submit button disabled.
      await waitForFillableControls(page);
      sensitive = true;
      const needsUser = await fillStep(
        page,
        step,
        ats,
        facts,
        resume,
        payload.coverLetter,
        Boolean(payload.candidate.employerTermsConsent),
      );
      await page.keyboard.press("Tab").catch(() => undefined);
      await page.waitForTimeout(350);
      if (needsUser.length)
        return reviewReceipt(
          "The employer requires information that is not in your saved profile. Continue on the prepared employer form to answer only the highlighted questions.",
          needsUser,
          "browser_continue",
          currentDestination(page, startUrl.toString()),
        );

      let submit = await actionLocator(page, ats.submitPattern);
      let next = await actionLocator(page, ats.nextPattern);
      // Client-rendered employer forms can briefly expose only their header
      // after account creation. Give the approved page a bounded opportunity
      // to render its controls before classifying it as unsupported.
      for (
        let renderAttempt = 0;
        !submit && !next && renderAttempt < 20;
        renderAttempt += 1
      ) {
        if (await successMessage(page, ats)) break;
        await page.waitForTimeout(500);
        submit = await actionLocator(page, ats.submitPattern);
        next = await actionLocator(page, ats.nextPattern);
      }
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
          currentDestination(page, startUrl.toString()),
          await pageDiagnostic(page, blockedHosts, networkFailures),
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
        const fields = await invalidRequiredFields(page, step + 1, ats);
        return reviewReceipt(
          "The employer did not confirm submission. Review the highlighted fields before another attempt.",
          fields,
          "validation_failed",
          currentDestination(page, startUrl.toString()),
        );
      }
    }
    return reviewReceipt(
      "The employer application contains more steps than the automatic runner can safely complete.",
      [],
      "form_too_long",
      currentDestination(page, startUrl.toString()),
    );
  } catch (error) {
    if (timedOut) {
      return reviewReceipt(
        "The employer portal did not finish within the safe application window. Your approved application is ready to retry.",
        [],
        "runner_timeout",
        currentDestination(page, payload.destination),
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
            accountState: portalAccountState,
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

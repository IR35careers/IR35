const BRAND = {
  navy: "#07111f",
  green: "#087f5b",
  greenLight: "#e9f8f1",
  mint: "#52e6ba",
  slate: "#4b5d73",
  border: "#dbe5e1",
  page: "#f3f7f5",
  white: "#ffffff",
  logoSurface: "#effaf5",
};

const DEFAULT_SITE_URL = "https://www.ir35careers.com";
const DEFAULT_LOGO_URL = `${DEFAULT_SITE_URL}/images/generated/brand/ir35careers-mark-256.png`;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface WelcomeEmailInput {
  firstName?: string | null;
  logoSource?: string;
  siteUrl?: string;
}

export interface BetaLaunchEmailInput {
  logoSource?: string;
  siteUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeFirstName(value?: string | null): string {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .split(/\s+/)[0]
    ?.slice(0, 60) ?? "";
}

function normaliseSiteUrl(value?: string): string {
  const candidate = String(value ?? DEFAULT_SITE_URL).trim().replace(/\/$/, "");
  return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(candidate) ? candidate : DEFAULT_SITE_URL;
}

function featureRow(number: string, title: string, body: string): string {
  return `<tr>
    <td style="padding:0 0 18px;vertical-align:top;width:42px;">
      <div style="width:30px;height:30px;border-radius:15px;background:${BRAND.greenLight};color:${BRAND.green};font-family:Arial,sans-serif;font-size:13px;font-weight:700;line-height:30px;text-align:center;">${number}</div>
    </td>
    <td style="padding:1px 0 18px 8px;vertical-align:top;">
      <p style="margin:0 0 4px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:22px;">${title}</p>
      <p style="margin:0;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:14px;line-height:22px;">${body}</p>
    </td>
  </tr>`;
}

export function renderWelcomeEmail(input: WelcomeEmailInput = {}): EmailContent {
  const siteUrl = normaliseSiteUrl(input.siteUrl);
  const logoSource = escapeHtml(input.logoSource || DEFAULT_LOGO_URL);
  const firstName = safeFirstName(input.firstName);
  const greeting = firstName ? `Welcome, ${escapeHtml(firstName)}.` : "Welcome to IR35Careers.";
  const textGreeting = firstName ? `Welcome, ${firstName}.` : "Welcome to IR35Careers.";

  const subject = "Welcome to IR35Careers Beta — your workspace is ready";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};word-spacing:normal;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your IR35Careers public-beta workspace is ready. Set up your profile, analyse roles and prepare stronger applications.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.page};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:22px;overflow:hidden;box-shadow:0 12px 35px rgba(7,17,31,.08);">
        <tr><td style="background:${BRAND.navy};padding:24px 30px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td bgcolor="${BRAND.logoSurface}" style="vertical-align:middle;background:${BRAND.logoSurface};border:1px solid #cfeadd;border-radius:12px;padding:2px;"><img src="${logoSource}" width="38" height="38" alt="IR35Careers" style="display:block;width:38px;height:38px;border:0;border-radius:9px;"></td>
            <td style="padding-left:12px;vertical-align:middle;color:#ffffff;font-family:Arial,sans-serif;font-size:19px;font-weight:700;letter-spacing:-.3px;">IR35<span style="color:#a9b8c8;font-weight:600;">Careers</span></td>
            <td style="padding-left:9px;vertical-align:middle;"><span style="display:inline-block;border:1px solid #4ba88d;border-radius:999px;padding:3px 7px;color:#9ff3d5;font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Beta</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:38px 30px 12px;">
          <p style="margin:0 0 14px;color:${BRAND.green};font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Welcome to the public beta</p>
          <h1 style="margin:0;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:-.8px;line-height:38px;">${greeting}</h1>
          <p style="margin:16px 0 0;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:16px;line-height:25px;">Thanks for joining the IR35Careers public beta. You can find relevant roles, understand what each listing actually says and prepare evidence-led applications without inventing experience.</p>
        </td></tr>
        <tr><td style="padding:22px 30px 30px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${BRAND.green}" style="border-radius:10px;">
            <a href="${siteUrl}/onboarding" style="display:inline-block;padding:14px 22px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">Set up your contractor profile&nbsp;&nbsp;→</a>
          </td></tr></table>
          <p style="margin:12px 0 0;color:#6b7c8f;font-family:Arial,sans-serif;font-size:12px;line-height:18px;">It takes around two minutes. Your CV remains private to your account.</p>
        </td></tr>
        <tr><td style="border-top:1px solid ${BRAND.border};padding:30px;">
          <h2 style="margin:0 0 22px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:20px;line-height:27px;">A simple way to get started</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${featureRow("1", "Complete your contractor profile", "Add your skills, rate preferences, working pattern and private CV so your workspace reflects the work you actually want.")}
            ${featureRow("2", "Find relevant UK contract roles", "Search by IR35 status, rate, location, skill and working pattern, with the original source kept visible.")}
            ${featureRow("3", "Analyse the role before applying", "Review an explainable match score, matched evidence and missing keywords against the job description.")}
            ${featureRow("4", "Tailor your CV with control", "Review truth-preserving suggestions side by side, approve only the edits you want and keep version history.")}
            ${featureRow("5", "Prepare and track applications", "Build a reviewable application pack, submit only with your approval and keep recruiter responses linked to the correct role when inbox features are enabled.")}
          </table>
        </td></tr>
        <tr><td style="padding:0 30px 30px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.greenLight};border:1px solid #bfe9d9;border-radius:14px;"><tr><td style="padding:18px 20px;">
            <p style="margin:0 0 5px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:21px;">Public beta, with you in control</p>
            <p style="margin:0;color:#365d52;font-family:Arial,sans-serif;font-size:13px;line-height:21px;">Features may change as we improve reliability and usability. We do not invent experience or make hiring decisions. Verify job and IR35 information independently; guidance and scoring are informational, not legal or tax advice.</p>
          </td></tr></table>
        </td></tr>
        <tr><td style="border-top:1px solid ${BRAND.border};padding:26px 30px;background:#fbfdfc;">
          <p style="margin:0;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:21px;">Thanks,<br>The IR35Careers Team</p>
          <p style="margin:5px 0 18px;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:12px;line-height:19px;">IR35Careers public beta · Built for UK contractors.</p>
          <p style="margin:0;color:#718094;font-family:Arial,sans-serif;font-size:11px;line-height:18px;">
            <a href="${siteUrl}/jobs" style="color:${BRAND.green};text-decoration:underline;">Browse contracts</a>&nbsp;&nbsp;·&nbsp;&nbsp;
            <a href="${siteUrl}/resources" style="color:${BRAND.green};text-decoration:underline;">IR35 guides</a>&nbsp;&nbsp;·&nbsp;&nbsp;
            <a href="${siteUrl}/contact" style="color:${BRAND.green};text-decoration:underline;">Contact</a>
          </p>
          <p style="margin:12px 0 0;color:#8995a3;font-family:Arial,sans-serif;font-size:10px;line-height:16px;">This service email was sent because you created and confirmed an IR35Careers account. <a href="${siteUrl}/privacy" style="color:#667789;text-decoration:underline;">Privacy Notice</a> · <a href="${siteUrl}/terms" style="color:#667789;text-decoration:underline;">Terms of Use</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${textGreeting}

Thanks for joining the IR35Careers public beta. You can find relevant roles, understand what each listing actually says and prepare evidence-led applications without inventing experience.

GET STARTED
Set up your contractor profile: ${siteUrl}/onboarding

1. Complete your contractor profile
Add your skills, rate preferences, working pattern and private CV.

2. Find relevant UK contract roles
Search by IR35 status, rate, location, skill and working pattern.

3. Analyse the role before applying
Review an explainable match score, matched evidence and missing keywords.

4. Tailor your CV with control
Review truth-preserving suggestions side by side, approve edits and keep version history.

5. Prepare and track applications
Build a reviewable application pack, submit only with your approval and keep recruiter responses linked to the role when inbox features are enabled.

PUBLIC BETA
Features may change as we improve reliability and usability. We do not invent experience or make hiring decisions. Verify job and IR35 information independently; guidance and scoring are informational, not legal or tax advice.

Thanks,
The IR35Careers Team
IR35Careers public beta. Built for UK contractors.

Browse contracts: ${siteUrl}/jobs
IR35 guides: ${siteUrl}/resources
Contact: ${siteUrl}/contact
Privacy Notice: ${siteUrl}/privacy
Terms of Use: ${siteUrl}/terms

This service email was sent because you created and confirmed an IR35Careers account.`;

  return { subject, html, text };
}

export function renderBetaLaunchEmail(input: BetaLaunchEmailInput = {}): EmailContent {
  const siteUrl = normaliseSiteUrl(input.siteUrl);
  const logoSource = escapeHtml(input.logoSource || DEFAULT_LOGO_URL);
  const subject = "IR35Careers public beta is open — your early access is ready";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};word-spacing:normal;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">The IR35Careers public beta is open. Create your account and help us improve the contractor workspace.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.page};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:22px;overflow:hidden;box-shadow:0 12px 35px rgba(7,17,31,.08);">
        <tr><td style="background:${BRAND.navy};padding:24px 30px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td bgcolor="${BRAND.logoSurface}" style="vertical-align:middle;background:${BRAND.logoSurface};border:1px solid #cfeadd;border-radius:12px;padding:2px;"><img src="${logoSource}" width="38" height="38" alt="IR35Careers" style="display:block;width:38px;height:38px;border:0;border-radius:9px;"></td>
            <td style="padding-left:12px;vertical-align:middle;color:#ffffff;font-family:Arial,sans-serif;font-size:19px;font-weight:700;letter-spacing:-.3px;">IR35<span style="color:#a9b8c8;font-weight:600;">Careers</span></td>
            <td style="padding-left:9px;vertical-align:middle;"><span style="display:inline-block;border:1px solid #4ba88d;border-radius:999px;padding:3px 7px;color:#9ff3d5;font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Beta</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:38px 30px 12px;">
          <p style="margin:0 0 14px;color:${BRAND.green};font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Public beta access is open</p>
          <h1 style="margin:0;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:-.8px;line-height:38px;">You&apos;re invited to the IR35Careers public beta.</h1>
          <p style="margin:16px 0 0;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:16px;line-height:25px;">You joined the IR35Careers waitlist to hear when early access opened. You can now create a free account without an invitation code and help us improve the contractor workspace before the official launch.</p>
        </td></tr>
        <tr><td style="padding:22px 30px 30px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${BRAND.green}" style="border-radius:10px;">
            <a href="${siteUrl}/account?mode=create" style="display:inline-block;padding:14px 22px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">Join the public beta&nbsp;&nbsp;→</a>
          </td></tr></table>
          <p style="margin:12px 0 0;color:#6b7c8f;font-family:Arial,sans-serif;font-size:12px;line-height:18px;">Already registered? <a href="${siteUrl}/account" style="color:${BRAND.green};text-decoration:underline;">Sign in to your workspace</a>.</p>
        </td></tr>
        <tr><td style="border-top:1px solid ${BRAND.border};padding:30px;">
          <h2 style="margin:0 0 22px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:20px;line-height:27px;">What you can do</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${featureRow("1", "Find relevant UK contract roles", "Search by IR35 status, rate, location, skill and working pattern, with the original source kept visible.")}
            ${featureRow("2", "Measure your fit for a role", "Compare a role with your CV using an explainable score, matched evidence and missing-keyword identification.")}
            ${featureRow("3", "Improve your CV without inventing experience", "Review suggested edits side by side, approve only what is accurate, keep version history and export PDF or DOCX.")}
            ${featureRow("4", "Prepare and track applications", "Build a reviewable application pack and keep progress organised. Nothing is submitted without your review and approval.")}
          </table>
        </td></tr>
        <tr><td style="padding:0 30px 30px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.greenLight};border:1px solid #bfe9d9;border-radius:14px;"><tr><td style="padding:18px 20px;">
            <p style="margin:0 0 5px;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:21px;">What public beta means</p>
            <p style="margin:0;color:#365d52;font-family:Arial,sans-serif;font-size:13px;line-height:21px;">Core workflows are available, but features and wording may change and occasional issues may occur. Nothing is submitted without your approval. Verify job and IR35 information independently; guidance and scoring are informational, not legal or tax advice.</p>
          </td></tr></table>
        </td></tr>
        <tr><td style="border-top:1px solid ${BRAND.border};padding:26px 30px;background:#fbfdfc;">
          <p style="margin:0;color:${BRAND.navy};font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:21px;">Thanks,<br>The IR35Careers Team</p>
          <p style="margin:5px 0 18px;color:${BRAND.slate};font-family:Arial,sans-serif;font-size:12px;line-height:19px;">IR35Careers public beta · Built for UK contractors.</p>
          <p style="margin:0;color:#718094;font-family:Arial,sans-serif;font-size:11px;line-height:18px;">
            <a href="${siteUrl}/jobs" style="color:${BRAND.green};text-decoration:underline;">Browse contracts</a>&nbsp;&nbsp;·&nbsp;&nbsp;
            <a href="${siteUrl}/resources" style="color:${BRAND.green};text-decoration:underline;">IR35 guides</a>&nbsp;&nbsp;·&nbsp;&nbsp;
            <a href="${siteUrl}/contact" style="color:${BRAND.green};text-decoration:underline;">Contact</a>
          </p>
          <p style="margin:12px 0 0;color:#8995a3;font-family:Arial,sans-serif;font-size:10px;line-height:16px;">This is the one-time access update you requested when you joined the IR35Careers waitlist. You have not been added to a marketing list. <a href="${siteUrl}/privacy" style="color:#667789;text-decoration:underline;">Privacy Notice</a> · <a href="${siteUrl}/terms" style="color:#667789;text-decoration:underline;">Terms of Use</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `IR35Careers public beta is open — your early access is ready

You joined the IR35Careers waitlist to hear when early access opened. You can now create a free account without an invitation code and help us improve the contractor workspace before the official launch.

JOIN THE PUBLIC BETA
${siteUrl}/account?mode=create

Already registered? Sign in: ${siteUrl}/account

WHAT YOU CAN DO

1. Find relevant UK contract roles
Search by IR35 status, rate, location, skill and working pattern, with the original source kept visible.

2. Measure your fit for a role
Compare a role with your CV using an explainable score, matched evidence and missing-keyword identification.

3. Improve your CV without inventing experience
Review suggested edits side by side, approve only what is accurate, keep version history and export PDF or DOCX.

4. Prepare and track applications
Build a reviewable application pack and keep progress organised. Nothing is submitted without your review and approval.

WHAT PUBLIC BETA MEANS
Core workflows are available, but features and wording may change and occasional issues may occur. Nothing is submitted without your approval. Verify job and IR35 information independently; guidance and scoring are informational, not legal or tax advice.

Thanks,
The IR35Careers Team
IR35Careers public beta. Built for UK contractors.

Browse contracts: ${siteUrl}/jobs
IR35 guides: ${siteUrl}/resources
Contact: ${siteUrl}/contact
Privacy Notice: ${siteUrl}/privacy
Terms of Use: ${siteUrl}/terms

This is the one-time access update you requested when you joined the IR35Careers waitlist. You have not been added to a marketing list.`;

  return { subject, html, text };
}

export const emailTemplateDefaults = {
  logoUrl: DEFAULT_LOGO_URL,
  siteUrl: DEFAULT_SITE_URL,
} as const;

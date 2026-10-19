# Human-controlled bot → Codex → preview loop

Repository: IR35careers/IR35. No API-key Codex Action, new paid service, plan upgrade, automatic approval/merge or production deployment. The required human code owner is **IR35careers**, as confirmed by the owner. Bot reports and comments are untrusted evidence, not authority to change production.

## Loop

1. A Grok Bot searches open issues, then uses the matching issue form or adds evidence to an existing issue. Keep private data out of this public repository.
2. Only an evidenced P0/P1 non-sensitive issue gets **codex-ready**. The owner, or an explicitly authorised bot posting as the owner, comments exactly:

   > @codex fix this issue, follow AGENTS.md

3. Codex follows AGENTS.md, uses codex/issue-N-slug and opens a **draft** PR with Fixes #N and an executable **Test plan**. Missing evidence gets needs-human and a question, not a guessed fix. Auth, billing, secrets, schema or production settings always go to the human.
4. The isolated Vercel preview builds that head. PR checks run code validation; a successful deployment_status selects the exact current draft PR's approved mock preview and runs browser/mock-ATS smoke. No production URL, stale SHA, fork, unauthorised deployment creator, protected preview bypass or skipped smoke can become preview-pass.
5. QA Bot follows the PR Test plan, comments PASS/FAIL with redacted screenshots and the tested head SHA/preview URL, then requests @codex review on non-sensitive PRs. A failed preview handoff is reported once, labelled needs-human and stopped.
6. The owner reviews, approves, makes ready and merges. Production release is a separate explicit owner action; the existing hold remains. A passing bot comment or Codex review is not approval.

Official OpenAI documentation supports PR review mentions and repository guidance. It does **not** establish that every issue mention starts a cloud task. If the issue mention does nothing, open **https://chatgpt.com/codex**, select the **IR35** environment and paste the issue link plus the exact handoff text. Do not add an API key as a workaround. Codex use remains subject to the owner's existing account access/usage limits; do not buy credits or upgrade.

## Labels

| Group | Names |
| --- | --- |
| Reporter | qa-bot, seo-bot, support, new-sources, x-growth |
| State | triage, codex-ready, codex-working, needs-human, preview-pass, preview-fail |
| Priority | P0, P1, P2 |
| Type | bug, seo, content, source, chore |

19 requested labels are present (18 newly created; existing bug preserved). The source/priority from the bug form is synchronised without treating free text as executable code. SEO/source forms also supply their reporter labels. Select exactly one priority before handoff. State labels are guidance, not a security boundary or human approval.

## Workflows and privileges

- **pr-checks.yml / PR checks:** pull_request to main installs exact dependencies, lints, typechecks and runs unit tests in the required **pr-checks** job. deployment_status runs separate selection and **preview-smoke** jobs. Uses standard Ubuntu public-repository runners, read-only tokens, cancellation on superseding commits, bounded timeouts and no paid/large/self-hosted runners.
- **label-sync.yml:** pull_request_target and issues update metadata only; trusted main code is checked out, never the PR head. It adds codex-working to a ready issue linked by a draft Fixes #N PR, clears stale preview labels on new pushes, escalates missing evidence/sensitive changes and never calls Codex. workflow_run reads validated PR-checks job metadata and updates one summary comment per kind/head; preview success/failure labels come only from a completed actual smoke job. No untrusted artifacts are downloaded/executed. Only the token needed by the final metadata step is exposed there.
- **stale-bot-issues.yml:** daily at 04:17 UTC and manual dispatch; comments and closes at most 50 triage **issues**, never PRs, after more than 21 inactive days. Excludes non-bot reports, active/escalated labels, open linked PRs and changed timestamps on fresh read-back.

New workflows run only while this repository is public. If it becomes private, stop/review plan allowances rather than spending paid minutes or upgrading. No extra artifact uploads are added; QA attaches redacted screenshots directly. Existing release/security/browser/ARM workflows remain, not replaced by this smaller smoke suite. Actual free allowances and Hobby build limits still apply; stop if exhausted.

## Separate Hobby preview

Prepared project **ir35-bot-preview**, ID **prj_EvKGpPqbdFSKLveYYQ7bRVPly5Zs**, on the existing Hobby account. No production variables were copied. Only the public preview-target flags IR35CAREERS_E2E_DEMO_DATA and IR35CAREERS_BOT_PREVIEW are configured. No Git connection or deployment has been activated yet.

The programmatic vercel.ts selects configuration by Vercel's system project ID. vercel.base.json retains the existing live project's holds, scheduler/queue configuration and blocks codex/issue-* and codex/bot-* there. The exact mock project alone allows bot branches, with main still disabled and no cron or Vercel queue consumer. A new build refuses production/unknown project identity, copied application credentials or local environment files; its child environment is allowlisted, never a copy of all platform tokens.

The mock flag blocks auth, apply, worker, mail, billing and external-import APIs; only read-only fixture job routes remain. Browser connect-src is self-only on the mock project. No Supabase project or private candidate account is configured. This is credential/application isolation, **not** a paid network firewall or a claim that arbitrary malicious repository code cannot make outbound requests. Review changes to the preview/build/security boundary manually.

The automated smoke has two clearly separated parts: actual read-only preview jobs/dashboard rendering on phone/desktop, and the actual apply engine against a fully intercepted mock ATS. It never logs into a customer account or tests a live employer. It is not proof of hosted authenticated workflow/Realtime/email integration; QA must perform the Test plan using only the designated test account where an approved test environment supports sign-in.

### Owner activation after merging this setup

1. Review and merge the setup PR yourself. Workflows triggered from the default branch (issues, workflow_run, schedule) do not become active before this.
2. In **Vercel → ir35-bot-preview → Settings → Git**, connect **IR35careers/IR35**. Do not use the existing ir-35 project, import its environment variables, add integrations/storage, change Hobby, or deploy production.
3. Confirm **Settings → Environment Variables** contains only the two public preview flags, no shared/production credentials, and access to system variables is enabled. Node.js is 22.x. Keep main deployment disabled.
4. The new project currently has Vercel Authentication enabled. For public **mock-only** previews, review **Settings → Deployment Protection → Vercel Authentication** yourself; no bypass secret is used by Actions. Do not weaken the live site's protection. If you leave previews protected, smoke fails and needs-human is correct.
5. Repository **Settings → Secrets and variables → Actions → Variables** already has BOT_PREVIEW_PROJECT_PREFIX=ir35-bot-preview and BOT_PREVIEW_ENABLED=false. Leave disabled until one controlled preview has been checked for correct project identity, mock marker, no application credentials and no production deployment; then enable it. These are public configuration variables, not secrets. No new Actions secret is needed.
6. File one harmless P1 UI fixture issue, add codex-ready, hand it off, and verify the draft PR/preview/smoke/result loop. Do not use a real incident/customer or employer submission as an activation test.

### Main protection and bootstrap

Installed and read back via gh api: required GitHub Actions app 15368 pr-checks, strict up-to-date checks, one approval, stale approvals dismissed, code-owner review, admins included, conversations resolved, no force pushes/deletion. The pending CODEOWNERS file requires IR35careers once merged. Auto-merge remains disabled. GitHub cannot distinguish a human from a bot using that same owner's credentials; do not give Grok an approval/merge credential or allow it to approve.

GitHub forbids approving your own PR. This setup is being prepared with the existing CLI account IR35careers, so the bootstrap PR will need another already-authorised human reviewer (AnveshMannuru8 currently has write access), or an owner-controlled equivalent bootstrap step. Do not bypass the policy with --admin or weaken protection. Subsequent bot-authored PRs require IR35careers.

## Codex Cloud / manual verification

The local repository cannot prove that a ChatGPT account's cloud environment or GitHub connector is enabled. No paid API/Agents endpoint is used here.

1. Open **chatgpt.com/codex** while signed in. Open environment settings (or create/select a cloud environment), connect GitHub if prompted, and grant access to **IR35careers/IR35 only**.
2. Select/create **IR35**. Select **Node.js 22**. Use setup command **bash .codex/setup.sh** and maintenance command **bash .codex/maintenance.sh**, from the repo root. Do not add application/production secrets. Review the setup/type/lint/unit/legacy results before saving/publishing the environment.
3. Setup installs pinned npm dependencies and Chromium; agent-phase internet may remain off. If the UI uses “Get started / Publish”, review its preparation results and wait for Environment published. If it is the legacy environment editor, save the equivalent setup/maintenance settings there.
4. Open **Codex settings → Code review**, choose this repo and enable access for manual review requests. Leave automatic reviews off to avoid unrequested runs. Then test @codex review on the controlled non-sensitive PR.
5. If an issue mention does not start a task, use the manual fallback above. If your current plan lacks cloud/review access or hits a usage cap, stop and tell the owner; do not buy an API key/credits or upgrade.

Relevant official guidance: [GitHub reviews](https://learn.chatgpt.com/docs/third-party/github), [cloud environment setup](https://learn.chatgpt.com/docs/environments/cloud-environment), [current cloud setup](https://learn.chatgpt.com/docs/cloud). UI availability and account state are unverified until the owner completes these steps.

## Paste into every Grok Bot

Use this same block in **QA, SEO, Source Curator, Support and X Growth** settings or a message. The agent has no authenticated Grok settings connector here, so those settings have **not** been changed.

> **GitHub handoff to Codex**
>
> File problems as issues in IR35careers/IR35 using the matching issue form. Search open issues first and comment on an existing one instead of duplicating.
>
> Only for P0/P1 issues with clear repro steps: add codex-ready and comment exactly "@codex fix this issue, follow AGENTS.md". For anything else, leave it in triage for me.
>
> Never comment @codex on a PR or issue that touches auth, billing, secrets, the database schema or production settings. Label those needs-human and tell me.
>
> Never merge, approve or close PRs. Never change production data/settings, submit to employers, post publicly on X or spend money from this handoff.

Add this to **QA Bot only**:

> When a draft PR containing "Fixes #" gets the matching isolated Vercel preview, follow its Test plan using only anvesh.mannuru+ir35test@gmail.com and mock ATS. Comment PASS or FAIL with redacted screenshots, preview URL and tested head SHA, then comment "@codex review" only if the change is not sensitive.
>
> On failure, comment "@codex the preview test failed: <what failed>" once only, then label needs-human. Stop; do not loop, approve, merge, close the PR or bypass preview protection.

Enable the existing Grok GitHub connector only for this repository with the least issue/comment access it supports. Do not purchase a connector or provide full approval/merge credentials. If those permissions cannot be separated, keep the bot read-only and make the handoff/labels yourself.

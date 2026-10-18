# P0.7 — native approval interaction regression

## What / why

The current application record already reads the native checkbox change value into a boolean before updating the current store. The reported label-only behaviour is **not reproduced on current merged code**; do not invent a new root cause or claim an unrelated rewrite fixed it. P0.6 also removed the stale component/save-ack copy used by all editor actions. This follow-up preserves the working native control and adds missing end-to-end protection.

The new test targets the input with ordinary `click()` (not `check()`), the visible label, actual native touch and normal Tab/Space keyboard interaction. Each changes the three stored approval flags exactly once. It checks Submit is initially disabled/enabled/disabled appropriately, approval survives preview reload, and editing the CV clears all approvals and disables Submit. Every viewport runs touch and keyboard; there are no new skips.

## Verification / screenshots

Isolated production build and **three browser cases pass** on phone/tablet/desktop (2.2 minutes); zero submission requests. Test attachments capture the native approval control for each viewport. This is labelled-preview persistence evidence, not authenticated Supabase Realtime or production proof. Final-head CI remains required. No application code was modified, so no runtime fix is being claimed from these tests alone.

## Migration / environment / manual steps

None. No RLS, CSP, dependency, runner flag or production setting changes. Railway's 1 GB account ceiling still blocks the requested 2 GB standby deployment; migration 025/compatible web release and production verification remain open. No DNS, Stripe, Postmark, Google or provider manual action for this test-only change.

## Production verification

After the compatible release, sign in as anvesh.mannuru+ir35test@gmail.com and repeat the native input/label/keyboard/touch checks on a controlled mock ATS application. Confirm stored approval after reload and reset after editing materials. Do not submit to a real employer. The production hold and YES CUTOVER gate remain unchanged; phases 0–7 remain active.

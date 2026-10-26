# Post-P6 CI / P7 bootstrap stop — 26 October 2026

The owner requires **any failure → stop, preserve evidence and wait**. No automatic repair/retry was made after these findings. This report does not revoke or invent a native data/security result.

| Scope | Actual result |
| --- | --- |
| P1–P4 | Previously signed off, draft PRs49–53 remain unmerged. |
| P5 | Previously PASS, draft54; SDK401/401/200 rechecked in fullP6. |
| P6 native | **PASS**, [signoff](oracle-p6-signoff-20261026.md):152checks, actual fixed-IP restart/Realtime/three schedules/heartbeat, complete containment. Exact acknowledged job completed once/no republish. SMTP0/no real employer payload. |
| P6 source delivery | Pushed `5df3f44047cf0377989af689b38a091b0d0cd7c2` to [draft57](https://github.com/IR35careers/IR35/pull/57), OPEN/unmerged. [Native signoff comment](https://github.com/IR35careers/IR35/pull/57#issuecomment-6421711744). |
| Hosted CI | **FAIL:2compile-test errors**, [job](https://github.com/IR35careers/IR35/actions/runs/40361960199/job/121709490293).512tests, errors2. The ten other reported checks passed, including build/types/security, ARM mock image, private Caddy and desktop/mobile/tablet browser jobs. Not a green overall release. |
| P7 local preparation |515Linux helper testsPASS (24.379s), including3new read-only/redaction/unchanged-guard tests; no new runtime/Auth test claimed. |
| P7 attempted audit | **STOP before SSH**: `FileNotFoundError`. The new local journal parent `docs/evidence/p7` did not exist; its audit slot was never created. Subsequent local-only context validationPASS, parentfalse/slotfalse; zeroSSH/VM/Auth/mail calls. No fresh P7containment result exists. |
| P8/P9 | Not started; P9 remains preparation only, and no cutover approval exists. |

## CI evidence and root cause

Only filtered failure metadata was read from the public CI log; no private values were fetched or copied:

```text
ERROR: test_complete_public_remote_bundle_compiles_without_execution
  (test_p6_capture_repair.CaptureRepairTests)
ERROR: test_remote_bundle_covers_imports_and_compiles_before_any_vm_action
  (test_p6_integration.IntegrationTests)
FileNotFoundError: [Errno 2] No such file or directory:
  /home/runner/.ir35/keys/oracle-migration-20261020/p3-cloud-clone.json
Ran 512 tests in 7.624s
FAILED (errors=2)
```

Both compile-only tests invoke the public bundle builder, whose live bootstrap assembly reads operator-private state. That state correctly does not exist on the credential-free GitHub runner. Local tests passed because this operator machine has it; that was not a hermetic CI proof. **Do not upload the file, supply real keys, add CI secrets, remove tests or relax assertions.**

Proposed offline fix only: inject a non-secret bootstrap fixture for compiler/import-order tests; explicitly fail tests if they try private-state/network access. Preserve live runtime custody/manifest checks and all semantic assertions. Run the complete helper suite in a fresh environment with no `.ir35` directory before updating draft57.

## P7 evidence and root cause

The controller successfully validated clean P7branch, exact fullP6manifest, P4/P5/P6 anchors and metadata. It then attempted `Journal(root)`. Journal intentionally uses exclusive `root.mkdir()` and requires its parent to exist. A new phase had no `docs/evidence/p7` parent, so construction failed **before the intent, remote bundle assembly or SSH call**. No native audit slot was consumed or fabricated as PASS.

Local-only diagnostic returned:

```json
{"p7JournalParentExists":false,"p7AuditSlotExists":false,"p6SealedFullResultExists":true}
{"metadataContextStatus":"PASS","sshCalls":0,"vmWrites":0,"authRequests":0}
```

Proposed offline fix only: establish/validate the controlled phase evidence parent before constructing the exclusive journal, test absent-parent/existing-slot behaviour, then run ONE fresh read-only P7audit. Never weaken O_EXCL, overwrite a failed slot, bypass the fullP6gate, or repeat the used P6lifecycle.

The P7branch `codex/oracle-migration-p7` remains local/unpublished; no new draft/CI build was triggered after the stop. Source Auth settings still need a complete private handoff: [checklist](../oracle-auth-checklist.md), [existing incomplete metadata](../oracle-auth-config-metadata.json). Confirmed local handoff path absent and no `SUPABASE_ACCESS_TOKEN` in the operator environment; this does not claim no credentials exist anywhere else. No management-token search, provider setup or real-secret retrieval was attempted. Missing templates/rate/session/provider settings must not be replaced with guessed defaults. G3questions should be batched after the repaired read-only inventory, not require passwords/tokens in chat.

## Containment / cost / remaining scope

Last actual full containment is native35's PASS (manifest `ef7f9bfcc3c48737dcb8bf6a69e3850fc611165cc519f987e2d42c3bf0985f4f`):62table counts+orderedMD5, Auth hashes/rows,2sequences, schema3approved exceptions only,552baseline+2approved queue roles,73StorageSHA256, fresh112HBAlogins. The P7bootstrap made no VM changes, so there is no P7rollback to perform. No new rollback of successful P6 was attempted for an offline CI/launcher failure.

Existing staging remains mock/private-SMTP; production and all providers are untouched. This turn created no cloud resources: existing A1 2OCPU/12GB and50GBboot+100GBblock remain the approved envelope. No fresh OCI cost/usage query or £0billing claim is made. No production/DNS/Vercel/cloudSupabase/Google/IAM/network/secret-value/paid change, merge or real application/email. P7fullAuth, P8load/backups/restore/reverse-sync/monitoring and P9runbook/dry-run remain unfinished. Literal **YES CUTOVER** is absent.

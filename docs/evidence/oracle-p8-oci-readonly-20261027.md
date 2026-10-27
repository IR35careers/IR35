# P8 current OCI read-only audit — 27 October 2026

Audit completion **PASS**, not whole-phase or production signoff. Owner's fresh browser confirmation was independently verified with an ACTIVE ir35 compartment GET. Profile ir35, SecurityToken only, uk-london-1. Existing SSH fingerprint remains loaded without a lifetime; no new SSH/API passphrase prompt.

| Check | Observed | Bound / result |
| --- | --- | --- |
| Subscription / home region | ACTIVE FREE_TRIAL; London READY/home | PASS; no upgrade |
| Running A1 | One VM.Standard.A1.Flex, 2 OCPU / 12 GB; live shape billingType LIMITED_FREE | PASS, full owner compute envelope |
| Live volumes | One boot + one data volume, 150 GB combined | 150 GB owner cap / 200 GB free allowance |
| Volume backups | 0 | Maximum 5 combined boot/block backups |
| Object Storage | ir35-backups, private Standard; 0 objects, 0 versions/delete markers, 0 uploads/parts, **0 exact bytes** | Two identical complete passes; 14 GET/list requests; 8 GB owner cap, below 80% of 20 GB |
| Root quota | ACTIVE; GET returns all 3 EXACT approved statements | PASS; LIST summaries omit statements |
| Budget / actual alert | Existing GBP1 budget and 100% ACTUAL alert verified | Alert is not a spending cap |
| Lagging cost report | GBP net0 / positive0, one row; current month through previous UTC midnight | NOT real-time zero-billing proof |
| Backup VM dynamic groups | 0 active groups | Backup instance-principal access not established; no IAM change |
| Policies / alarms | 1 root policy, 0 child policies, 0 alarms | Statements/rules hashed, never raw; no new policy/alarm |
| Notifications | Existing ir35-alerts topic + expected email subscription ACTIVE | Delivery test not performed; no real email sent |

Oracle's [current Always Free reference](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) specifies 1,500 A1 OCPU-hours/9,000 GB-hours, 200 GB live block volumes and 5 backups. Its Object Storage trial tier distinction includes a 10 GB Standard allowance; the owner's stricter 8 GB Standard-only cap remains below that and the post-trial combined20GB. Trial credits are not spending authority. Monthly request usage remains a separate release check; these 14 reads are not a whole-month request count.

## Evidence and bounded tooling repairs

- [Original01 FAIL](p8/oci-readonly-01/result.json), manifest `a7f27ed44b9cfcfed9911e10816677b3c91f0b407fa973c3e6c36b9b05c089ca`: after37 metadata reads, first counter label contained underscores rejected by the journal filename policy, BEFORE any Object Storage request. Offline regression reproduces zero API calls, then proves unchanged complete counter observations through a hash-named adapter. Journal policy/byte accounting unchanged.
- [Second02 FAIL](p8/oci-readonly-02/result.json), manifest `6c3b9fbddaefd41bf9c4a2604e4f755d954a2ea1befd542876968e7aaab6e860`: exact bytes/account/resource/cost inventory recorded, then new harness incorrectly expected full statements on a quota LIST summary. Separate authenticated list/get diagnosis confirms LIST has no statements, GET returns3/exact parity. No actual quota drift found; nothing changed.
- [Completion03 PASS](p8/oci-readonly-03/result.json), manifest `9e792756a7e5c233e909bab43556933f4a0605da666cae55ea9340e3ffcf8788`: verifies BOTH immutable prior manifests; reuses only the sealed <15-minute inventory, performs9 fresh account/quota/instance/shape reads, scoped quota GET and exact parity. No object re-list or failure reset;02 remains FAIL. Third gate passed, no fourth attempt.
- [Backup access metadata PASS](p8/backup-access-readonly-01/result.json), manifest `57227b655010b92ba39e773281164fa5e3e389b183656c97747f1f2e0cb6f172`:6 fixed list calls, no keys/IAM/bucket/object mutation. Listing alone is not an effective-permission or delivery test.

All journals use exclusive slots/files and hash checks; only names/counts/hashes/safe boolean metadata are public. No VM/customer-data write, build, restart, bucket/object upload/delete, key generation, IAM/network/production/provider/DNS change or cutover occurred.

## Tests and outstanding gates

**Final source verification:** all607 helper tests PASS in a fresh empty HOME/no `.ir35`,62.461s, manifest `1d0faa872a32d9490e41f0d581ee41b120460483c21929b4e3ae0a3b9fb879a0`; [result](p8-oci-final-01/result.json). This includes the unchanged-summary/required-GET quota regression and all cleanup/redaction/byte/ACL checks. Source/history security scan PASS1860tracked files. No runtime encryption or restore is inferred from mocked unit tests.

Initial fresh-home suite604PASS (85.447s). After the counter regression,605-run failed only because the public grandchild fixture's two cold Python starts consumed its unchanged0.2s deadline BEFORE the PID file existed. Original logs/manifest `2dd502238a9379a002c9a8638d19477e0032fc00fd7346d81d28c30ff6dfd127` retained. Public POSIX shell/sleep fixture removes interpreter startup overhead while preserving pipe/process-group semantics; now also asserts parent exit0. No production code, deadline or existing semantic assertion relaxed. Focused10PASS; subsequent fresh-home605PASS72.86s, manifest `e1af3ac4fdeef988ce8754a71384f48cf961a57a85fc7f14a81afec426dc531f`. Final quota GET regressions are checked separately and in hosted CI; no real keys/private home/network/VM supplied to these unit tests.

P6 remains PASS; P7 scoped Auth/Storage PASS, real Google/SMTP deferred. P8 remains **INCOMPLETE**: full writable browser QA, actual age-encrypted automated backups/upload/restore, zero-loss managed-Storage reverse path, monitoring/disk-alert installation and timed drills. No new full containment is claimed from an OCI metadata audit; latest actual full containment is the separate [reverse-readiness proof](oracle-p8-reverse-readiness-20261027.md), with62 orderedMD5/Auth/2seq/3approved exceptions/552+queue roles/73Storage/FRESH112HBA PASS and no subsequent VM/customer-data writes in this audit.

Owner-only backup needs, in ONE batch: existing PUBLIC age recipient + approved offline restore-custody mechanism, OR explicit approval for one hidden-prompt encrypted offline age-key ceremony; conditional exact-one-VM/one-private-bucket IAM described in the P9 owner-runtime gate document. No private identity is requested in chat, generated, searched for or placed on the VM. Current absence of alarms/recipient/timers is not a reason to bypass those gates. The managed Cloud Storage reverse metadata/version preservation gap remains independently unresolved. P9 remains NO-GO/preparation only; exact YES CUTOVER is absent.

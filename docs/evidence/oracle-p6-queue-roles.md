# P6 approved role additions — PASS (not full P6)

Prerequisite [P5 SDK proof](p5-sdk-owner1/edge-summary.json): missing401, suffix401, valid200, allPASS; edge +full containment PASS. Mandatory confirmation was performed before provisioning. Edge seal `894c6408b8c47329106d0061666e728a0224d92e6cc7e8410944722d60ce616c`.

Owner approved same Postgres, these TWO additions only:

| Role | Login | Superuser / CREATEROLE / CREATEDB / BYPASSRLS / replication / inherit | Connection limit | Source-role changes |
|---|---|---|---|---|
| ir35_queue | yes | all false | 4 | none |
| ir35_queue_producer | yes | all false | 2 | none |

Only the empty operational `postgres.pgboss` ownership/USAGE ACL was changed. No source memberships/config/expiry or customer schema/RLS/ACL was changed. Fresh credentials generated on VM only; `/opt/ir35/.env.p6-queue-owner` and `/opt/ir35/.env.p6-queue-producer`,600/ir35. No credential values are exported.

| Gate | Result |
|---|---|
| [Preflight](p6-role-preflight.json) | PASS; existing administrator, empty schema, private DB, logging guards |
| [Two-role atomic install](p6-role-install.json) | PASS; no source-role writes |
| Actual TCP credential probes | 2/2PASS |
| Actual auth.users/public.profiles/storage.objects reads | 6/6denied42501 |
| All-object table+column privilege matrices | 126operational +114pristine +114app checks;0unexpected access |
| Pristine +app ordered-MD5 verification | 62tables each,2sequences each, Auth fingerprints unchanged |
| Existing effective privilege baseline | 552each PASS, not edited |
| Source schema/roles | Three previous owner exceptions +TWO exact approved role additions; no unexplained differences |
| Every physical Storage object | 73each exact SHA256 |
| Manifests, original rollback configuration | PASSunchanged |

Install seal `d3e50dd54ef1ae243537629f75b4685e5955a8851e2b2d2fb06c69066f90a85a` under `/opt/ir35/.env.p6/03-queue-roles`. Private sealed pristine/fixture reports RETAIN the raw baseline FAIL/diff for the two additional role objects, and classify only these exact nonprivileged roles in a separate P6 approval report. Nothing is removed/rehash-normalised from the source or target catalog; the552matrix is passed unmodified.

No queue objects, consumer, timer or real application was started by this operation. Next is separately hash-bound mock worker build/setup/lifecycle/health, then Realtime/schedules/full phase signoff. P6 remains incomplete. No production/cloud/Vercel/DNS/provider/paid/merge/cutover change.

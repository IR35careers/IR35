# Separate cloud baseline candidate — blocked fidelity, no executable SQL

## What and why

Owner requested baseline reconciliation separately from P3. This small stacked draft binds the actual generated private cloud schema archive to its fresh-target result, documents the remaining work and tests that failed evidence cannot be labelled ready. **It is not a completed baseline migration:** restore SQL succeeded, fidelity FAIL494; executable/publicSqlPublished/upgradesTested remain false. PR51 contains all77original drift entries/security flags and the new exact-clone failed gate.

## Risk / migrations / env

No raw SQL/dump, role-config value, credential or customer data published. Existing migrations unchanged, no installer/deploy workflow, no env/provider/source-cloud/Vercel/DNS/production change. No waiver of433grants or other differences, RLS weakening, new IAM/paid service, merge/approval/closure or YES CUTOVER. Original target retained; P4/P5 and upgrade testing have not started.

## Test plan

- Run tests/unit/oracle-cloud-baseline.test.ts: manifest hash/bytes must match the export, status/counts must match the actual failed gate, executable=true must fail validation and no.sql file may be present.
- Review supabase/baseline/README.md plus docs/evidence/oracle-p3-cloud-clone.md. Fresh-install zero differences is **not achieved**. This must not enter migration execution or be merged as a ready baseline.
- Remaining staged ownership/ACL/role repair requires explicit review after the failed gate. Subsequent fresh install must prove0unexplained differences; upgrades run only on a separate verified-clone copy. Full data verification is later, not inferred from catalog tests.
- No UI screenshot/preview required, app not deployed. Later authorised E2E uses anvesh.mannuru+ir35test@gmail.com/mock ATS only; never real employers or production.

Manual steps: review the new fidelity failure and direct its staging-only repair. No login/passphrase/DNS/Google/cutover action requested by this candidate.

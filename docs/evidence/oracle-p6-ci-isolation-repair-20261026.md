# P6 CI isolation repair — 26 October 2026

Owner-approved offline-only repair for draft [PR57](https://github.com/IR35careers/IR35/pull/57). No native P6 lifecycle replay, keys uploaded, CI secrets, production or cutover change.

The two compile/import-order tests now substitute a test-only public bootstrap, not operator-state files. Every downstream source still loads, compiles and retains the original order/semantic assertions. Inside those tests, private filesystem access, sockets/DNS, subprocesses and writes fail explicitly with `OfflineBootstrapViolation`. New regressions prove the guards and restoration of the unchanged live builder; live custody/manifest/export checks were not edited.

The full suite then ran in a cleared environment with a new empty temporary home. No `.ir35` existed before or after, no private files/keys were copied and no VM call occurred. **514 tests PASS,33.38s**. Complete fixture-only outputs and exclusive intent/result are [here](p6/ci-isolation-01/result.json); manifest SHA256 `344266071b907ad8808f721a620d6211922fb23ca7bb23e009b0c830a286ab2e`.

This is local hermetic-suite proof, not an invented hosted CI PASS. Hosted checks must independently pass on the pushed head before the authorised ONE read-only P7 audit. Previous CI failure and all native evidence remain intact.

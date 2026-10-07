# Target deployment and verification contract

Own the transition from reviewed workspace/snapshot to Target ELMA and proof of resulting state.

## Invariants
- Target is an explicit connection reference.
- Deployment input is an immutable candidate derived from a known snapshot/workspace.
- Required supported compile/validation gates are green.
- User sees target identity and candidate diff before state change.
- Initial E2E requires explicit confirmation.
- Exit success is not deployment proof.
- After deployment, read back/re-export Target and compare expected source/runtime/version where supported.
- Verification evidence attaches to the deployment record.
- Failure never produces Verified state.
- PROD is not enabled by the first implementation.

Candidate states: draft -> checked -> ready -> deploying -> deployed-unverified -> verified.

## Implemented: delivery foundation (AR-04, part 1 — synthetic Target only)

`lib/delivery.mjs` implements the attempt lifecycle, evidence record and read-back verification behind the adapter interface from the [connections contract](source-target-connections.md). API: `/api/connections` (owner-scoped references, read-only `probe`), `GET/POST /api/releases/:id/delivery` with actions `prepare`, `confirm`, `verify`. Every route authorizes the owner first; connections and attempts live in `.local/delivery/`, private file modes, outside Git.

Attempt states: `prepared -> deploying -> deployed-unverified -> verified | verification-failed`, plus `failed` (adapter error), `unknown-outcome` (timeout or service restart during `deploying`) and `blocked` (identity or target state changed after preparation). Only a matching read-back produces `verified`; the release's `target` check mirrors the latest attempt (`pass` only for `verified`).

Guards that are enforced server-side, not in the UI:
- `prepare` requires the release's current approval and frozen candidate, a `target`-role connection, a reachable Target whose identity is confirmed, deploy/read-back capabilities, and no other active attempt for the release. It records target identity and the pre-deploy inventory hash of the solution as rollback reference.
- `environment: prod` is refused (403). A connection whose probed host is listed in `PROTECTED_TARGET_HOSTS` is refused regardless of its name.
- `confirm` requires the literal confirmation `DEPLOY <solution code> <first 12 hex of candidate SHA-256>` and an idempotency key. It re-checks that release revision, candidate ID/hash and approval are unchanged, re-probes identity and re-inspects the Target; drift or identity change marks the attempt `blocked`. The `deploying` state is persisted before the adapter is called. Repeating the same key returns the existing attempt; a different key on a non-prepared attempt is 409. The adapter is called at most once per attempt.
- `verify` re-reads the Target and compares every non-volatile candidate file by path and SHA-256. `manifest.json`/`package.json` at any depth are reported as volatile and not compared (import legitimately rewrites history/versions). A read-back equal to the pre-deploy state is reported as "import not applied". `verify` is allowed from `deployed-unverified`, `unknown-outcome` and `verification-failed`.
- Connection references accept no credential-like keys (`token`, `password`, `secret`, `cookie`, `authorization`, ...) and no URLs with embedded credentials. Adapters receive only non-secret options.

## Not implemented / limitations
- **No live adapter exists.** The only adapter is `synthetic` (deterministic scenarios: apply, unapplied, fail, timeout, drift). A hosted service refuses to create connections unless `DELIVERY_SYNTHETIC_ADAPTER=1`, so no hosted release can be verified against a fake target. The first real non-production path (DEV export → dev2 import → re-export) still needs an approved bridge that keeps `elma365pm`/tokens outside the Wiki process; see the connections contract and the ROADMAP.
- Comparison is by expanded file hash, not by ELMA semantics; descriptor/runtime/version comparison for the supported widget path comes with the bridge.
- One service process; the lock is per release, not a distributed job queue. Interrupted operations are reconciled lazily to `unknown-outcome` on the next read.
- Rollback reference is the pre-deploy inventory hash of the Target only; no package restore is performed.
- UI: the release page shows a «Доставка на Target» section (connections without credentials, read-only probe, prepare, literal confirmation, read-back, evidence and attempt log) once the current candidate is accepted. Without a configured adapter the section states the service limitation and keeps the private handoff bundle as the only path. Eight synthetic Storybook states (`Аналитик/Доставка на Target`) mount the production renderer; the `source-target` journey in `/flows` remains proposed until a live adapter exists.

## Evidence
`npm run test:releases:browser` drives the real authenticated UI: wrong confirmation rejected, an "unapplied" synthetic import ends as «Read-back не совпал» with the release's target check failed, and an applying target ends as «Проверено read-back» only after the read-back. `node --test test/delivery.test.mjs`: complete prepare/confirm/verify path with linked evidence; success-but-unapplied import never verified; PROD by environment and by actual identity refused; stale approval and drift block confirmation; duplicate confirmations run the operation once; timeout and restart produce `unknown-outcome` that only read-back resolves; credential-like fields refused; owner isolation; API gating of the synthetic adapter. Synthetic only — no live Target was touched.

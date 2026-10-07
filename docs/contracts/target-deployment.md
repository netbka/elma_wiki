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

`lib/delivery.mjs` implements the attempt lifecycle, evidence record and read-back verification behind the adapter interface from the [connections contract](source-target-connections.md). API: `/api/connections` (owner-scoped references, read-only `probe`), `GET/POST /api/releases/:id/delivery` with actions `prepare`, `confirm`, `verify`, `cancel`. Authenticated GET `/api/delivery/capabilities` reports `synthetic` or `unavailable`, with `liveDelivery: false`. Every route authorizes the owner first; connections and attempts live in `.local/delivery/`, private file modes, outside Git.

Attempt states: `prepared -> deploying -> deployed-unverified -> verified | verification-failed`, plus `failed` (adapter error), `unknown-outcome` (timeout or service restart during `deploying`), `blocked` (identity or target state changed after preparation), and `cancelled` (owner cancelled preparation before dispatch). Only a matching read-back produces `verified`; the release's `target` check is `pass` only for a verified attempt bound to the current revision, candidate ID/hash and acceptance. Changing conditions or the candidate makes historical evidence `stale`, including in mutation responses. Synthetic results are explicitly labeled as a training stand, not ELMA.

Guards that are enforced server-side, not in the UI:
- `prepare` requires the release's current approval and frozen candidate, a `target`-role connection, a reachable Target whose identity is confirmed, deploy/read-back capabilities, and no other active attempt for the release. It records target identity and the pre-deploy inventory hash of the solution as rollback reference.
- `environment: prod` is refused (403). A connection whose probed host is listed in `PROTECTED_TARGET_HOSTS` is refused regardless of its name.
- `confirm` requires the literal confirmation `DEPLOY <solution code> <first 12 hex of candidate SHA-256>` and an idempotency key. It re-checks that release revision, candidate ID/hash and approval are unchanged, re-probes identity and re-inspects the Target; drift or identity change marks the attempt `blocked`. The `deploying` state is persisted before the adapter is called. Repeating the same key returns the existing attempt; a different key on a non-prepared attempt is 409. The adapter is called at most once per attempt.
- `verify` re-reads the Target and compares every non-volatile candidate file by path and SHA-256. `manifest.json`/`package.json` at any depth are reported as volatile and not compared (import legitimately rewrites history/versions). A read-back equal to the pre-deploy state is reported as "import not applied". `verify` is allowed from `deployed-unverified`, `unknown-outcome` and `verification-failed`.
- Connection references accept no credential-like keys (`token`, `password`, `secret`, `cookie`, `authorization`, ...) and no URLs with embedded credentials. Adapters receive only non-secret options.
- `cancel` authorizes the release owner, releases only a `prepared` attempt's lock and retains its history without calling the adapter. It cannot cancel a dispatched operation or resolve an unknown outcome.

## Implemented: local delivery UI

The `/releases` page uses `web/releases/delivery.js` and its pure `delivery-model.js` in both the service and synthetic Storybook fixtures. When the adapter is disabled, it explains that ELMA delivery is unavailable and leaves offline handoff usable. If the operator enabled the synthetic adapter, it shows the training label, explicit stand selection/identity probe, frozen candidate hash/revision, separate typed confirmation, read-back action, discrepancy details and attempt history. A returned operation is visibly unverified until read-back. Stale preparation can be cancelled before starting a new one.

Confirmation uses a stable key derived from the attempt ID; the server retains its at-most-once guard. A lost/unreadable mutation response locks the page's actions until the owner refreshes the release and reconciles the stored attempt; it never blindly retries. If delivery state loading fails, its controls remain absent until a successful retry. Unknown outcomes offer read-back, not another confirmation. These controls do not introduce a live adapter, credentials, ELMA checks or deployment authorization.

## Not implemented / limitations
- **No live adapter exists.** The only adapter is `synthetic` (deterministic scenarios: apply, unapplied, fail, timeout, drift). A hosted service refuses to create connections unless `DELIVERY_SYNTHETIC_ADAPTER=1`, so no hosted release can be verified against a fake target. The first real non-production path (DEV export → dev2 import → re-export) still needs an approved bridge that keeps `elma365pm`/tokens outside the Wiki process; see the connections contract and the ROADMAP.
- Comparison is by expanded file hash, not by ELMA semantics; descriptor/runtime/version comparison for the supported widget path comes with the bridge.
- One service process; the lock is per release, not a distributed job queue. Interrupted operations are reconciled lazily to `unknown-outcome` on the next read.
- Rollback reference is the pre-deploy inventory hash of the Target only; no package restore is performed.
- The real Source/Target journey in the workflow catalog remains proposed; the wired delivery screen and its 13 Storybook states cover only the implemented synthetic path.

## Evidence
`node --test test/delivery.test.mjs`: complete prepare/confirm/verify path with linked evidence; success-but-unapplied import never verified; PROD by environment and by actual identity refused; stale approval and drift block confirmation; duplicate confirmations run the operation once; timeout and restart produce `unknown-outcome` that only read-back resolves; credential-like fields refused; owner isolation; API gating of the synthetic adapter. Synthetic only — no live Target was touched.

`test/delivery-model.test.mjs` checks available actions for unavailable, pending, uncertain and stale attempts. `npm run test:delivery:browser` exercises the authenticated local screen: stand creation/probe, exact confirmation, read-back, unapplied import, evidence invalidation, cancellation, lost-response reconciliation, failed-load retry, keyboard and mobile layouts. Test storage, cookies and browser state are temporary and removed. Storybook uses the same renderer and ViewModel; its state examples do not execute operations.

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

## Implemented: delivery foundation (AR-04, synthetic Target only)

`lib/delivery.mjs` implements attempts behind the adapter interface from the [connections contract](source-target-connections.md). API: `/api/connections` (owner-scoped references, read-only `probe`), `GET/POST /api/releases/:id/delivery` with actions `prepare`, `confirm`, `verify`, `cancel`. Authenticated GET `/api/delivery/capabilities` reports `synthetic` or `unavailable`, with `liveDelivery: false`. Every route authorizes the owner first; connections and attempts live in `.local/delivery/`, private file modes, outside Git.

Attempt states: `prepared -> deploying -> deployed-unverified -> verified | verification-failed`, plus `failed` (adapter error), `unknown-outcome` (timeout or service restart during `deploying`), `blocked` (identity or target state changed after preparation), and `cancelled` (owner cancelled preparation before dispatch). Only a matching read-back produces `verified`. The release's `target` check is `pass` only for a verified attempt bound to its current revision, candidate ID/hash and acceptance. Changing conditions or the candidate makes historical evidence `stale`, including in mutation responses. Synthetic results are training evidence, not ELMA delivery.

Guards enforced server-side:
- `prepare` requires current acceptance and the frozen candidate, a target-role connection, a reachable Target with confirmed identity, deploy/read-back capabilities and no active attempt for this release. It records identity and the pre-deploy solution inventory hash.
- `environment: prod` is refused (403). A probed host in `PROTECTED_TARGET_HOSTS` is refused regardless of its name.
- `confirm` requires `DEPLOY <solution code> <first 12 hex of candidate SHA-256>` and an idempotency key. It checks release revision, candidate ID/hash and acceptance, then re-probes health/identity and re-inspects the Target. Unhealthy/changed identity or drift blocks dispatch. `deploying` is persisted before the adapter is called. Repeating the same key returns the existing attempt; another key on a non-prepared attempt is 409. At most one dispatch per attempt.
- `verify` requires the exact approved candidate and matching byte hash. It probes healthy, unchanged identity before and after read-back and rechecks candidate/revision/acceptance after the asynchronous operation. Invalid responses or changed identity/revision persist `verification-failed` with no passing comparison. It is allowed from `deployed-unverified`, `unknown-outcome` and `verification-failed`.
- `cancel` authorizes the release owner, releases only a prepared attempt's lock and retains history without calling the adapter. It cannot cancel a dispatched operation or resolve an unknown outcome.
- Connections reject credential-like keys and URLs with embedded credentials. Adapters receive non-secret options only.

## Exact read-back policy

`lib/delivery-verification.mjs` owns `exact-solution-inventory-v1`. Both inventories must contain unique, non-empty relative paths and full lowercase SHA-256 digests. Invalid arrays, unsafe/duplicate paths and malformed hashes are rejected before comparison. Fingerprints sort validated rows without changing input arrays; row ordering alone is not drift.

Compare the entire declared solution inventory in both directions. Missing, changed and unexpected files fail verification. `package.json` and every `manifest.json` are included; no filename-based volatility exemption exists. At least one file must be compared. The compatibility `volatile` field is always empty; comparison evidence includes `policy`, `match`, `compared`, `missing`, `different` and `unexpected`.

A mismatching read-back equal to the pre-deploy inventory is reported as import not applied. Equality proves the scoped state at observation time, not that an import caused it. A prior verified record without the current policy/match is lazily persisted as `verification-failed`, retaining its history/evidence and requiring fresh read-back, not redispatch.

This strict policy is intentionally conservative. A live adapter must define and demonstrate versioned expected-outcome rules for legitimate import transformations and native update/preserve behavior. Do not suppress entire metadata files to accommodate unknown transformations. Exact inventory equality is not a runtime business-scenario test or proof of recovery capability.

## Implemented: local delivery UI

The `/releases` page uses `web/releases/delivery.js` and its pure `delivery-model.js` in both the service and synthetic Storybook fixtures. Disabled delivery leaves offline handoff usable. Explicitly enabled synthetic mode shows training labels, stand selection/probe, candidate hash/revision, separate typed confirmation, read-back, missing/changed/unexpected files, policy, verification errors and history. A returned operation stays visibly unverified. Stale preparation can be cancelled before preparing again. Protected-target warnings, scenario selection and connection removal remain available from the integrated UI.

Confirmation uses a stable attempt-specific key. A lost or unreadable mutation response locks actions until the owner refreshes the release and reconciles the stored attempt. Failed loading removes controls until successful retry. Unknown outcomes offer read-back, not another confirmation. Focus remains in the delivery section after actions/refreshes. No UI control creates live-adapter permission.

## Limitations
- No live adapter exists. Only synthetic scenarios (apply, unapplied, fail, timeout, drift) are shipped, disabled by default unless `DELIVERY_SYNTHETIC_ADAPTER=1`. Enabling them never proves an ELMA operation. The first real non-production path requires an approved bridge that keeps CLI credentials outside Wiki.
- One service process; active-attempt protection is per release, not a distributed or target-wide queue. Restart reconciliation is lazy on the next read.
- Rollback reference is the pre-deploy inventory hash only; no package/data/process restore is performed.
- The real Source/Target journey remains proposed; the 14 current delivery Storybook states cover the synthetic path only, including protected Target refusal.

## Verification commands and scope

`node --test test/delivery-verification.test.mjs test/delivery.test.mjs test/delivery-model.test.mjs test/delivery-integration.test.mjs` covers exact inventory, invalid/duplicate/extra files, target health/identity continuity, concurrent release edits, durable legacy-policy invalidation, stale release/UI evidence, preparation cancellation, capability API authentication, owner isolation, idempotency, restart and timeout handling.

`npm run test:releases:browser` covers offline review/handoff and unavailable delivery. `npm run test:delivery:browser` covers the authenticated synthetic screen, identity/probe, confirmation, exact policy, unapplied import, stale evidence, cancellation, lost-response reconciliation, loading retry, focus, protected-target refusal, connection removal and mobile layout. Extra-file and verification-error display checks use explicitly injected persisted synthetic evidence; actual comparator rejection is covered by the archive/store tests. Storybook uses the production renderer, with missing/changed/unexpected evidence represented truthfully.

Passing these checks is not a live ELMA, TEST or PROD deployment result. Record executed CI results for the exact integration commit separately.

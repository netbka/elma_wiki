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
- `confirm` requires the literal confirmation `DEPLOY <solution code> <first 12 hex of candidate SHA-256>` and an idempotency key. It re-checks that release revision, candidate ID/hash and approval are unchanged, re-probes identity and re-inspects the Target; an unhealthy probe, drift or identity change marks the attempt `blocked`. The `deploying` state is persisted before the adapter is called. Repeating the same key returns the existing attempt; a different key on a non-prepared attempt is 409. The adapter is called at most once per attempt.
- `verify` checks the exact candidate ID/hash, release revision and approval, including actual candidate bytes. It re-probes healthy Target identity before and after read-back and rechecks release inputs after the adapter returns. It compares the complete solution inventory under `exact-solution-inventory-v1`, including every `package.json` and `manifest.json`. Missing, changed or unexpected files fail verification; malformed or duplicate entries are rejected. A mismatching read-back equal to the pre-deploy state is reported as "import not applied". `verify` is allowed from `deployed-unverified`, `unknown-outcome` and `verification-failed`.
- Connection references accept no credential-like keys (`token`, `password`, `secret`, `cookie`, `authorization`, ...) and no URLs with embedded credentials. Adapters receive only non-secret options.

## Exact inventory evidence policy

`lib/delivery-verification.mjs` owns `exact-solution-inventory-v1`. An inventory contains at most 25,000 unique relative file paths (1-4,096 characters) with lowercase 64-character hexadecimal SHA-256 values. Empty segments, dot segments, absolute/drive paths, backslashes and control characters are rejected, not normalized. Paths retain case and Unicode distinctions. Hashes and comparison results use a locale-independent sorted copy; adapter ordering does not imply drift and caller arrays are not mutated.

A nonempty inventory must match exactly in both directions. The compatibility `volatile` field remains an empty array; no filename is exempt. This is a byte-level comparison of a declared complete solution scope, not proof of ELMA behavior. Real import transformations or preserved components need a separate versioned and tested expected-outcome policy before enablement; do not restore broad exclusions to make live imports pass.

Evidence records the policy and re-probed Target identity. A failed health/identity check, invalid inventory or release change during read-back persists `verification-failed` with no passing comparison. A previously `verified` record without the current policy (or with a non-passing comparison) is lazily downgraded to `verification-failed` on get/list/summary, retaining prior evidence and history. A fresh read-back can verify it without repeating the import. Legacy pre-deploy fingerprints may safely block confirmation after the ordering-policy change; prepare a fresh attempt rather than suppressing a drift warning.

## Not implemented / limitations
- **No live adapter exists.** The only adapter is `synthetic` (deterministic scenarios: apply, unapplied, fail, timeout, drift). A hosted service refuses to create connections unless `DELIVERY_SYNTHETIC_ADAPTER=1`, so no hosted release can be verified against a fake target. The first real non-production path (DEV export → dev2 import → re-export) still needs an approved bridge that keeps `elma365pm`/tokens outside the Wiki process; see the connections contract and the ROADMAP.
- Strict complete-solution file comparison is not ELMA semantic/runtime verification. Native version/history normalization and approved update/preserve plans are not implemented; real-adapter support must prove these explicitly.
- One service process; the lock is per release, not a distributed job queue. Interrupted operations are reconciled lazily to `unknown-outcome` on the next read.
- Rollback reference is the pre-deploy inventory hash of the Target only; no package restore is performed.
- No UI yet: the release page does not expose connections or delivery actions; Storybook keeps the `source-target` journey as proposed.

## Evidence
`node --test test/delivery.test.mjs`: complete prepare/confirm/verify path with linked evidence; success-but-unapplied import never verified; PROD by environment and by actual identity refused; stale approval and drift block confirmation; duplicate confirmations run the operation once; timeout and restart produce `unknown-outcome` that only read-back resolves; credential-like fields refused; owner isolation; API gating of the synthetic adapter. Synthetic only — no live Target was touched.

Focused regressions: `node --test test/delivery-verification.test.mjs test/delivery.test.mjs` covers exact metadata, unexpected and duplicate files, malformed inventory, ordering stability, Target identity changing before/during read-back, unhealthy confirmation, revision change during read-back, and legacy evidence invalidation. These are synthetic tests, not a live import or recovery rehearsal. Existing delivery UI states are reused; this change adds no UI or connection capability.

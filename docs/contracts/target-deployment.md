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

## Implemented: operator bridge adapter (AR-04, part 3)

The live path keeps the Wiki free of ELMA credentials and outbound connections: an operator runs `elma-dev bridge --target=<dev|test>` (repo `elma-development/commands/bridge.mjs`) on the machine that already has `elma365pm` and the ELMA tokens in `.env`; the worker polls the Wiki and executes jobs.

- `lib/bridge.mjs`: owner-scoped bridges (`POST /api/bridges` issues a `wb_…` token **once**; only its SHA-256 is stored, listing never returns it; max 10 per owner), a file-backed job queue per bridge (`.local/delivery/bridges/`), worker routes authenticated by `Authorization: Bearer <token>` with constant-time hash comparison: `POST /api/bridge/poll` (long-poll ≤ 25 s, records `lastSeen`, reported host/version and worker label), `GET /api/bridge/jobs/:id/artifact` (candidate bytes, only while the job is taken, hash re-checked), `POST /api/bridge/jobs/:id/result`. Removing a bridge invalidates its token and rejects queued jobs. A browser session cannot call worker routes; a worker token cannot call owner routes.
- Adapter `bridge` (always registered; option `bridgeId`, owner checked on every call): `health` is `ok:false` when the bridge has not polled within 90 s or does not answer a health job in 30 s; `inspectSolution`/`readBack` → job `inspect`/`readBack` (worker: `elma365pm export solution --allow-deps` into a temp dir, hashed inventory of the directory walk — the same `<service>/<path>` layout the Wiki derives from an `.e365`); `deployCandidate` → job `deploy` with the approved `.e365` as artifact (worker: SHA-256 check, `elma365pm unpack`, package code must equal the job's code, `elma365pm import --version-up`). Jobs carry only the solution code and the hash; identity comes from the worker's configured host, so a worker pointed at a protected host is refused by the existing identity guard.
- Long operations: `confirm` persists `deploying`, hands the operation to the adapter outside the per-release lock and answers within a 2 s grace period — with the final state if the operation finished, otherwise with `deploying`; the attempt is completed in the background and the UI offers «Обновить состояние доставки». Read-only calls (`inspect`, `readBack`) fail with 504 on timeout; the deploy timeout still yields `unknown-outcome`. `DELIVERY_TIMEOUT_MS` (default 20 min) bounds every adapter call.
- Worker-side refusals independent of the Wiki: target `prod` is not accepted at all; `WIKI_BRIDGE_PROTECTED_HOSTS` refuses deploy; an artifact whose hash or package code does not match is not imported. Env on the operator machine: `WIKI_BRIDGE_URL`, `WIKI_BRIDGE_TOKEN`, optional `WIKI_BRIDGE_CA` (private CA PEM).

## Not implemented / limitations
- **No live delivery has run yet.** The bridge was exercised against a local Wiki with a real worker pointed at dev2 for read-only jobs (health, inspect of an installed solution: 51 files in 8 s). The first live deploy needs the owner to designate the non-production Target (dev2 proposed) and a solution/candidate for it; `elma365pm import` limitations apply (`directory required` for widget-script changes, silent skip without a new `history` entry — the latter is caught by read-back as "import not applied").
- The `synthetic` adapter remains for tests/Storybook only (`DELIVERY_SYNTHETIC_ADAPTER=1`).
- Comparison is by expanded file hash, not by ELMA semantics; descriptor/runtime/version comparison for the supported widget path is still open.
- One service process; the lock is per release and the bridge queue is per bridge on local files, not a distributed job queue. Interrupted operations are reconciled lazily to `unknown-outcome` on the next read; a worker restart mid-job leaves the job `taken` until the Wiki-side timeout.
- A bridge token is a bearer secret for the operator machine: it can read candidate artifacts of jobs addressed to it and report results, nothing else. Rotate by removing the bridge and issuing a new one.
- Rollback reference is the pre-deploy inventory hash of the Target only; no package restore is performed.
- UI: the release page shows a «Доставка на Target» section (operator bridges with one-time token display, connections without credentials, read-only probe, prepare, literal confirmation, read-back, evidence and attempt log) once the current candidate is accepted. Without a configured adapter the section states the service limitation and keeps the private handoff bundle as the only path. Ten Storybook states (`Аналитик/Доставка на Target`, incl. bridge offline and a deploy in progress) mount the production renderer; the `source-target` journey in `/flows` remains proposed until a live delivery has been verified.

## Evidence
`npm run test:releases:browser` drives the real authenticated UI: wrong confirmation rejected, an "unapplied" synthetic import ends as «Read-back не совпал» with the release's target check failed, and an applying target ends as «Проверено read-back» only after the read-back. `node --test test/delivery.test.mjs`: complete prepare/confirm/verify path with linked evidence; success-but-unapplied import never verified; PROD by environment and by actual identity refused; stale approval and drift block confirmation; duplicate confirmations run the operation once; timeout and restart produce `unknown-outcome` that only read-back resolves; credential-like fields refused; owner isolation; API gating of the synthetic adapter. `node --test test/bridge.test.mjs`: token issued once and stored hashed, end-to-end delivery through a polling worker stand-in, slow import answered as `deploying` and finished in the background, unapplied import never verified, worker error → `failed`, owner isolation, PROD identity refusal, timeouts without a worker, bearer/session separation on the routes. Live: health + inspect jobs executed by the real worker against dev2 (read-only); no deploy has run.

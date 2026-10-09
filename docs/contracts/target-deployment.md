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

## Implemented: delivery foundation (AR-04)

The same delivery engine reads legacy releases and explicitly paired shared
Solution handoffs. Shared IDs do not resolve through
`/api/releases/:id/delivery`; use the contextual route described below. A shared
candidate is never copied into the legacy root. See the [Lane B evidence and pilot gates](../audits/lane-b-elma-evidence-2026-10-08.md).

### Contextual unchanged-original delivery API

`GET/POST /api/solutions/:solutionId/handoffs/:handoffId/delivery` uses the
existing actions `prepare`, `confirm`, `verify`, `cancel`. The server verifies
the exact Solution/handoff pair and chooses its guarded candidate store. It
rejects client-supplied actor, owner, namespace, bytes or association fields.
Connections and attempts remain scoped to the authenticated execution actor;
shared content access does not grant another actor's connection or attempt.
New attempt evidence records that actor ID and the pinned accepted-full/review
association, independently of original upload/native authorship.

One deliveryStore instance owns both facades, adapter instances and its serial
queue. Legacy attempts retain `delivery/attempts/:releaseId/`; contextual attempts
use `delivery/attempts/solutions/:handoffId/`. Equal IDs cannot cross roots.
Target reservation scans both namespaces, including unresolved records after
restart. No second coordinator or connection catalog is introduced.

Lock order is delivery -> Solution -> release. After awaited preparation probes,
confirmation identity/drift inspection or read-back/final identity inspection,
the trusted candidate callback rechecks the current association, approval,
revision and exact hash while persisting the final transition. Dispatch starts
once inside this guard after durable `deploying`, then the guard/queue releases
without waiting for the native operation. A concurrent mutation during native
work cannot undo dispatch; its operation evidence remains historical and cannot
be verified against a stale candidate. Callbacks never reacquire these queues.
Atomic attempt renames retry bounded `EPERM`/`EBUSY` sharing failures without
retrying any adapter operation.

Contextual reads retain historical state/evidence and explicitly return
`candidateStatus` and `verificationCurrent`. A later review comment, finding,
archive, revision or release edit makes the current verification false even if
the historical attempt once matched. Stale preparations remain cancellable;
unknown outcomes require read-back without redispatch. Matching whole-inventory
read-back is scoped Target-state evidence, not native business-flow acceptance.

This API handles exact unchanged accepted originals. Composed MR-06 candidates,
UI dispatch controls and live/native acceptance remain separate work. Existing
Target selection, typed confirmation, PROD refusal and native pilot gates remain
required; offline approval alone does not authorize an import.

`lib/delivery.mjs` implements attempts behind the adapter interface from the [connections contract](source-target-connections.md). API: `/api/connections` (owner-scoped references, read-only `probe`), `GET/POST /api/releases/:id/delivery` with actions `prepare`, `confirm`, `verify`, `cancel`. Authenticated GET `/api/delivery/capabilities` reports `mode` (`synthetic` or `bridge`), `bridge: true` (the operator-bridge adapter is registered) and the adapter list; `liveDelivery` stays `false` until a live delivery has been verified. Every route authorizes the owner first; connections and attempts live in `.local/delivery/`, private file modes, outside Git.

Attempt states: `prepared -> deploying -> deployed-unverified -> verified | verification-failed`, plus `failed` (adapter error), `unknown-outcome` (timeout or service restart during `deploying`), `blocked` (identity or target state changed after preparation), and `cancelled` (owner cancelled preparation before dispatch). Only a matching read-back produces `verified`. The release's `target` check is `pass` only for a verified attempt bound to its current revision, candidate ID/hash and acceptance. Changing conditions or the candidate makes historical evidence `stale`, including in mutation responses. Synthetic results are training evidence, not ELMA delivery.

Guards enforced server-side:
- `prepare` requires current acceptance and the frozen candidate, a target-role connection, a reachable Target with confirmed identity, deploy/read-back capabilities and no active attempt for this release. It records identity and the pre-deploy solution inventory hash.
- `environment: prod` is refused (403). A probed host in `PROTECTED_TARGET_HOSTS` is refused regardless of its name.
- `confirm` requires `DEPLOY <solution code> <first 12 hex of candidate SHA-256>` and an idempotency key. It checks release revision, candidate ID/hash and acceptance, then re-probes health/identity and re-inspects the Target. Unhealthy/changed identity or drift blocks dispatch. `deploying` is persisted before the adapter is called. Repeating the same key returns the existing attempt; another key on a non-prepared attempt is 409. At most one dispatch per attempt.
- `verify` requires the exact approved candidate and matching byte hash. It probes healthy, unchanged identity before and after read-back and rechecks candidate/revision/acceptance after the asynchronous operation. Invalid responses or changed identity/revision persist `verification-failed` with no passing comparison. It is allowed from `deployed-unverified`, `unknown-outcome` and `verification-failed`.
- `cancel` authorizes the release owner, releases only a prepared attempt's lock and retains history without calling the adapter. It cannot cancel a dispatched operation or resolve an unknown outcome.
- Connections reject credential-like keys and URLs with embedded credentials. Adapters receive non-secret options only.

## Implemented: operator bridge adapter

The live path keeps the Wiki free of ELMA credentials and outbound connections: an operator runs `elma-dev bridge --target=<dev|test>` (repo `elma-development/commands/bridge.mjs`) on the machine that already has `elma365pm` and the ELMA tokens in `.env`; the worker polls the Wiki and executes jobs.

- `lib/bridge.mjs`: owner-scoped bridges (`POST /api/bridges` issues a `wb_…` token **once**; only its SHA-256 is stored, listing never returns it; max 10 per owner), a file-backed job queue per bridge (`.local/delivery/bridges/`), worker routes authenticated by `Authorization: Bearer <token>` with constant-time hash comparison: `POST /api/bridge/poll` (long-poll ≤ 25 s, records `lastSeen`, reported host/version and worker label), `GET /api/bridge/jobs/:id/artifact` (candidate bytes, only while the job is taken, hash re-checked), `POST /api/bridge/jobs/:id/result`. Removing a bridge invalidates its token and rejects queued jobs. A browser session cannot call worker routes; a worker token cannot call owner routes.
- Adapter `bridge` (always registered; option `bridgeId`, owner checked on every call): `health` is `ok:false` when the bridge has not polled within 90 s or does not answer a health job in 30 s; `inspectSolution`/`readBack` → job `inspect`/`readBack`. The worker exports with `elma365pm export solution --allow-deps` into a private temporary source directory, packs to an archive outside that source, and hashes every packed entry with one service-ZIP expansion level. Package/service metadata and unknown files stay included; directory exports are a different representation and must not be compared directly with the candidate archive. The bounded standard-library reader requires Python 3 (`ELMA_PYTHON` may select the executable). `deployCandidate` → job `deploy` with the approved `.e365` as artifact (worker: SHA-256 check, `elma365pm unpack`, package code must equal the job's code, `elma365pm import --version-up`). Jobs carry only the solution code and the hash; identity comes from the worker's configured host, so a worker pointed at a protected host is refused by the existing identity guard.
- Long operations: `confirm` persists `deploying`, hands the operation to the adapter outside the per-release lock and answers within a 2 s grace period — with the final state if the operation finished, otherwise with `deploying`; the attempt is completed in the background and the UI offers «Обновить состояние доставки». Read-only calls (`inspect`, `readBack`) fail with 504 on timeout; the deploy timeout still yields `unknown-outcome`. `DELIVERY_TIMEOUT_MS` (default 20 min) bounds every adapter call.
- Worker-side refusals independent of the Wiki: target `prod` is not accepted at all; `WIKI_BRIDGE_PROTECTED_HOSTS` refuses deploy; an artifact whose hash or package code does not match is not imported. Env on the operator machine: `WIKI_BRIDGE_URL`, `WIKI_BRIDGE_TOKEN`, optional `WIKI_BRIDGE_CA` (private CA PEM).

Read-only preflight on 2026-10-08 verified the corrected worker's inventory
against Wiki's reader for all 48 files of one native dev2 solution package.
Two subsequent fresh worker exports matched each other exactly, including all
metadata. Earlier differences against an older capture overlapped another
session's fixture publications; they do not prove unchanged-target instability.
No import or delivery Verified result was produced. Candidate/import/export
metadata correspondence remains a live gate; do not exclude metadata to pass.
See [transport evidence](https://github.com/netbka/elma365/blob/main/docs/bridge-packed-readback-2026-10-08.md).

The legacy worker target `dev` resolves to dev2. The owner's shared business DEV
is a separate environment used with the partner company, which promotes that
work to PROD. dev2 is the owner's additional environment for technical work.
Select by task purpose, verify the actual host, and separately bind the approved
candidate to its Target. See [server roles](https://github.com/netbka/elma365/blob/main/docs/server-environments.md).

## Bridge dispatch cancellation and restart

A persisted job is not permission to dispatch. Polling and artifact reads require a live, unexpired request in the current service process. Abort fences an unclaimed job as `cancelled` and removes its candidate bytes before rejecting the waiter. An already claimed job becomes `unknown-outcome`: new artifact reads are denied, but an operator that already downloaded the artifact may still be running. A late result is retained with `lateCompletion: true`; it does not restore the expired request or verify a release.

After coordinator restart, old queued jobs are cancelled and claimed jobs become unknown on their next access. They are never replayed automatically. Reconcile an uncertain deployment through the existing Target read-back path. Removing a bridge still invalidates its token and settles its callers. The store requires one coordinator per directory; this is not a distributed lease or a guarantee that an external process stopped.

`node --test test/bridge-queue.test.mjs test/bridge.test.mjs test/delivery.test.mjs` checks normal dispatch, queued/claimed abort, pre-aborted input, removed bridges, restart, abort during queue/claim persistence and artifact reads, late completion and the existing delivery guards. All fixtures are synthetic; no ELMA import is performed.

## Exact read-back policy

`lib/delivery-verification.mjs` owns `exact-solution-inventory-v1`. Both inventories must contain unique, non-empty relative paths and full lowercase SHA-256 digests. Invalid arrays, unsafe/duplicate paths and malformed hashes are rejected before comparison. Fingerprints sort validated rows without changing input arrays; row ordering alone is not drift.

Compare the entire declared solution inventory in both directions. Missing, changed and unexpected files fail verification. `package.json` and every `manifest.json` are included; no filename-based volatility exemption exists. At least one file must be compared. The compatibility `volatile` field is always empty; comparison evidence includes `policy`, `match`, `compared`, `missing`, `different` and `unexpected`.

A mismatching read-back equal to the pre-deploy inventory is reported as import not applied. Equality proves the scoped state at observation time, not that an import caused it. A prior verified record without the current policy/match is lazily persisted as `verification-failed`, retaining its history/evidence and requiring fresh read-back, not redispatch.

This strict policy is intentionally conservative. A live adapter must define and demonstrate versioned expected-outcome rules for legitimate import transformations and native update/preserve behavior. Do not suppress entire metadata files to accommodate unknown transformations. Exact inventory equality is not a runtime business-scenario test or proof of recovery capability.

## Implemented: local delivery UI

The `/releases` page uses `web/releases/delivery.js` and its pure `delivery-model.js` in both the service and synthetic Storybook fixtures. Disabled delivery leaves offline handoff usable. Explicitly enabled synthetic mode shows training labels, stand selection/probe, candidate hash/revision, separate typed confirmation, read-back, missing/changed/unexpected files, policy, verification errors and history. A returned operation stays visibly unverified. Stale preparation can be cancelled before preparing again. Protected-target warnings, scenario selection and connection removal remain available from the integrated UI.

With the bridge adapter the same panel lists the owner's bridges (online/offline, reported host, worker label), issues a bridge token that is displayed exactly once, creates bridge-backed Target connections (TEST/DEV only) and relabels prepare/confirm as a Target delivery; a running operation offers refresh, not another confirmation. Confirmation uses a stable attempt-specific key. A lost or unreadable mutation response locks actions until the owner refreshes the release and reconciles the stored attempt. Failed loading removes controls until successful retry. Unknown outcomes offer read-back, not another confirmation. Focus remains in the delivery section after actions/refreshes. No UI control creates live-adapter permission.

## Limitations
- **No live delivery has run yet.** The operator bridge adapter exists (section above) and was exercised against a local Wiki with a real worker pointed at dev2 for read-only jobs only (health; inspect of an installed solution: 51 files in 8 s). The first live deploy needs the owner to designate the non-production Target (dev2 proposed) and a solution/candidate for it.
- **A real `elma365pm import --version-up` cannot pass `exact-solution-inventory-v1`.** The import appends a `history` entry to `package.json`/`manifest.json` and may rewrite dependency metadata, so the exact policy reports them as `different`; a read-back export with `--allow-deps` can also list dependency files as `unexpected` when the candidate was exported without them. This is by design of the strict policy: before a live delivery can become `verified`, the owner must approve a *versioned* normalization policy (what an import is allowed to change), and it must be implemented and tested next to the exact one — not by exempting whole files silently. Until then a live attempt ends as `verification-failed` with the exact discrepancies listed, which is the truthful result.
- Synthetic scenarios (apply, unapplied, fail, timeout, drift) stay disabled by default unless `DELIVERY_SYNTHETIC_ADAPTER=1`. Enabling them never proves an ELMA operation. `elma365pm import` limitations apply to the bridge path (`directory required` for widget-script changes; silent skip without a new `history` entry, which read-back reports as import not applied).
- A bridge token is a bearer secret for the operator machine: it can read candidate artifacts of jobs addressed to it and report results, nothing else. Rotate by removing the bridge and issuing a new one. A worker restart mid-job leaves the job `taken` until the Wiki-side timeout (`DELIVERY_TIMEOUT_MS`).
- One service process; the service queue reserves each observed Target host across releases, owners and connection aliases. Durable `prepared`, `deploying`, `deployed-unverified` and `unknown-outcome` attempts block another preparation on that host; case and a trailing DNS dot are normalized. Confirmation also rejects overlapping legacy preparations before dispatch. Reservation errors disclose no competing record or owner. Cancellation before dispatch or a terminal result releases the reservation. This is not a distributed lock and cannot protect a differently reported alias for the same host, external operators or another service process. Restart reconciliation is lazy on the next read; durable unresolved attempts still block preparation before that read.
- Rollback reference is the pre-deploy inventory hash only; no package/data/process restore is performed.
- The real Source/Target journey remains proposed; the 17 current delivery Storybook states cover the synthetic path (including protected Target refusal) and the bridge panel (no bridge yet, bridge offline, deploy in progress).

## Verification commands and scope

`node --test test/bridge.test.mjs` covers the bridge: token issued once and stored hashed, end-to-end delivery through a polling worker stand-in, slow import answered as `deploying` and finished in the background, unapplied import never verified, worker error → `failed`, owner isolation, PROD identity refusal, timeouts without a worker, bearer/session separation on the routes. `node --test test/delivery-verification.test.mjs test/delivery.test.mjs test/delivery-model.test.mjs test/delivery-integration.test.mjs` covers exact inventory, invalid/duplicate/extra files, target health/identity continuity, concurrent release edits, durable legacy-policy invalidation, stale release/UI evidence, preparation cancellation, capability API authentication, owner isolation, idempotency, restart and timeout handling.

`npm run test:releases:browser` covers offline review/handoff and the bridge-only panel (token issued once and hidden after the next action, bridge-backed connection, honest probe without a worker, bridge removal). `npm run test:delivery:browser` covers the authenticated synthetic screen, identity/probe, confirmation, exact policy, unapplied import, stale evidence, cancellation, lost-response reconciliation, loading retry, focus, protected-target refusal, connection removal and mobile layout. Extra-file and verification-error display checks use explicitly injected persisted synthetic evidence; actual comparator rejection is covered by the archive/store tests. Storybook uses the production renderer, with missing/changed/unexpected evidence represented truthfully.

Passing these checks is not a live ELMA, TEST or PROD deployment result. Record executed CI results for the exact integration commit separately.

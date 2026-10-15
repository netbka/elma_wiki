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

This API handles exact unchanged accepted originals. The Solution handoff now
uses the existing delivery renderer with this contextual client, actor-owned
connections, typed confirmation, read-back and response-loss recovery. It
projects `candidateStatus` and `verificationCurrent` into the Target check and
history; a historical match never passes the current check after invalidation.
Composed MR-06 candidates use the separate guarded namespace below; live/native acceptance remains separate work. Existing
Target selection, typed confirmation, PROD refusal and native pilot gates remain
required; offline approval alone does not authorize an import.

### Composed candidates through the same coordinator (PLAN-01 P7, MR-06)

`lib/composed-candidates.mjs` stores frozen composed candidates in the shared
root (`shared-solutions/composed-candidates/:id/`, private file modes). There is
no second coordinator, connection catalog or dispatch path. The existing
`deliveryStore` resolves a third server-constructed reference namespace,
`{namespace: 'composed', solutionId, id}`. Its attempts live in
`delivery/attempts/composed/:candidateId/`. Equal UUIDs never resolve across
the legacy, shared-original and composed roots. Host reservations scan all
three roots, including unresolved records after restart.

- **Freeze** (`freeze`, trusted server code only, no HTTP route). The input is
  one P6 `materializeNative` result plus the P4 coverage, P5 dependency
  evidence, compiler lock and Target profile it was built from. The store
  re-derives the materialization request from the current Solution state and
  its stored originals. It requires `materializationStatus(manifest, request) ===
  'current'`, a `materialized` manifest with no blockers other than
  `synthetic-evidence-only`, and output bytes equal to the manifest sha256. The
  dependency profile must equal the Target profile, and every selected native
  unit needs an import position. An `unavailable` (unpinned) build, tampered
  bytes or manifest, a relocked compiler, another profile, or a later resolution
  or review event is refused with 409.
- **Binding.** The candidate binds the Solution revision, change artifact,
  resolution id, revision, result and plan digests, review-event digest, P6
  request, inputs and manifest digests, coverage and dependency plan digests and
  Target profile digest. It also records units in native import order, the
  Target profile `{digest, platformVersion}`, compiler lock, adapter,
  `evidenceBasis` and `releaseEligible`. Content provenance is kept separately:
  each original's uploader and the resolution actor. `frozenBy` and the
  `approval` actor are kept too, and the delivery `executionActorId` is
  separate again.
- **Review.** `POST /api/solutions/:id/composed/:candidateId` with
  `{action: approve | revoke, revision, reason}` approves or revokes the exact
  frozen bytes for the authenticated actor. Approval is review acceptance, not a
  deployment permission. `GET /api/solutions/:id/composed[/:candidateId]` shows
  `inputsStatus` (`current | stale`) and `deliverable`.
- **Stale inputs.** `withCandidate` holds the Solution queue through
  `managed.withResolvedInputs` and then the candidate queue. Lock order is
  delivery → Solution → candidate. A new resolution, a review comment or
  finding, an archived Solution, an accepted or replaced change or a revoked
  approval fails the final guarded write of prepare, confirm and verify with
  409. Historical attempts then report `candidateStatus: stale` and
  `verificationCurrent: false`.
- **Eligibility guards at prepare.** A candidate without `evidenceBasis:
  native` and `releaseEligible: true` reaches only a `synthetic` training
  adapter; today every candidate is synthetic because P6 output stays
  non-native until P8. The observed Target `version` must equal the bound
  profile platform. A candidate with more than one unit requires an adapter
  with `unitReceipts: true`; the operator bridge does not report receipts, so
  it is refused. The existing PROD refusal, protected hosts, typed confirmation,
  drift and identity checks apply unchanged.
- **Dispatch and receipts.** `deploying` is persisted before the adapter
  receives `{bytes, sha256, code, units}`. Per-unit evidence starts `pending`
  (not started) at prepare and is persisted as `dispatched` together with
  `deploying`, before the adapter call. It records only what the adapter reports (`applied | failed | skipped`);
  anything else is `unreported`. The outcome is:
  - all applied → `deployed-unverified`;
  - all unreported → `unknown-outcome`;
  - none applied and none unreported → `failed`, or `deployed-unverified` when
    every unit was only skipped;
  - any other mix → the new `partial-outcome` state.

  An adapter error without receipts on a multi-unit candidate is
  `unknown-outcome`, not `failed`, because an earlier unit may have applied;
  on a single-unit candidate the only unit is recorded `failed` with the
  attempt. A timeout is always `unknown-outcome` with every unreported unit
  `unreported` (or `partial-outcome` when receipts show some units applied);
  no unit ever keeps `pending` or `dispatched` once the operation has ended.
  `partial-outcome` holds the Target reservation and allows only read-back. It
  cannot be confirmed again or cancelled. A read-back that fails before the
  same Target is observed (adapter or health error, invalid response, changed
  identity) records `verificationError` but keeps `deployed-unverified`,
  `unknown-outcome` or `partial-outcome` and its reservation; only an observed
  read-back moves the attempt to `verified` or `verification-failed`. A restart turns `deploying` into
  `unknown-outcome` with pending or dispatched units `unreported`. No outcome is ever
  redispatched. The same idempotency key replays the stored attempt; another
  key is refused. Only a matching whole-inventory read-back yields `verified`.
- **API.** `GET/POST /api/solutions/:id/composed/:candidateId/delivery` accepts
  exactly the same actions and keys as the shared-original route. Forged
  owner, actor, namespace, bytes, units or Solution fields are rejected with
  400.

The delivery renderer shows the `partial-outcome` state and the per-unit
receipts in import order (Storybook `delivery--partial-outcome`). No Solution
composer screen exists yet, and no live, native or business result is claimed:
`node --test test/composed-delivery.test.mjs` uses synthetic archives, the
synthetic P6 assembler and the synthetic Target adapter only. The native
release eligibility of a composed candidate remains blocked on the open P8 gate
(netbka/elma365#60).

### Promotion, recovery and evidence packets (MR-08)

The same `deliveryStore`, queue, reservations and guards handle promotion and
recovery for every namespace (legacy, shared original, composed). There is no
second coordinator. All evidence is synthetic: `node --test
test/delivery-promotion.test.mjs test/composed-delivery.test.mjs` uses fictional
hosts and the synthetic adapter only. No live, native, PROD or business result
is claimed, and no UI control exists yet for these actions.

- **Promotion** (`promote`, keys `attemptId`, `connectionId`, `revision`,
  `idempotencyKey`). The source attempt must be `verified` under its recorded
  policy, bound to the current candidate (revision, candidate ID, SHA-256,
  approval and, for contextual roots, the review association), and on a
  non-production connection. The destination is another connection whose
  observed host differs from the source host and whose platform `version`
  equals the source Target version (composed candidates also keep the bound
  profile guard). The destination is inspected fresh. Its inventory must equal
  the state the source evidence was verified from (`preDeploy` of the source).
  A destination already holding the candidate is refused (read it back instead),
  and any other difference is drift and blocks before an attempt exists. The new
  attempt records `promotion` (source attempt, connection, identity, verified
  pre/read-back hashes, policy, verification time and the source packet digest)
  and follows the normal path: typed `DEPLOY` confirmation, fresh drift check,
  durable `deploying`, dispatch once, read-back. At confirmation the source
  attempt is re-read; if it is no longer verified and current, the promotion is
  `blocked` without dispatch. The same idempotency key with the same
  destination replays the stored promotion; the same key for another
  destination is a 409 conflict, and another key while it is unresolved is
  refused by the existing one-active-attempt rule.
- **Reconciliation.** Every observed read-back records
  `evidence.reconciliation = {outcome, fromState, readBackInventoryHash}`:
  `applied` (matching comparison), `not-applied` (read-back equals the
  pre-deploy inventory and no unit receipt reported `applied`) or `diverged`
  (anything else, including an applied receipt over an unchanged inventory). A
  read that fails before observing the Target keeps the previous state and
  reconciliation. `verify` is also allowed from `failed`, because an adapter
  error never proves that nothing applied; an unobserved failure keeps
  `failed`, and an observed read-back moves it to `verified` or
  `verification-failed`. Unknown and partial outcomes are never success.
- **Unreconciled outcomes reserve the Target.** Besides the active states, a
  `failed` attempt and a `verification-failed` attempt with a `diverged`
  reconciliation (and no retry) hold the host reservation and the
  one-unresolved-attempt-per-release rule. A fresh `prepare` on that host, from
  any release, owner or connection alias, is refused until a read-back
  reconciles `failed` as `applied`/`not-applied`, or a gated forward-recovery
  retry takes over the diverged attempt; a later read-back that shows the
  previous state also releases it. The release UI follows: after `failed` it
  offers read-back, not a new preparation, and a diverged read-back shows the
  partial install (Storybook `delivery--partial-install`).
- **No borrowed evidence.** A read-back observes the Target now, so `verify`
  is refused (409, state unchanged) for an attempt that has a retry, or when
  another attempt on the same host was dispatched at or after this attempt's
  creation. An earlier attempt never becomes `verified` from a later import.
- **Retry and recovery** (`retry`, keys `attemptId`, `idempotencyKey`). Allowed
  only from `verification-failed` with a reconciliation and a still current
  candidate. `not-applied` gives a `retry`; `diverged` (partial install) gives a
  `forward-recovery` only when the adapter declares `capabilities.reimport ===
  'idempotent'`. No live adapter declares it, so a partial install on a live
  Target is refused and needs a recovery plan. Unreconciled (`unknown-outcome`,
  `partial-outcome`, `deployed-unverified`, `failed`), verified, never-dispatched
  (`prepared`, `blocked`, `cancelled`) and stale-candidate attempts are refused.
  The retry runs on the same connection, requires an identical observed
  identity, and the fresh inspection must equal the reconciled read-back hash
  (a change since reconciliation is drift). It creates a new `prepared` attempt
  with `retryOf` and carries the original `promotion`; it still requires its own
  typed confirmation. The source records `retriedBy`; the same key returns that
  retry and another key is refused, so one reconciled attempt yields at most one
  retry. Nothing is redispatched automatically.
- **Evidence packet** (`GET …/delivery?packet=<attemptId>`, owner-scoped).
  `delivery-evidence-packet-v1` contains the exact `inputs` (reference,
  revision, candidate ID and SHA-256, candidate inventory hash, review
  association digest, composed units and Target profile) with `inputsDigest`;
  the destination `environmentProfile` (connection, observed identity and host,
  platform version, capabilities, read-back policy) with `environmentDigest`;
  pre-deploy, operation, unit, read-back, comparison, reconciliation and
  rollback evidence; promotion and retry lineage; the outcome with
  `candidateStatus` and `verificationCurrent`; `evidenceBasis` (`synthetic` or
  `adapter-reported`) and `notEstablished` (always `native-business-acceptance`,
  plus `live-delivery` for synthetic evidence); and `packetDigest` over the
  key-sorted packet. Two destinations of one candidate share `inputsDigest` and
  differ in `environmentDigest`.
- **PROD stays protected.** A direct preparation on an `environment: prod`
  connection is refused (403) as before. A promotion to PROD needs a grant that
  only trusted code can pass to `deliveryStore({productionPromotions})`: an owner
  record `{authorizationRef, sha256, connectionId, host, expiresAt}` bound to the
  exact candidate, connection, observed host and an expiry. `server.mjs`
  constructs no grants, so PROD is refused by default and over HTTP. With a
  grant, confirmation additionally requires `productionConfirmation: "PROMOTE
  PROD <code> <first 12 hex of SHA-256> <host>"`, which no HTTP route accepts:
  the legacy, Solution handoff and composed delivery routes all allowlist
  request keys per action and answer 400 otherwise. The grant is re-evaluated at confirmation and read-back (an expired
  grant blocks dispatch and keeps an unresolved attempt reserved). Protected
  hosts stay refused even with a grant, and the bridge worker still refuses
  PROD. How an owner records a grant is owner-reserved
  ([`live-selection-and-release`](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers)).

Fail-closed defaults where the plan leaves the decision to the owner:

- a promotion destination whose baseline is not identical to the verified
  source baseline is refused; accepting an equivalent but different baseline
  needs an owner-approved versioned baseline-equivalence policy;
- a partial install is forward-recovered only with a declared idempotent
  re-import; restore of a previous package and of business data is not
  implemented (the rollback reference stays a pre-deploy inventory hash);
- verified evidence has no age limit beyond candidate currency; a maximum age
  or a mandatory re-verification interval is not defined;
- an unreconciled `failed` or `diverged` attempt whose candidate became stale
  cannot be read back (the candidate guard refuses) and keeps its reservation;
  as for `unknown-outcome`, resolving it needs an owner/operator decision and
  never deleting records.

`lib/delivery.mjs` implements attempts behind the adapter interface from the [connections contract](source-target-connections.md). API: `/api/connections` (owner-scoped references, read-only `probe`), `GET/POST /api/releases/:id/delivery` with actions `prepare`, `confirm`, `verify`, `cancel`, `promote`, `retry` (and `GET …/delivery?packet=<attemptId>`; the contextual Solution and composed routes accept the same). Authenticated GET `/api/delivery/capabilities` reports `mode` (`synthetic` or `bridge`), `bridge: true` (the operator-bridge adapter is registered) and the adapter list; `liveDelivery` stays `false` until a live delivery has been verified. Every route authorizes the owner first; connections and attempts live in `.local/delivery/`, private file modes, outside Git.

Attempt states: `prepared -> deploying -> deployed-unverified -> verified | verification-failed`, plus `failed` (adapter error), `unknown-outcome` (timeout or service restart during `deploying`), `partial-outcome` (composed candidates only: mixed or incomplete per-unit receipts), `blocked` (identity or target state changed after preparation), and `cancelled` (owner cancelled preparation before dispatch). Only a matching read-back produces `verified`. The release's `target` check is `pass` only for a verified attempt bound to its current revision, candidate ID/hash and acceptance. Changing conditions or the candidate makes historical evidence `stale`, including in mutation responses. Synthetic results are training evidence, not ELMA delivery.

Guards enforced server-side:
- `prepare` requires current acceptance and the frozen candidate, a target-role connection, a reachable Target with confirmed identity, deploy/read-back capabilities and no active attempt for this release. It records identity and the pre-deploy solution inventory hash.
- `environment: prod` is refused (403); the only exception is an MR-08 promotion with a trusted owner grant, which this service never constructs ([promotion](#promotion-recovery-and-evidence-packets-mr-08)). A probed host in `PROTECTED_TARGET_HOSTS` is refused regardless of its name or any grant.
- `confirm` requires `DEPLOY <solution code> <first 12 hex of candidate SHA-256>` and an idempotency key. It checks release revision, candidate ID/hash and acceptance, then re-probes health/identity and re-inspects the Target. Unhealthy/changed identity or drift blocks dispatch. `deploying` is persisted before the adapter is called. Repeating the same key returns the existing attempt; another key on a non-prepared attempt is 409. At most one dispatch per attempt.
- `verify` requires the exact approved candidate and matching byte hash. It probes healthy, unchanged identity before and after read-back and rechecks candidate/revision/acceptance after the asynchronous operation. Invalid responses or changed identity persist `verificationError` with no passing comparison; an unresolved attempt (`deployed-unverified`, `unknown-outcome`, `partial-outcome`) keeps its state and Target reservation until a read-back observes the same Target, so a failed read never permits redispatch. A revision/candidate change after an observed read-back, or a failure from `verification-failed`, persists `verification-failed`. It is allowed from `deployed-unverified`, `unknown-outcome`, `partial-outcome`, `verification-failed` and `failed` (MR-08 reconciliation; an unobserved failure keeps `failed`).
- `cancel` authorizes the release owner, releases only a prepared attempt's lock and retains history without calling the adapter. It cannot cancel a dispatched operation or resolve an unknown outcome.
- Connections reject credential-like keys and URLs with embedded credentials. Adapters receive non-secret options only.

## Implemented: operator bridge adapter

The live path keeps the Wiki free of ELMA credentials and outbound connections: an operator runs `elma-dev bridge --target=<main-dev|dev2|test>` (repo `elma-development/commands/bridge.mjs`) on the machine that already has `elma365pm` and the ELMA tokens in `.env`; the worker polls the Wiki and executes jobs.

- `lib/bridge.mjs`: owner-scoped bridges (`POST /api/bridges` issues a `wb_…` token **once**; only its SHA-256 is stored, listing never returns it; max 10 per owner), a file-backed job queue per bridge (`.local/delivery/bridges/`), worker routes authenticated by `Authorization: Bearer <token>` with constant-time hash comparison: `POST /api/bridge/poll` (long-poll ≤ 25 s, records `lastSeen`, reported host/version and worker label), `GET /api/bridge/jobs/:id/artifact` (candidate bytes, only while the job is taken, hash re-checked), `POST /api/bridge/jobs/:id/result`. Removing a bridge invalidates its token and rejects queued jobs. A browser session cannot call worker routes; a worker token cannot call owner routes.
- Adapter `bridge` (always registered; option `bridgeId`, owner checked on every call): `health` is `ok:false` when the bridge has not polled within 90 s or does not answer a health job in 30 s; `inspectSolution`/`readBack` → job `inspect`/`readBack`. The worker exports with `elma365pm export solution --allow-deps` into a private temporary source directory, packs to an archive outside that source, and hashes every packed entry with one service-ZIP expansion level. Package/service metadata and unknown files stay included; directory exports are a different representation and must not be compared directly with the candidate archive. The bounded standard-library reader requires Python 3 (`ELMA_PYTHON` may select the executable). `deployCandidate` → job `deploy` with the approved `.e365` as artifact (worker: SHA-256 check, `elma365pm unpack`, package code must equal the job's code, `elma365pm import --version-up`). Jobs carry only the solution code, the hash and, for a read-back under `import-normalized-v1`, the [metadata paths](#read-back-metadata-bytes) to return; identity comes from the worker's configured host, so a worker pointed at a protected host is refused by the existing identity guard.
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

Bridge target mapping. The owner's shared business DEV is the environment used
with the partner company, which promotes that work to PROD; dev2 is the owner's
technical environment. Wiki names both explicitly:

| Wiki predefined Target | `elma-dev bridge --target=` | Delivery |
|---|---|---|
| DEV (`preset-dev`) | `main-dev` | refused; health, inspect and export only |
| DEV2 (`preset-dev2`) | `dev2` | only an owner-designated candidate (`WIKI_TARGET_DEV2_DEPLOY_CANDIDATES`) |
| PROD | not accepted | refused |

The legacy worker target `dev` historically resolved to dev2; the bridge rejects
it and Wiki never maps it to either Target. Select by task purpose, verify the
actual host, and separately bind the approved candidate to its Target. The
configuration variables and enforcement are in the
[connections contract](source-target-connections.md#predefined-target-configurations-dev-and-dev2).
See [server roles](https://github.com/netbka/elma365/blob/main/docs/server-environments.md).

## Bridge dispatch cancellation and restart

A persisted job is not permission to dispatch. Polling and artifact reads require a live, unexpired request in the current service process. Abort fences an unclaimed job as `cancelled` and removes its candidate bytes before rejecting the waiter. An already claimed job becomes `unknown-outcome`: new artifact reads are denied, but an operator that already downloaded the artifact may still be running. A late result is retained with `lateCompletion: true`; it does not restore the expired request or verify a release.

After coordinator restart, old queued jobs are cancelled and claimed jobs become unknown on their next access. They are never replayed automatically. Reconcile an uncertain deployment through the existing Target read-back path. Removing a bridge still invalidates its token and settles its callers. The store requires one coordinator per directory; this is not a distributed lease or a guarantee that an external process stopped.

`node --test test/bridge-queue.test.mjs test/bridge.test.mjs test/delivery.test.mjs` checks normal dispatch, queued/claimed abort, pre-aborted input, removed bridges, restart, abort during queue/claim persistence and artifact reads, late completion and the existing delivery guards. All fixtures are synthetic; no ELMA import is performed.

## Exact read-back policy

`lib/delivery-verification.mjs` owns `exact-solution-inventory-v1`. Both inventories must contain unique, non-empty relative paths and full lowercase SHA-256 digests. Invalid arrays, unsafe/duplicate paths and malformed hashes are rejected before comparison. Fingerprints sort validated rows without changing input arrays; row ordering alone is not drift.

Compare the entire declared solution inventory in both directions. Missing, changed and unexpected files fail verification. `package.json` and every `manifest.json` are included; no filename-based volatility exemption exists. At least one file must be compared. The compatibility `volatile` field is always empty; comparison evidence includes `policy`, `match`, `compared`, `missing`, `different` and `unexpected`.

A mismatching read-back equal to the pre-deploy inventory is reported as import not applied. Equality proves the scoped state at observation time, not that an import caused it. A prior verified record without the current policy/match is lazily persisted as `verification-failed`, retaining its history/evidence and requiring fresh read-back, not redispatch.

This strict policy is intentionally conservative. A live adapter must define and demonstrate versioned expected-outcome rules for legitimate import transformations and native update/preserve behavior. Do not suppress entire metadata files to accommodate unknown transformations. Exact inventory equality is not a runtime business-scenario test or proof of recovery capability.

## Import-normalized read-back policy

`lib/delivery-import-normalization.mjs` owns `import-normalized-v1`, approved with the owner's [dev2 acceptance designation](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers) of 2026-10-14 (#37). `exact-solution-inventory-v1` stays the default and unchanged; only the delivery coordinator selects between them ([policy selection](#read-back-policy-selection)).

`compareImportNormalizedReadBack(expected, actual, { expectedFiles, actualFiles })` validates both inventories like the exact policy and compares the complete scope in both directions. Missing and unexpected files fail, including dependency files that an `--allow-deps` read-back adds. A differing file passes only when it is the root `package.json` or a `<service>/manifest.json` and its parsed JSON differs from the candidate only by:

- one appended object at the end of a `history` array (top-level, or `entities[i].history` in a manifest), with every earlier entry unchanged and in order;
- in `package.json`, rewritten metadata inside an existing record of `dependencies`, `internalDependencies`, `optionalDependencies` or `sysDependencies`. Services, record count and position, the record's `code`/`namespace`/`service` and those fields of its `dependsOn`/`data`/`entity` reference stay identical. The record must carry at least one non-empty identity field, or none of its content may change. A reference counts by its identity fields only when it is an object with at least one non-empty identity field; any other present reference (string, array, number, unidentified object) must stay value-equal.

Any other change fails: other files, other package or manifest fields, added/removed/reordered entities or dependency records, removed, reordered, edited or several appended history entries, invalid JSON, bytes that are not valid UTF-8 (decoding is fatal, never replaced by U+FFFD) or a byte order mark, JSON that parsing would not keep distinct (a number literal that does not re-serialize to its own text, such as an integer beyond `Number.MAX_SAFE_INTEGER`, `1.0`, `1e2` or `-0`, or a duplicate object key) in either file, and byte changes without an accepted JSON difference. The bytes of every differing eligible file must be supplied and must hash to the compared inventory rows, or the comparison is rejected (502). The result keeps the exact evidence shape and adds `normalized` (`path`, `kind` `appended-history` or `rewritten-dependency`, JSON `pointer` of each accepted difference) and `rejected` (`path`, first `reason`). JSON values are compared by value: object key order and whitespace inside an otherwise accepted file are not reported.

Passing this policy is still not a runtime business-scenario test or proof of recovery capability.

### Read-back policy selection

`selectReadBackPolicy` in `lib/delivery.mjs` chooses at `prepare`, from server configuration only: `import-normalized-v1` when the connection is the available predefined DEV2 Target (`preset-dev2`) and the candidate SHA-256 is listed in `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES`; `exact-solution-inventory-v1` for every other delivery, including the same candidate on any other Target. No request field, connection option or adapter answer selects or changes it. The attempt records `readBackPolicy: { id, version, selectedBy }` (`selectedBy` is `dev2-designated-candidate` or `default`); the read-back receipt records `evidence.readBack.policy`/`policyVersion`, the comparison its `policy`, and a failed read `evidence.verificationError.policy`/`policyVersion`.

At `verify` the recorded normalized policy applies only while the configuration still selects it. If the designation was withdrawn, the exact policy applies instead (never a broader one), the receipt names it and the history records the change. A `verified` attempt counts only under the exact policy or under `import-normalized-v1` that the attempt itself recorded; anything else is lazily persisted as `verification-failed`, like a legacy policy.

### Read-back metadata bytes

`import-normalized-v1` inspects bytes, not only hashes. For it, the `readBack` call asks for the bytes of exactly the candidate's eligible files: root `package.json` and every `<service>/manifest.json` of the candidate inventory (`importNormalizedMetadataPaths`). The exact policy sends no request and needs no bytes.

`readBackMetadataFiles` accepts the answer only when:

- `metadataFiles` is present; absent or `null` means a hash-only (older) bridge;
- it is a list of at most the requested paths, each entry `{ path, sha256, contentBase64 }` with a requested path, no duplicates, a path present in the reported inventory and canonical base64;
- the decoded bytes hash to the entry's `sha256` and to that path's reported inventory row;
- every requested path present in the read-back inventory is supplied. A requested path that the read-back lacks needs no bytes; the comparison reports it missing.

Any other answer fails closed with 502 (`code: READ_BACK_METADATA`) before identity is re-observed: the attempt is never `verified`, an unresolved state (`deployed-unverified`, `unknown-outcome`, `partial-outcome`) keeps its state and Target reservation, `evidence.verificationError.reason` names the failure and the history asks for a bridge update and a repeated read-back, never redispatch. Candidate bytes come from the frozen candidate archive.

**Bridge worker change (B4 dependency, netbka/elma365).** The current worker (`elma-development/commands/bridge.mjs`) answers `readBack` with `{ inventory, version }` only, so every DEV2 delivery under `import-normalized-v1` fails closed until it is updated. This repository does not change it. The required fields:

| Direction | Field | Contract |
|---|---|---|
| job → worker | `payload.code` | unchanged |
| job → worker | `payload.readBackPolicy` | `"import-normalized-v1"`; present only with `metadataPaths` |
| job → worker | `payload.metadataPaths` | array of archive paths (`package.json`, `<service>/manifest.json`), in the same path form as `inventory[].path` |
| result → Wiki | `result.inventory`, `result.version` | unchanged |
| result → Wiki | `result.metadataFiles` | array, one entry per requested path present in the packed read-back archive: `{ path, sha256, contentBase64 }` |

The worker must take each entry's bytes from the same packed read-back archive entry that it hashed for `inventory` (after the one service-ZIP expansion level), never from the unpacked pretty-printed export directory; `sha256` is the hex digest of exactly those bytes and `contentBase64` their standard base64 with padding. It returns no unrequested path and omits a requested path only when the archive lacks it. Without `metadataPaths` the result stays as today. The complete result must stay under the 2 MiB result limit of `POST /api/bridge/jobs/:id/result`. An older Wiki ignores `metadataFiles`.

## Implemented: local delivery UI

The `/releases` page uses `web/releases/delivery.js` and its pure `delivery-model.js` in both the service and synthetic Storybook fixtures. Disabled delivery leaves offline handoff usable. Explicitly enabled synthetic mode shows training labels, stand selection/probe, candidate hash/revision, separate typed confirmation, read-back, missing/changed/unexpected files, policy, verification errors and history. A returned operation stays visibly unverified. Stale preparation can be cancelled before preparing again. Protected-target warnings, scenario selection and connection removal remain available from the integrated UI.

With the bridge adapter the same panel lists the owner's bridges (online/offline, reported host, worker label), issues a bridge token that is displayed exactly once, creates bridge-backed Target connections (TEST/DEV only) and relabels prepare/confirm as a Target delivery; a running operation offers refresh, not another confirmation. Confirmation uses a stable attempt-specific key. A lost or unreadable mutation response locks actions until the owner refreshes the release and reconciles the stored attempt. Failed loading removes controls until successful retry. Unknown outcomes offer read-back, not another confirmation. Focus remains in the delivery section after actions/refreshes. No UI control creates live-adapter permission.

## Limitations
- **No live delivery has run yet.** The operator bridge adapter exists (section above) and was exercised against a local Wiki with a real worker pointed at dev2 for read-only jobs only (health; inspect of an installed solution: 51 files in 8 s). On 2026-10-14 (#37) the owner designated dev2 as the non-production Target for PLAN-01 P8 acceptance of the Contracts candidate only: install/import, read-back, business checks and reset/recovery through the operator bridge; shared business DEV and PROD stay excluded ([dev2 acceptance designation](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers)). Every other environment or candidate still needs owner designation ([`elma-environment-write`, `live-selection-and-release`](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers)).
- **A real `elma365pm import --version-up` cannot pass `exact-solution-inventory-v1`.** The import appends a `history` entry to `package.json`/`manifest.json` and may rewrite dependency metadata, so the exact policy reports them as `different`; a read-back export with `--allow-deps` can also list dependency files as `unexpected` when the candidate was exported without them. This is by design of the strict policy. The owner-approved versioned normalization is [`import-normalized-v1`](#import-normalized-read-back-policy); unexpected dependency files still fail it. The coordinator selects it only for an owner-designated DEV2 candidate ([selection](#read-back-policy-selection)); every other live attempt still ends as `verification-failed` with the exact discrepancies listed, which is the truthful result. Until the bridge worker returns `metadataFiles` ([B4 dependency](#read-back-metadata-bytes)), a DEV2 read-back under `import-normalized-v1` also fails closed and stays unverified.
- Synthetic scenarios (apply, unapplied, fail, timeout, drift) stay disabled by default unless `DELIVERY_SYNTHETIC_ADAPTER=1`. Enabling them never proves an ELMA operation. `elma365pm import` limitations apply to the bridge path (`directory required` for widget-script changes; silent skip without a new `history` entry, which read-back reports as import not applied).
- A bridge token is a bearer secret for the operator machine: it can read candidate artifacts of jobs addressed to it and report results, nothing else. Rotate by removing the bridge and issuing a new one. A worker restart mid-job leaves the job `taken` until the Wiki-side timeout (`DELIVERY_TIMEOUT_MS`).
- One service process; the service queue reserves each observed Target host across releases, owners and connection aliases. Durable `prepared`, `deploying`, `deployed-unverified`, `unknown-outcome` and `partial-outcome` attempts, an unreconciled `failed` attempt and a `diverged` `verification-failed` attempt without a retry block another preparation on that host; case and a trailing DNS dot are normalized. Confirmation also rejects overlapping legacy preparations before dispatch. Reservation errors disclose no competing record or owner. Cancellation before dispatch or a terminal result releases the reservation. This is not a distributed lock and cannot protect a differently reported alias for the same host, external operators or another service process. Restart reconciliation is lazy on the next read; durable unresolved attempts still block preparation before that read.
- Rollback reference is the pre-deploy inventory hash only; no package/data/process restore is performed.
- The real Source/Target journey remains proposed; the 17 current delivery Storybook states cover the synthetic path (including protected Target refusal) and the bridge panel (no bridge yet, bridge offline, deploy in progress).

## Verification commands and scope

`node --test test/target-presets.test.mjs` covers predefined DEV/DEV2 Targets and the policy wiring through a polling worker stand-in: a designated DEV2 delivery verified under `import-normalized-v1` with the policy in attempt and receipt, exact policy for every other delivery despite request fields, fail-closed hash-only, missing, unrequested, duplicate, malformed and mismatched metadata bytes without redispatch, and a withdrawn designation falling back to the exact policy. `node --test test/bridge.test.mjs` covers the bridge: token issued once and stored hashed, end-to-end delivery through a polling worker stand-in, slow import answered as `deploying` and finished in the background, unapplied import never verified, worker error → `failed`, owner isolation, PROD identity refusal, timeouts without a worker, bearer/session separation on the routes. `node --test test/delivery-verification.test.mjs test/delivery-import-normalization.test.mjs test/delivery.test.mjs test/delivery-model.test.mjs test/delivery-integration.test.mjs` covers exact inventory, the opt-in import normalization (accepted history/dependency rewrites; rejected other files, fields, history edits, changed non-object references, records without identity fields and extra/missing files; requested metadata paths, metadata byte validation and policy selection), invalid/duplicate/extra files, target health/identity continuity, concurrent release edits, durable legacy-policy invalidation, stale release/UI evidence, preparation cancellation, capability API authentication, owner isolation, idempotency, restart and timeout handling.

`npm run test:releases:browser` covers offline review/handoff and the bridge-only panel (token issued once and hidden after the next action, bridge-backed connection, honest probe without a worker, bridge removal). `npm run test:delivery:browser` covers the authenticated synthetic screen, identity/probe, confirmation, exact policy, unapplied import, stale evidence, cancellation, lost-response reconciliation, loading retry, focus, protected-target refusal, connection removal and mobile layout. Extra-file and verification-error display checks use explicitly injected persisted synthetic evidence; actual comparator rejection is covered by the archive/store tests. Storybook uses the production renderer, with missing/changed/unexpected evidence represented truthfully.

Passing these checks is not a live ELMA, TEST or PROD deployment result. Record executed CI results for the exact integration commit separately.

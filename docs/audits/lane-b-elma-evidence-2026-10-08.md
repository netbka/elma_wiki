# Lane B: native history and delivery evidence

Assigned outcome: investigate #47's remaining native-version association and
process/application gaps; prepare #11 candidate/Target evidence. Investigated
Wiki main `79f9e3cc0af4fbcb898c9416ec5218039081ebc4` on 8 October 2026;
rebased onto `b0cddde59d150aa0a0f26edd5c99b76842f81d68` after #88 merged.
This pass reads published native evidence and verifies offline/synthetic
contracts. It performs no ELMA writes, feature changes, imports or deployment.

## Evidence sources and precedence

The earlier [open-issue audit](open-issues-2026-10-08.md) records an earlier
same-day checkpoint. The following later, committed parent-repository records
supersede its missing process/application history-access observations:

- [Process/application comparison at cd2a815](https://github.com/netbka/elma365/blob/cd2a8158bda4dcffa91d0bd6f2bbd189901804f3/docs/dev2-process-application-history-verification-2026-10-08.json).
- [Native history repair at 8db09ba](https://github.com/netbka/elma365/blob/8db09ba06a3aa2454c063bdb7b874ecf05295c15/docs/dev2-native-history-repair-2026-10-08.json)
  and its [scope/cleanup report](https://github.com/netbka/elma365/blob/8db09ba06a3aa2454c063bdb7b874ecf05295c15/docs/dev2-native-history-repair-2026-10-08.md).
- [Controlled widget publishers/bodies at aa280a1](https://github.com/netbka/elma365/blob/aa280a1f13c8487d71a99da19c7bbe0003090baa/docs/dev2-two-author-history-verification-2026-10-08.json).
- [Packed read-back preflight at acac560](https://github.com/netbka/elma365/blob/acac560685587c3d2cdde142e303eb6ffd7b6272/docs/bridge-packed-readback-2026-10-08.md).

These are saved observations from other authorized tasks, not new live tests
by Lane B. Raw responses, native identifiers, configuration and artifacts
remain in private parent-repository storage. No credentials or native host
details are needed in this dossier.

## #47 capability matrix

| Capability | Observed evidence | Remaining limit |
| --- | --- | --- |
| Widget/form | One controlled widget: two publishers and native row/object/version/body correspondence to fresh exports for versions 35–38; edit/revert history survives zero final diff | No general association of an arbitrary archive to a unique native revision; no general form or per-field authorship claim |
| Process historical bodies | Published versions 31/32 returned matching native identity/version and complete sections | Native updater references have not been established as publishers or human authors |
| Process history access | Later repaired dev2 reports 32 versions; first page contains 32–23; normal lock acquisition/release returned 200; complete published process remained unchanged | First-page evidence is not a complete pagination proof. Earlier 409 and later normal locking do not prove stale-write rejection or atomic version control |
| Process export representation | Both revisions differ from the export only by two native-only empty STRING `data.mask` objects; exact comparison stays false | Opt-in `cli-empty-string-mask-v1` representation matching is not runtime equivalence, freshness or version association |
| Process unique version association | Versions 31/32 have equal values for every exported field but distinct native updater IDs; the export omits native ID/version/actor metadata | Content equality cannot choose either revision or updater. Time, current version and exchange markers cannot repair that ambiguity |
| Application historical bodies | Later repaired dev2 fixture versions 1/2: native snapshot IDs match selected rows, GET 200, downloads equal their native bodies, bodies distinct | Single actor only; current application response and saved snapshots have different projections; CLI-export correspondence remains unproven |
| Application cleanup/coverage | Zero live fixture applications after soft deletion; two snapshots still retrievable; zero runtime items/instances | Eight page versions were generated; their post-delete retention was not verified. Installed/locked applications retain disabled controls |
| Native stale-write protection | Editor lock conflict/acquisition/release observed | No controlled stale revision write, expected-version compare-and-swap or lost-update race test; Wiki revision gates are a separate contract |

The repair enabled structure snapshots in its separately authorized task;
it did not enable the package-tree version flag, prove whole-server restart
persistence, or authorize this task to alter flags. History-access availability
must still be checked per Source/platform/object. Do not repeat the completed
widget or history-access repair just to satisfy an older issue body.

Vendor [structure versioning](https://elma365.com/ru/help/platform/elma365-structure-versioning.html)
documents object-specific history and publication triggers.
[Application versioning](https://elma365.com/ru/help/platform/app-versioning.html)
distinguishes application snapshots from independently versioned pages.
The [UI export guide](https://elma365.com/ru/help/platform/export-solution-file.html)
warns that current state may differ from the fixed version. These documents
are prerequisites/context; they do not establish this CLI's freshness or mapping.

Recommendation: keep Wiki's immutable captures, content comparison and trusted
portal actors. Read native history through existing bounded readers only when
Source, object identity and native revision/body are established. Keep ambiguous
matches explicitly unassociated; do not infer authors from upload actors,
updater metadata or equal content. No new history/merge engine is needed.

## #11 physical candidate and Target readiness

| Gate | Current evidence | Pilot status |
| --- | --- | --- |
| Accepted physical package | `accepted-full-export-v1` binds immutable full bytes, complete inventory and current Solution/review digest; mixed state and later partials are blocked | Offline capability verified; no native candidate selected by this task |
| Frozen offline handoff | Existing Solution handoff reviews all files, freezes original bytes, attributes approval, and issues a bundle with deployment/Verified false | Synthetic bundle prepared by this pass; no native import permission |
| Shared candidate dispatch | `lib/solutions.mjs` creates a guarded release store under `shared-solutions`; `server.mjs` exposes only list/change/preview/bundle for its handoffs | Integration gap: Target delivery uses the legacy release store. A shared handoff ID is refused by `/api/releases/:id`; copying it there would lose its Solution/review guard |
| Explicit Target/bridge | Named target-role reference, observed identity/version, owner-bound bridge, protected-host guard and host-wide unresolved-attempt reservation exist | No connection/bridge/candidate binding was selected or probed in this pass. A Source reference never supplies it |
| Native dependency coverage | Saved same-server three-package plan: no unresolved required references, ambiguous providers or cycles | Does not prove dependencies exist with compatible versions on a different Target, nor justify importing excluded paid internals |
| Transport representation | Saved bridge inventory matches Wiki for 48 packed entries; two fresh unchanged-target exports match exactly | Proves this read representation, not import transformations or arbitrary solutions |
| Native import/read-back | Existing exact policy includes package/manifests/unknown files and fails missing/changed/unexpected entries | Candidate/import/re-export correspondence, no-op-import rejection and recovery remain unperformed natively |

The legacy delivery engine must be reused for the shared handoff path with
the current association guard held/rechecked across candidate reads and
asynchronous prepare/confirm/verify. Authentication grants shared content
access; operational connection credentials/execution ownership stay separate.
This assignment prepares that boundary; it does not silently copy a shared
candidate into legacy storage or implement a second delivery engine.

## Concrete pilot evidence worksheet

Keep actual values and archives in private runtime evidence. Each item below
is **not run/unbound** for a native Lane B pilot until an observation supplies
it; the synthetic bundle is not a native selection.

1. **Candidate:** Solution ID/revision, accepted artifact ID, review digest,
   frozen handoff ID/revision/candidate ID, archive SHA-256, complete expanded
   inventory hash, policy and approving actor. Recheck the existing association;
   a new comment, finding, partial or archived state requires fresh review.
2. **Source and Target:** record separate explicit references. For technical
   checks, dev2 is the documented technical environment, but record the actual
   approved Target/bridge identity/version and capability probe. Never map the
   legacy worker label `dev` to shared business DEV by name. PROD stays excluded.
3. **Preflight:** establish the shared handoff's guarded delivery entry first;
   obtain a fresh complete Target export, preserve original bytes and inventory,
   resolve every declared dependency against the chosen Target, identify omitted
   paid internals and retain a rollback artifact/reference. A fingerprint alone
   cannot reconstruct an earlier Target package or recover runtime data.
4. **Expected outcome:** retain `exact-solution-inventory-v1`. Import legitimately
   changing metadata must fail this policy until evidence and a separately
   approved versioned expected-outcome policy exist. The process empty-mask
   representation policy is not a delivery policy and never drops metadata.
5. **Confirmation:** expose Target identity and candidate diff/hash, then obtain
   the runbook confirmation for that candidate. The existing typed value is
   `DEPLOY <solution code> <first 12 hex of candidate SHA-256>`; record its
   attempt-specific idempotency key privately. Check current identity, drift,
   approval and Target reservation immediately before dispatch.
6. **Operation/read-back:** retain attempt/job and operation outcome separately
   from native re-export bytes, complete comparison and before/after identity.
   Only an exact current candidate match can set Verified; an exit-success
   unapplied import must fail. If Target already equals the candidate, equality
   proves observed scoped state, not that import caused it.
7. **Failures/recovery:** collect missing/changed/unexpected metadata/file
   evidence. Timeout/restart stays unknown until read-back; no blind redispatch.
   Cancel only preparations. Do not remove private attempts to bypass reservations.
   Runtime business behavior and rollback execution require their own evidence.

For the remaining #47 association pilot, capture Source identity/version,
explicit native object and revision IDs, complete paginated rows and unchanged
historical bodies beside the immutable export. Compare every exported field
with exact results retained; enumerate all matching revisions rather than
selecting the newest. If no unique native link exists, record that limitation.
Application/page projections need a documented, tested mapping before any
correspondence claim. A native stale-write experiment requires an explicitly
assigned disposable object and supported adapter/version control, with
pre-state, competing update, rejected stale write and final-state evidence.

## Verification and disposition

At the initial Wiki base and again after integration with #88: **54/54** focused synthetic tests passed:
`solution-handoffs`, `delivery`, `delivery-verification`, `delivery-integration`,
`bridge` and `bridge-queue`. They cover exact original handoff, stale association,
metadata inclusion, unapplied imports, Target reservations, drift, identity,
idempotency, timeout/restart and authenticated bridge boundaries.
At parent `89a8ad3` (audit implementation last changed at `8db09ba`), **14/14**
offline process-audit synthetic tests passed, including explicit representation
policy, ambiguity, malformed evidence and private-output checks.

A separate loopback-only authenticated run prepared and retained
`qa/lane-b-synthetic/candidate.e365`, `handoff.zip` and `evidence.json` in this
task's ignored worktree storage. The three-file synthetic candidate equals the
uploaded bytes exactly. The bundle declares `deploymentAuthorized: false` and
`verified: false`; no native Target is bound. An authenticated GET to the legacy
delivery route with that real shared handoff ID returned **404**, reproducing
the dispatch boundary beyond code inspection. The stopped isolated runtime is
retained beside the bundle; its login was synthetic and no message was sent.
The integrated rerun rebuilt the bundle and reproduced the same 404. Capability
routing and whitespace validation passed after rebase. Only documentation
changed; no production renderer or Storybook state changed.

This is investigation/evidence preparation completed with bounded tests;
native delivery remains blocked by shared-handoff dispatch integration and an
explicit candidate/Target/expected-outcome/confirmation binding. #47 remains
open for unique export association, application mapping/actor semantics and
native stale-write protection. #11 remains open for integrated native delivery
and read-back. No new browser, human acceptance, live connectivity or deployment
result is claimed. #59/#41/#38 remain separate acceptance gates.

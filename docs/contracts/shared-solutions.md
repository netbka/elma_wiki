# Shared authenticated Solution catalog

Authority: #52 / SOLUTION_FIRST_PRODUCT_PLAN.md and owner's 2026-10-08 clarification: no per-user private configurations. P1: #55. Historical content and new Solutions are shared by all authenticated users.

## Admission and identity

`lib/solutions.mjs` stores new, explicitly shared records under `shared-solutions/`, separate from legacy `projects/` and `managed-workspaces/`. The fixed storage principal is a server implementation detail; clients cannot choose it. All authenticated MVP actors can read and mutate this catalog equally. Anonymous requests cannot access it. Host, Origin, service-header, body-size, immutable capture, explicit full/partial scope, Source, checksum, revision and reviewed-digest guards still apply.

`POST /api/solutions/uploads?filename=configuration.e365` accepts the existing bounded binary upload. `POST /api/solutions` accepts the existing `{name, baselineOwner, snapshot}` fields. Sharing is automatic for signed-in users; no checkbox or per-user visibility choice exists. Older clients may send `sharedConfirmed: true`; false is rejected because a private mode is unavailable. Snapshot references still resolve only in the Solution root; a legacy UUID is not a full/partial declaration or a lifecycle association. Shared uploads are not exposed through legacy viewer/project routes. Unattached uploads have no public route and remain bounded by the catalog's 5,000-upload limit (50 Solutions x 100 lifecycle artifacts).

The remaining `/api/solutions/:id` lifecycle routes mirror the existing managed engine: get/list, prepare, artifact preview/accept/original, archive/reopen. The collection supports `archived=true`. Internal Workspace/baseline structures remain the engine, not new product concepts.

Authentication resolves a persistent actor in private `actors/` before issuing a session. The existing verified VK private-message sender address, carried by the signed bot link, determines the stable `vk:` identity; browser text cannot select another sender. OTP/email and explicitly enabled local compatibility logins retain their existing identities. Session expiry/logout/restart does not erase actor records. Tokens, cookies and VK credentials are never stored in actor records.

The server supplies the actor separately from request data. Upload metadata and captured artifacts retain `uploadedBy`. Creation, preparation, acceptance and archive/reopen persist an actor, time and revision atomically with their state in `audit`; `createdBy` is distinct from the upload actor. Scope and same-Source assertions retain the actual declaring actor. Native ELMA provenance and declared responsible team remain separate facts. Discussion/finding attribution uses this actor contract in P4; no roles or membership UI is introduced.

## Change review and contextual code

`GET /api/solutions/:id/artifacts/:artifactId/review` combines the captured comparison, responsibility/boundary evidence, before/after object references, uploader, discussion and acceptance proof. Historical accepted comparisons remain readable. Old pending records can derive a fresh comparison; an unavailable historical comparison stays explicitly unknown.

`POST .../discussion` accepts only `{expectedRevision, expectedDiscussionRevision, type, text, componentKey?, parentId?}`. The session supplies identity. Comment, Needs changes, reply, resolve and reopen use the existing review-event rules; a caller cannot forge an approval, author or actor. The domain revision and discussion version are checked under the same storage queue as the decision. Events and audit persist atomically with the record. Open Needs changes findings block acceptance; comments alone do not. Acceptance binds the actual actor, current discussion version, artifact digest and existing boundary/conflict choices.

P5 additionally accepts `sourceAnchor?` for a selected process step, verified against the captured artifact's bounded source index. The original object/node identity, pointer, fingerprint and checksum survive replies and corrections; unknown or duplicate mapping is explicit. See solution-visual.md.

An explicit `supersedesArtifactId` on preparation continues that Change's discussion. It never rewrites an original event or anchor and leaves old bytes accessible. Anchors bind component identity plus original content digest: exact matches are current, changed or absent partial evidence is stale, absence from a full export is removed, and duplicate/unknown identity is ambiguous. A historical superseded review cannot write or accept. Resolving a finding records an attributed reason. Reopening a finding after acceptance adds attention without silently rolling back the immutable accepted state.

The object context API resolves checksum-verified bytes only within the Solution's captured artifacts. Supported widget scripts link to `/solutions/:id/code/:artifactId/:objectRef`, reusing the existing editor and revision/checkpoint checks. Shared working-copy mutations retain the actual actor and are blocked while the Solution is archived. Arbitrary imported code never runs. Editor changes remain a separate working copy; they do not replace an export or enter accepted Solution state automatically. Unsupported or ambiguous objects have no editor action.

## Exact accepted export association — #34 / #11

`GET /api/solutions/:id/accepted-export?expectedRevision=N` is a read-only,
authenticated association check for the existing release capability. The same
path with `/original` before the query downloads the exact captured bytes, with
`X-Artifact-SHA256` and `X-Solution-Revision` headers. Both reads require the
explicit current integer revision and run in the managed store's mutation queue.
Legacy storage IDs remain inaccessible through this route.

Policy `accepted-full-export-v1` supports only the current accepted full export:
the Solution must be active, have no pending review or open finding, have no
accepted partial artifact after that full export, and have an accepted component
state matching a fresh parse of its immutable bytes. A reconciliation that keeps
local components absent from or different to the full export is blocked. Even a
component-level no-op partial change requires a later reviewed full export;
component equality cannot prove package/dependency metadata equivalence.

Evidence retains the full original SHA-256, complete expanded inventory and its
fingerprint (using the existing exact-inventory validator), snapshot and scope
declaration, acceptance time and actor where recorded. Package and manifest files
are included. Reparse/deletion of the upload does not alter captured bytes. Reads
do not mutate state, create a candidate, approve deployment or choose a Target.
This is the bounded physical association foundation for #11, not a parallel
release/deployment engine or a general virtual-state package builder. The normal
product shell and its deferred Delivery entry are unchanged.

Artifact integrity and accepted-state association can pass; compiler,
dependencies, Target, read-back and business-flow checks are explicitly `not-run`.
`deploymentAuthorized` and `verified` remain false. Existing candidate/release
acceptance, live adapter/import/export correspondence and authorized TEST
verification gates still apply. A caller must recheck the revision before later
use, and rerun the association check itself: later discussion can reopen a
finding without changing the domain revision. This response is evidence at
observation time, not a durable approval.

Focused store/API tests cover exact bytes and metadata, two authenticated actors,
anonymous denial and storage-root isolation, explicit revision, method restrictions, restart,
deleted uploads, corrupt archives, archived/pending state, no-op partial changes,
matching full reconciliation and retained local conflict state.

## Contextual offline candidate and handoff — #34 / #11

The Solution's **Передача** view reuses `web/releases/render.js` within the
existing Solution shell. It appears for a matching accepted full state; old
handoffs remain accessible from the technical history even after that state
changes. It does not add a global release area or expose Target dispatch.

`/api/solutions/:id/handoffs` supports authenticated GET/list and POST/create
with `{expectedRevision, title, intent, targetIntent}`. Creation takes a fresh
server-owned accepted-export capture; clients cannot provide archive bytes,
Source, actor, ownership or association evidence. Shared records use the
existing `releaseStore` under `shared-solutions/releases`, with the fixed
catalog principal and distinct authenticated actors. Legacy release roots stay separate; their HTTP access is shared; a shared handoff is not accessible
through `/api/releases/:id`.

`GET/POST .../handoffs/:handoffId` reads/changes the existing release lifecycle:
review every expanded file, document comparison limits, freeze the exact
original, then approve for offline handoff only. Existing parser/rejection,
release-revision and candidate-hash gates still apply. POST `.../bundle` with
`{revision}` downloads the existing candidate/evidence bundle. GET `.../preview`
uses explicit `path` and `side` query parameters for bounded inert source text.
All routes verify both the Solution and handoff association before parsing a
mutation body. Every mutation attributes the trusted session actor.

The persisted association binds policy, Solution/revision, accepted artifact,
archive hash, complete inventory hash and discussion-event digest. Before
creation, every release mutation, candidate read and bundle issuance, the store
rechecks accepted-export eligibility under the managed queue and holds that
guard through release persistence. Lock order is Solution then release. A
comment can invalidate a candidate even without changing the domain revision.
Archive/reopen, new reviews/changes, later baselines, findings and corruption
also prevent old approvals from being used. A stale record retains its exact
bytes/history for inspection and displays an explicit blocker; it cannot be
mutated, approved or handed off. Prepare a new handoff after review.

The browser preserves drafts on stale or lost mutation responses, disables
further actions until refresh and reloads the stored outcome before continuing.
Only the current freeze/approve/download action is visually dominant; the main
action and checksum appear next to the next-action summary. No source-project
link points to the incompatible legacy viewer.

This completes the bounded offline physical candidate association and handoff
for an accepted full export. It does not build virtual mixed packages, validate
native import/dependency semantics, authorize delivery or produce Verified.
Target, compiler and dependency checks remain not-run. TEST dispatch, target
identity/lock/drift, native expected outcomes and read-back require their owning
delivery contract and a separately authorized environment/candidate.

Tests: `test/solution-handoffs.test.mjs` covers shared identities, exact bundle,
restart/deleted uploads, legacy isolation, request restrictions, stale revisions,
discussion changes and Solution/release race protection.
`npm run test:handoff:browser` exercises production UI, actual candidate download,
stale drafts, lost approval response/recovery, archive invalidation, keyboard,
390px reflow and 200% zoom. Ten synthetic Storybook states use these same
production renderers.

## Shared historical content and backout

The owner explicitly chooses shared access for all historical configuration content. The service enables `sharedAccess` for its legacy projects, portals, managed workspaces and releases. Authentication precedes every read/mutation. No content copy, owner rewrite, archive modification or inferred Solution/full-snapshot creation is needed: original IDs, bytes and uploader/native provenance remain in place. All signed-in users can list/open the historical records, review their snapshots and work with supported code under the existing checksum/revision guards. New mutations use trusted session actors, not original uploader ownership. The primary Solution lifecycle stays separate from legacy capture identity; importing into that lifecycle still requires the correct full/partial declarations. Low-level stores retain their scoped default for internal callers; production HTTP always enables the shared product policy. Operational credentials and bridge/connection controls are governed separately by their execution contracts.

Prepare a local metadata inventory with `node tools/legacy-inventory.mjs <private-storage-directory>`.
This read-only helper inventories legacy project, managed-workspace and portal
metadata, preserves opaque owner/upload/snapshot provenance and fingerprints the
metadata. It does not read original exports, credentials or the shared catalog.
Malformed/unreadable records stay explicit. Output is a new private `.local`
file; stdout contains only counts and its path. The schema records the shared-authenticated policy and unknown lifecycle association; it contains no per-record privacy choice. The selected local directory is not evidence
of the deployed service's data. The helper performs no deployment or migration.

Backout disables the new catalog routes/UI and retains both private roots and actor records. Restoring a previous service revision does not move shared data into a legacy owner index or destroy either root. Back up private storage before an operational rollout. One service process owns each store; multiple writers require a shared transactional lock before deployment.

## Evidence

`test/solutions-api.test.mjs` uses synthetic archives and two signed VK identities: equal Solution and historical-content visibility, separate upload/creation/acceptance authors, persistent actors/history after restart, failed-decision atomicity, forged actor/owner rejection, anonymous/Origin/service-header rejection, automatic sharing and storage-root identity checks. Legacy snapshot/workspace/release tests cover authenticated access, checksum/revision/Source guards and shared code mutation attribution. This proves no live ELMA or production deployment.

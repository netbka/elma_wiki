# Shared authenticated Solution catalog

Authority: #52 / SOLUTION_FIRST_PRODUCT_PLAN.md. P1: #55. The legacy owner-private APIs retain their existing contract.

## Admission and identity

`lib/solutions.mjs` stores new, explicitly shared records under `shared-solutions/`, separate from legacy `projects/` and `managed-workspaces/`. The fixed storage principal is a server implementation detail; clients cannot choose it. All authenticated MVP actors can read and mutate this catalog equally. Anonymous requests cannot access it. Host, Origin, service-header, body-size, immutable capture, explicit full/partial scope, Source, checksum, revision and reviewed-digest guards still apply.

`POST /api/solutions/uploads?sharedConfirmed=true&filename=configuration.e365` accepts the existing bounded binary upload. The confirmation admits these new bytes for shared use. `POST /api/solutions` also requires `sharedConfirmed: true` and the existing `{name, baselineOwner, snapshot}` fields. Snapshot references resolve only in the shared root; neither a legacy UUID nor its owner can admit a private record. Shared uploads are not exposed through legacy viewer/project routes. Unattached uploads have no public route and remain bounded by the catalog's 5,000-upload limit (50 Solutions x 100 lifecycle artifacts).

The remaining `/api/solutions/:id` lifecycle routes mirror the existing managed engine: get/list, prepare, artifact preview/accept/original, archive/reopen. The collection supports `archived=true`. Internal Workspace/baseline structures remain the engine, not new product concepts.

Authentication resolves a persistent actor in private `actors/` before issuing a session. The existing verified VK private-message sender address, carried by the signed bot link, determines the stable `vk:` identity; browser text cannot select another sender. OTP/email and explicitly enabled local compatibility logins retain their existing identities. Session expiry/logout/restart does not erase actor records. Tokens, cookies and VK credentials are never stored in actor records.

The server supplies the actor separately from request data. Upload metadata and captured artifacts retain `uploadedBy`. Creation, preparation, acceptance and archive/reopen persist an actor, time and revision atomically with their state in `audit`; `createdBy` is distinct from the upload actor. Scope and same-Source assertions retain the actual declaring actor. Native ELMA provenance and declared responsible team remain separate facts. Discussion/finding attribution uses this actor contract in P4; no roles or membership UI is introduced.

## Change review and contextual code

`GET /api/solutions/:id/artifacts/:artifactId/review` combines the captured comparison, responsibility/boundary evidence, before/after object references, uploader, discussion and acceptance proof. Historical accepted comparisons remain readable. Old pending records can derive a fresh comparison; an unavailable historical comparison stays explicitly unknown.

`POST .../discussion` accepts only `{expectedRevision, expectedDiscussionRevision, type, text, componentKey?, parentId?}`. The session supplies identity. Comment, Needs changes, reply, resolve and reopen use the existing review-event rules; a caller cannot forge an approval, author or actor. The domain revision and discussion version are checked under the same storage queue as the decision. Events and audit persist atomically with the record. Open Needs changes findings block acceptance; comments alone do not. Acceptance binds the actual actor, current discussion version, artifact digest and existing boundary/conflict choices.

An explicit `supersedesArtifactId` on preparation continues that Change's discussion. It never rewrites an original event or anchor and leaves old bytes accessible. Anchors bind component identity plus original content digest: exact matches are current, changed or absent partial evidence is stale, absence from a full export is removed, and duplicate/unknown identity is ambiguous. A historical superseded review cannot write or accept. Resolving a finding records an attributed reason. Reopening a finding after acceptance adds attention without silently rolling back the immutable accepted state.

The object context API resolves checksum-verified bytes only within the Solution's captured artifacts. Supported widget scripts link to `/solutions/:id/code/:artifactId/:objectRef`, reusing the existing editor and revision/checkpoint checks. Shared working-copy mutations retain the actual actor and are blocked while the Solution is archived. Arbitrary imported code never runs. Editor changes remain a separate working copy; they do not replace an export or enter accepted Solution state automatically. Unsupported or ambiguous objects have no editor action.

## Explicit migration and backout

There is no automatic exposure of old data. Before a legacy record is copied into the catalog, record its source, sensitivity, intended Solution, original uploader/native provenance and explicit admission decision. The authorized owner must classify and approve that particular record; filenames, matching solution codes, previous uploads and login do not imply consent. A classified record can then be re-uploaded through the confirmed shared route as a new immutable copy. Preserve the original private record and its evidence; never relabel the original owner's storage root or overwrite native authorship. No bulk migration or unclassified-record endpoint exists.

Backout disables the new catalog routes/UI and retains both private roots and actor records. Restoring a previous service revision does not move shared data into a legacy owner index or destroy either root. Back up private storage before an operational rollout. One service process owns each store; multiple writers require a shared transactional lock before deployment.

## Evidence

`test/solutions-api.test.mjs` uses synthetic archives and two signed VK identities: equal shared visibility/mutation, separate upload/creation/acceptance authors, persistent actors/history after restart, failed-decision atomicity, forged actor/owner rejection, anonymous/Origin/service-header rejection, explicit admission, and no legacy-to-shared or shared-to-legacy exposure. Existing managed storage/domain/API and VK tests cover the preserved safeguards. This proves no live ELMA or production deployment.

# Offline analyst releases

Implemented scope: AR-00/01/02 and the unchanged-original handoff part of AR-03, issue #11. The release does not connect to Source or Target, build workspace changes, execute uploaded code or authorize an import.

## Immutable association

One upload remains one owner-scoped project. `/releases` explicitly selects a new DEV export and an optional previous DEV export. Names never merge projects. Both originals and their parser metadata, inventory and structural summaries are pinned to the release under private runtime storage. Reparse/deletion of the original project cannot change a pinned release. A different artifact requires a new release.

The association is owner-only. A target-intent label is an instruction to a future operator, not an authenticated connection or target identity. All release, preview, decision and bundle routes authorize the owner server-side. No shared team membership or independent reviewer approval is implied.

## Comparison and review

Compare the entire expanded inventory by path and SHA-256, including opaque/unindexed files, additions and removals. Hide no metadata or history noise. The selected previous DEV is a review baseline, not a target read-back or a common three-way ancestor. Without a baseline, show all new files and require an explicit limitation statement; do not claim no conflicts.

Structural object/field summaries assist review. Permissions, process content and required-field changes are labeled with their impact; none is declared cosmetic. Field summaries are not proof of complete runtime semantics. Private preview returns text through JSON, displayed using textContent rather than HTML, up to 256 KiB; hashes cover every byte. Every changed file requires acceptance with a reason. Rejection blocks candidate preparation. A decision never removes a file from the package. The UI initially renders 20 changes and can reveal the rest, retaining unsaved drafts; approval checks the entire inventory.

Missing/malformed/unknown/opaque parser diagnostics and unresolved solution identity block candidate preparation. Unindexed preserved content requires a limitation statement. Acknowledging limitations cannot override the hard parser blockers. Same expanded file hashes are a no-op comparison, but the exact newly selected archive is still the handoff artifact.

## Candidate and acceptance

`review -> candidate -> prepared -> handed-off` describes local preparation only. Freezing references the pinned original's exact hash; no package is reconstructed from the parsed index. Owner acceptance follows candidate creation and binds candidate ID/hash, revision, conditions, reviews and actor. Artifact integrity and local-review checks can pass; compiler/ELMA validation, dependency resolution, target state and read-back are `not-run`.

Every review or condition change invalidates candidate/acceptance. A new candidate invalidates acceptance. Every mutation uses an expected integer revision; concurrent/stale mutations fail with 409 without overwriting another decision. All writes are serialized within the single service process and JSON is atomically renamed. Supported deployment remains one Node process, as for current project/workspace storage; multi-process transactional jobs are outside this slice.

## Private handoff

POST `/api/releases/:id/bundle` requires current owner acceptance and the expected revision. Recheck source/baseline integrity before issuing the bundle. Its ZIP contains the exact `candidate.e365`, `manifest.json` with comparisons/decisions/check evidence, and Russian `handoff.txt` with intent, limitations, unverified destination, operational checks and recovery limits. No credentials are injected; original archives can themselves contain confidential configuration and remain owner-private.

Prepared/Handed off is neither Deployed nor Verified. The manifest explicitly denies deployment authorization and verification. Delivery, native update/preserve plans, live validation, target drift checks, dispatch, read-back, restoration and TEST/PROD approval need the later owning capabilities. The old package is not a guarantee of data/process rollback.

Snapshots and decision history live in `.local/releases/<id>/` with private file modes, outside Git. There is no implicit import, reconciliation to DEV or background operation. Bundle issuance is an audit event, not proof a recipient received it.

## Evidence

`node --test test/releases.test.mjs` verifies pinning across reparse/delete/restart, owner isolation, stale/concurrent decisions, exact artifact hashes, audit history, parser/rejection gates and API protections. `npm run test:releases:browser` exercises the genuine authenticated UI, including rejection/resume, a stale tab that retains its draft, candidate/acceptance/download, invalidation, source preview and mobile. Six synthetic stories mount the same renderer and ViewModel as production.

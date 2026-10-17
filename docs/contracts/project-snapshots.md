# Project snapshots contract

Own immutable imported revisions and the boundary between source evidence, working changes and deployment evidence.

## Invariants
- Manual upload remains supported.
- Each Source load creates a new immutable snapshot.
- Original artifact is never edited in place.
- Authentication and project/snapshot identity are enforced server-side for every artifact. The HTTP service enables shared access for all historical and new configuration content (owner clarification 2026-10-08); original ownerId remains provenance. Internal store callers retain the scoped default unless shared access is explicitly selected.
- Original archive, parsed index, workspace, generated artifacts, candidates and evidence are separate layers.
- Unknown/opaque content is preserved privately when required for round trip and never silently treated as supported.
- Search/index data is not a deployable source package.

Minimum snapshot metadata: snapshot id, project id, source connection reference when connected, timestamp, content hash, parser/tool version and proven package provenance.

Synthetic archive tests prove immutability, ownership isolation, reparse behavior and preservation of unknown content.

## Implemented storage foundation

Each manual upload still creates an isolated project. Its first snapshot uses the project UUID and pins the original archive, SHA-256, original parser revision/version, coverage, creation time and package provenance. No Source identity is inferred from an upload.

Trusted server adapters can call `projectStore.createSource(owner, bytes, {connectionId, solutionRef})` and `appendSource(projectId, owner, bytes, reference, expectedSnapshotId)`. References contain only a named connection ID and solution code, never an endpoint, token or password. The adapter must authorize the connection before calling storage; these methods do not prove connectivity. The returned package code must match the explicit solution code. Appends require the same Source/solution and expected selected snapshot. Every successful append creates a separate snapshot, even when exported bytes are identical. There are at most 100 snapshots per project.

Snapshots pin their parsed data/report/inventory to the parser revision at import. Reparse creates a new current parser revision without changing any snapshot. Selecting a snapshot restores its pinned parsed representation and verifies its archive checksum. Selection changes the project's current view; it does not merge projects, edit an archive, or approve deployment. Existing workspace checksum guards reject a saved workspace when a different selected archive changes its base. Release creation pins the selected archive, snapshot ID, timestamp and non-secret Source reference; later selection never changes that release.

Legacy projects without snapshot metadata remain readable as one snapshot. Before reparse/selection, the current legacy parser revision is pinned atomically. Earlier parser revisions are not retrospectively claimed as captured snapshots. Metadata updates and mutations are serialized in one service process, matching current storage deployment requirements. Project deletion removes its snapshots; independently pinned release artifacts survive.

## Owner-scoped API

- `GET /api/projects/:projectId/snapshots`: immutable metadata list and `currentSnapshotId`.
- `GET /api/projects/:projectId/snapshots/:snapshotId/{data,report,inventory,original}`: pinned parsed documents or checksum-verified original archive.
- `POST /api/projects/:projectId/snapshots/:snapshotId/select`: JSON `{expectedSnapshotId}`; a stale or missing selection reference returns 409. Existing Host, Origin, service-header and owner checks apply.

There is no HTTP Source import route, connection adapter or live Source evidence in this foundation. The release creation UI can select immutable snapshots as its source/baseline without changing the project's current selection; project-viewer selection UI is still absent. `projectStore.snapshot(projectId, owner, snapshotId)` captures original bytes and pinned parser documents under the same serialization as project mutations, verifies archive integrity, and never selects/reparses the project. Omitting the third argument retains the current-project capture behavior. Partial/opaque parser results remain explicit and preserve original bytes; an unreadable export publishes no snapshot. Source/Target execution remains governed by their separate contracts.

Evidence: `node --test test/project-snapshots.test.mjs test/server.test.mjs test/releases.test.mjs test/workspace.test.mjs`. Synthetic tests cover distinct Source-like imports, immutability after reparse/restart/selection, upload isolation, legacy transition, mismatched references, failed imports, concurrent/stale operations, opaque bytes, corruption, owner/API protections, release pinning and workspace base checks. No live ELMA was contacted.

## DEV capture and installed-Target comparisons (D2)

The existing managed record stores an append-only `sourceComparisons` sequence,
returned by `managed.get` (and the existing Solution state response). Each
explicitly full capture pins its artifact ID, checksum, snapshot ID, parser
revision/version, capture time and named Source. A partial change never enters
this sequence. The previous capture may still be pending, superseded or closed;
acceptance and project selection do not change capture order. Its `review` uses
the existing full reconciliation comparator against that capture's original
components, independently of the accepted/merged state used for acceptance.

Consumer contract: `mode: source-captures`, policy
`full-capture-reconciliation-v1`, `before`, `after`, `capturedAtRevision` and
`status: compared | ambiguous | first-capture | unknown-source | different-source |
history-unavailable`. Same-Source pairs contain comparison rows; an `ambiguous`
pair retains unsupported evidence from either capture, with `beforeEvidence`
preserving the prior capture's ambiguities/dependencies/unclassified files.
Only `compared` is a clear capture comparison. Missing legacy
order remains unknown; a manual same-Source assertion never creates a named
connection. Full scope remains an explicit recorded declaration; capture order
does not prove native ancestry, authorship, installation or business acceptance.
Unclassified/ambiguous evidence stays in the existing review result.

The single `deliveryStore` also owns trusted `compareInstalled(candidateRef,
actor, {revision, connectionId})`, `reconcileInstalled` with the same arguments,
and `installedHistory(candidateRef, actor)`. The contextual `forSolution` and
`forComposed` facades expose these methods. The existing authenticated contextual
delivery routes (`/api/solutions/:id/handoffs/:releaseId/delivery` and
`/api/solutions/:id/composed/:candidateId/delivery`) accept POST actions
`compareInstalled` and `reconcileInstalled` with exactly `revision` and
`connectionId`, and return history from `GET …/delivery?installed`. The server
selects the candidate and execution actor and keeps the existing origin/request,
JSON and key-allowlist guards; any other key is refused with 400. No request may
assert inventory, Target identity, profile, policy or installation. The legacy
release route refuses both actions. There are no UI controls yet; visible UI
belongs to the D3–D5 stream.

Comparison/reconciliation calls perform read-only Target read-back bracketed by
identity checks, using the existing exact or designated DEV2 normalization
policy and metadata-byte validation. They persist immutable
`kind: configuration-comparison` records in the existing candidate attempt root.
These records do not count as dispatch attempts, release checks or reservations.
Successful delivery verification separately appends `installedObservation` and
`installedObservations` to that delivery record, including observed inventory,
policy/version, Target identity, time, candidate digest and exact acceptance
association. Manual reconciliation establishes equivalence only when actual
read-back matches the current guarded physical candidate. It never imports.

The installed comparison contains `mode: installed-base`, `before` (the last
matching scoped observation), `proposed`, fresh `observed` inventory and
`status: compared | unknown-base | drifted | unresolved-outcome | reconciled |
observation-failed`. `delta` exists only for `compared`: it is the strict file
inventory difference between proposed bytes and the still-observed installed
base. Its `missing` files are additions needed by the proposal, `unexpected`
files are installed paths absent from the proposal, and `different` files need
replacement. It is byte evidence, not a semantic/runtime impact claim.
`reconciled` records a new manual observation; compare again to select that new
base. A failed or stale read preserves any received inventory and continuity
result as historical evidence, creates no installed observation and exposes no
usable delta. Historical comparisons never change to follow newer inputs.

Base selection requires the same execution actor, connection, full observed
Target identity and exact scope. Shared-original handoffs compare across
successive candidates of the same Solution/native package; composed and legacy
namespaces stay separate, and a legacy base remains release-specific. Multiple
native import units require an explicit package-scope adapter and are refused
by this comparison method until one exists; delivery itself retains its current
multi-unit behavior. No overlapping object/package provider is guessed.
Unresolved operations anywhere on the Target suppress the usable delta and
manual advancement, including failed, partial, unknown and restarted dispatch.
Profile probes and import exit success cannot create an observation. Older
hash-only verification records are not backfilled into installed bases.

Every observation reports `evidenceBasis` (`synthetic` or `target-read-back`)
and `businessAcceptance: not-established`. Changed review inputs invalidate a
new comparison before persistence as usable evidence; they do not rewrite the
historical fact that older exact bytes were observed on a Target. Source and
installed comparisons never accept a review, authorize deployment, advance
native eligibility or complete business acceptance. The historical D1 packet
has no trusted acquisition/snapshot association or verified DEV2 base; this
implementation assigns it neither.

Focused evidence: `node --test test/source-capture-comparisons.test.mjs
test/installed-base-comparisons.test.mjs test/installed-base-api.test.mjs`, plus the existing snapshot, managed
store, handoff, exact/normalized verification, promotion and delivery tests.
Synthetic tests establish these storage/coordinator contracts only.

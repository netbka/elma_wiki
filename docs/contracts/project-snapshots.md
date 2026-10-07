# Project snapshots contract

Own immutable imported revisions and the boundary between source evidence, working changes and deployment evidence.

## Invariants
- Manual upload remains supported.
- Each Source load creates a new immutable snapshot.
- Original artifact is never edited in place.
- ownerId + projectId scope is enforced server-side for every artifact.
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

There is no HTTP Source import route, connection adapter, snapshot selector UI or live Source evidence in this foundation. Partial/opaque parser results remain explicit and preserve original bytes; an unreadable export publishes no snapshot. Source/Target execution remains governed by their separate contracts.

Evidence: `node --test test/project-snapshots.test.mjs test/server.test.mjs test/releases.test.mjs test/workspace.test.mjs`. Synthetic tests cover distinct Source-like imports, immutability after reparse/restart/selection, upload isolation, legacy transition, mismatched references, failed imports, concurrent/stale operations, opaque bytes, corruption, owner/API protections, release pinning and workspace base checks. No live ELMA was contacted.

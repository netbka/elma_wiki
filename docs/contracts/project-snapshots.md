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

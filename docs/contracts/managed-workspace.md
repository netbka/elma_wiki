# Baseline-first managed workspace engine

Authority: #33; architecture: #34; ownership: #31. Implementation checkpoints in draft PR #32.

`lib/managed-workspace.mjs` implements an immutable, serializable domain reducer and an adapter over the existing `parseProject` parser. `lib/managed-workspace-store.mjs` adds private owner-scoped persistence and association with existing snapshots. Neither is wired to HTTP routes, production UI, Storybook or candidate creation yet. The existing isolated upload viewer, script editor and release/deployment contracts remain operationally unchanged.

## Implemented behavior

Call `parseManagedArtifact(privateBytes, {id, scope})` with explicit `full` or `partial` scope. A filename, `solution.isAuthor`, successful parse or package checksum does not prove a complete export. A trusted caller must establish scope and authorized Source context before this engine is exposed. The artifact retains its byte checksum, parser revision, provenance, component evidence and ambiguities. Original bytes remain with the owning artifact store; this engine never rewrites them.

`createManagedWorkspace` requires a full artifact, a workspace name and an attributed baseline owner. Workspace identity is independent of filenames. Output state is deeply frozen and JSON serializable. Every accepted artifact and intervention/reconciliation record remains in history when the baseline advances or the workspace is archived/reopened. The reducer itself is not a persistence or authorization boundary; the storage adapter below owns those checks.

Identity uses the exact service/namespace/code tuple from a unique structural manifest entity. Manifest array indices, generated parser IDs, filenames and display names do not establish identity. Missing or duplicate keys remain ambiguous. Component fingerprints cover raw entity bytes, original manifest record metadata, side scripts and declared resource bytes. Entity path movement and manifest reordering alone do not change identity. Resource references come from the original manifest because the parser's sanitized entity projection intentionally strips them.

This checkpoint supports **entity-level evidence**. It does not establish independent process-node/condition identity, field-level ownership or contractual liability. A modified field/script currently marks its containing entity changed. Fingerprints are conservative byte evidence, including metadata/history noise, rather than a claim of semantic runtime equivalence. A code/namespace rename appears as a new component and an old component absent from a later full snapshot; there is no guessed rename matching.

Partial changes overlay only present, proven components. Missing components stay in the current working state; absence never requests deletion. An additive intervention retains untouched baseline ownership. A baseline modification requires explicit review of every boundary key. Different teams changing an already intervened component conflict; identical component evidence does not. Same-team continuation is sequential. Restoring exact baseline content restores baseline attribution while keeping intervention history.

Preview and acceptance are separate operations. Acceptance recomputes evidence and requires the expected workspace revision and the exact reviewed artifact digest. A stale tab, substituted artifact, duplicate artifact ID, wrong solution, full artifact passed as a change or archived workspace cannot be accepted. Boundary review does not authorize runtime deployment.

Reconciliation compares previous full baseline, current working components and a later explicitly full snapshot:

| Evidence | Result |
| --- | --- |
| All three agree | unchanged |
| Full snapshot agrees with baseline, working differs | known change retained |
| Full snapshot agrees with working, both differ from baseline | known change incorporated |
| Working agrees with baseline, full snapshot differs | external change |
| Working and full snapshot both differ from baseline and each other | conflict |
| Component evidence incomplete or unproven | ambiguous; acceptance blocked |

Full-snapshot absence can establish component removal only with clear component evidence and explicitly asserted full scope. Conflicts require a per-component `keep-working` or `take-snapshot` decision. There is no byte merge or AI resolution. Baseline acceptance advances the pointer, incorporates agreed changes and carries retained local interventions forward. It does not imply that the working state equals the accepted full artifact.

Unknown, malformed, missing, opaque and unassigned archive files stay explicit evidence and block acceptance. Unclassified bytes never disappear into an apparently complete known state. This gate is intentionally conservative: archives supported by the upload viewer may still be unsupported for managed lifecycle acceptance. The empty, correctly declared manifest is supported as an explicit full snapshot with no components.

## Private storage checkpoint

Construct `managedWorkspaceStore(directory, projects)` once per private directory in one service process. The trusted caller supplies the authenticated owner separately from request data. No caller-selected owner, paths, Source URL or credentials are accepted in request objects. Source references come only from the existing owner-scoped snapshot record, not from package strings or a request assertion.

- `create(owner, {name, baselineOwner, snapshot})` creates a new UUID workspace from a full snapshot. `snapshot` requires explicit `projectId`, `snapshotId`, `scope` and `scopeConfirmed: true`. Missing snapshot identity never falls back to the project's current selection. Scope is a recorded explicit assertion, not independently proven export completeness or live connectivity.
- `prepare(id, owner, {kind, snapshot, expectedRevision, ...attribution})` captures a partial `change` (team/taskRef) or full `reconciliation` (baselineOwner). It persists an immutable original and proposal before returning review evidence. Attribution is pinned during preparation, not supplied again during acceptance. Unsupported evidence remains inspectable but cannot be accepted.
- `preview(id, owner, artifactId)` reloads the saved proposal; `accept(id, owner, artifactId, {expectedRevision, reviewedDigest, reviewedBoundaryKeys?, resolutions?})` reuses the existing reducer. Changed workspace revisions make proposals stale rather than silently rebasing earlier decisions. Replays cannot accept an already consumed proposal.
- `get`, active/archived `list`, `original` and revision-guarded `setArchived` preserve history. Snapshot originals are copied independently, so project selection, reparse and deletion do not mutate or remove the managed baseline/history. This does not grant access to the former project after deletion.

Capture uses `projectStore.snapshot(projectId, owner, snapshotId)` under the project's existing serialization. The source snapshot's checksum, creation time, parser revision/version and non-secret Source reference are retained. The managed engine parses the captured original once with its current parser; that separate parser version and result are persisted, not silently regenerated when the project is reparsed or a proposal is reopened. The adapter does not claim its projection is the source snapshot's original parsed document.

State and proposals use one atomic JSON replacement after immutable artifact writes. A failed metadata replacement leaves the previous committed state; uncommitted artifacts are not discoverable. Restart reads the persisted baseline, decisions, proposals and archive status. This is single-process atomic persistence, not multi-process locking or a guarantee against storage-device power loss. A crash can leave unreferenced staging/artifact files; they are never auto-adopted. Operator retention/cleanup remains a follow-up.

Full reads, previews and mutations verify SHA-256 for referenced accepted/pending originals. `original` verifies the selected member. List rows are metadata summaries, not an integrity/verification pass. Missing/corrupt artifacts fail closed. There are at most 50 managed workspaces per owner and 100 captured artifacts (including pending) per workspace. This bounded checkpoint does not implement discard/retention or multi-reviewer collaboration; archived records still count toward the owner limit.

## Remaining integration gates

- Authenticated HTTP routing and explicit scope/Source confirmation UX; preserve existing Host/Origin/service-header checks. Storage receives a trusted owner, not a browser identity assertion. No managed endpoint is enabled by this checkpoint.
- Package-level metadata/dependency reconciliation and finer component adapters where stable identity is proven. An entity projection does not represent a deployable complete package. Partial deletion needs an explicit proven tombstone contract; it is absent here.
- Candidate handoff must use #11's exact artifact/review contract and cannot construct an archive from this projection.
- #35 production workspace UI and #36/#40 shared renderer/Storybook states, followed by #37/#39/#41/#38 integration and owner acceptance gates.

No live ELMA Source/Target connection, package generation, publication or deployment is implemented or tested in this checkpoint.

## Evidence

Run `node --test test/managed-workspace-store.test.mjs test/managed-workspace.test.mjs test/project-snapshots.test.mjs test/e365.test.mjs`.

Domain tests cover all eight architecture comparison cases, identity/order/path stability, original side-script/resource evidence, immutable history, review binding, stale/mixed artifact rejection and archive/reopen. The added storage tests use real synthetic archives, the existing parser and project store, and temporary file-backed storage: restart, complete reconciliation lifecycle, pinned historical snapshots, owner/membership isolation, stale/concurrent decisions, attribution pinning, unsupported evidence, corrupt bytes and failed atomic writes. CI execution evidence is recorded on the PR; syntax checks alone are not a test pass. No browser, uncoached first-use, live delivery or complete #34/#33 acceptance is established by these tests.

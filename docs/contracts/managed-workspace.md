# Baseline-first managed workspace engine

Authority: #33; architecture: #34; ownership: #31. Implementation checkpoint in draft PR #32.

`lib/managed-workspace.mjs` implements an immutable, serializable domain reducer and an adapter over the existing `parseProject` parser. It is not yet connected to private persistence, HTTP routes, production UI, Storybook or candidate creation. The existing isolated upload viewer, script editor and release/deployment contracts remain operationally unchanged.

## Implemented behavior

Call `parseManagedArtifact(privateBytes, {id, scope})` with explicit `full` or `partial` scope. A filename, `solution.isAuthor`, successful parse or package checksum does not prove a complete export. A trusted caller must establish scope and authorized Source context before this engine is exposed. The artifact retains its byte checksum, parser revision, provenance, component evidence and ambiguities. Original bytes remain with the owning artifact store; this engine never rewrites them.

`createManagedWorkspace` requires a full artifact, a workspace name and an attributed baseline owner. Workspace identity is independent of filenames. Output state is deeply frozen and JSON serializable. Every accepted artifact and intervention/reconciliation record remains in history when the baseline advances or the workspace is archived/reopened. These are domain invariants, not proof of durable storage or multi-user authorization.

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

## Remaining integration gates

- Private storage adapter: authorize owner and Source context, validate full/partial declarations, capture immutable bytes and pinned parser documents, serialize writes and verify checksums on read. The engine itself is an internal trusted API, not an HTTP authorization boundary.
- Package-level metadata/dependency reconciliation and finer component adapters where stable identity is proven. An entity projection does not represent a deployable complete package. Partial deletion needs an explicit proven tombstone contract; it is absent here.
- Persisted baseline/current-state operations and existing snapshot association; candidate handoff must use #11's exact artifact/review contract and cannot construct an archive from this projection.
- #35 production workspace UI and #36/#40 shared renderer/Storybook states, followed by #37/#39/#41/#38 integration and owner acceptance gates.

No live ELMA Source/Target connection, package generation, publication or deployment is implemented or tested in this checkpoint.

## Evidence

Run `node --test test/managed-workspace.test.mjs test/project-snapshots.test.mjs test/e365.test.mjs`.

Synthetic tests cover all eight architecture comparison cases, identity/order/path stability, original side-script/resource evidence, immutable history, review binding, stale/mixed artifact rejection and archive/reopen. Existing parser and snapshot tests cover their own previously implemented storage/owner boundaries; passing them does not establish managed-workspace persistence, browser acceptance or live delivery.

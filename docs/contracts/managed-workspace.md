# Baseline-first managed workspace engine

Product authority: #52 / the Solution-first plan; underlying engine architecture: #34; declared responsibility: #31. #33 and PR #32 retain the engine's initial evidence.

`lib/managed-workspace.mjs` implements an immutable, serializable domain reducer and an adapter over the existing `parseProject` parser. `lib/managed-workspace-store.mjs` adds private persistence and association with existing snapshots. The shared `/solutions` catalog uses this same engine through its separately admitted storage root; the owner-scoped HTTP lifecycle below remains legacy compatibility. See [shared Solutions](shared-solutions.md) and the [current journey](../workflows/solutions.md). Candidate composition is not wired; supported contextual code remains an independent working copy.

## Implemented behavior

Call `parseManagedArtifact(privateBytes, {id, scope})` with explicit `full` or `partial` scope. A filename, `solution.isAuthor`, successful parse or package checksum does not prove a complete export. A trusted caller must establish scope and authorized Source context before this engine is exposed. The artifact retains its byte checksum, parser revision, provenance, component evidence and ambiguities. Original bytes remain with the owning artifact store; this engine never rewrites them.

`createManagedWorkspace` requires a full artifact, a workspace name and an attributed baseline owner. Workspace identity is independent of filenames. Output state is deeply frozen and JSON serializable. Every accepted artifact and intervention/reconciliation record remains in history when the baseline advances or the workspace is archived/reopened. The reducer itself is not a persistence or authorization boundary; the storage adapter below owns those checks.

Identity uses the exact service/namespace/code tuple from a unique structural manifest entity. Manifest array indices, generated parser IDs, filenames and display names do not establish identity. Missing or duplicate keys remain ambiguous. Component fingerprints cover raw entity bytes, original manifest record metadata, side scripts and declared resource bytes. Entity path movement and manifest reordering alone do not change identity. Resource references come from the original manifest because the parser's sanitized entity projection intentionally strips them.

Whole-component fingerprints remain conservative byte evidence, including metadata/history noise, rather than semantic runtime equivalence. A code/namespace rename appears as a new component and an old component absent from a later full snapshot; there is no guessed rename matching. Unsupported components retain object-level responsibility.

For captured native `processor` entity JSON, `lib/process-elements.mjs` additionally indexes unique nodes (`process.items`), transitions, lanes and context variables (`context` or `context.fields`). Native IDs or dictionary keys identify process parts; variable codes identify variables. Display names and array positions never establish identity. The bounded projection stores canonical part hashes and source pointers, preserving all remaining source, manifest metadata and side/resource evidence in a residual hash. Missing complete process collections, duplicate/missing IDs, unknown shapes, exceeded limits and older records lacking the projection remain explicit uncertainty. Conditions nested in a node/transition are attributed to that part; no independent condition identity is invented.

The original full declaration attributes existing parts to its team. A partial process export containing an added node/variables retains the team of unchanged parts and attributes only additions/edits/removals to the declared change team. Editing an existing baseline part requires boundary review; changing another team's intervened part conflicts. Removing a part inside a supplied complete entity differs from absence of the entire entity in a partial archive, which never deletes it. Exact restoration and later full incorporation retain the established per-part declarations and immutable history. Legacy missing evidence remains unknown rather than retroactively inferring native authors.

Precision can narrow the partial boundary/conflict gate only when all relevant entity projections are complete and residual evidence agrees. Otherwise the conservative whole-object gate remains. Full reconciliation uses the same three-way classifier for explanatory part rows and still requires a whole-file version choice if raw component evidence diverges, even for disjoint part edits. There is no generated or merged process file. The private review UI shows part-level responsibility and offers a text report from already authorized evidence; this is a manual team declaration, not ELMA authorship, contractual liability or a deployment package.

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
- `prepare(id, owner, {kind, snapshot, expectedRevision, sameSourceConfirmed: true, ...attribution})` captures a partial `change` (team/taskRef) or full `reconciliation` (baselineOwner). It persists an immutable original and proposal before returning review evidence. Attribution is pinned during preparation, not supplied again during acceptance. Unsupported evidence remains inspectable but cannot be accepted. Same-Source confirmation is recorded against the accepted baseline ID and included in the reviewed digest. When both the workspace's first known accepted Source and the incoming snapshot have stored connection references, differing references are rejected, even after an intermediate manual baseline. A manual upload has no proven connection identity; its confirmation is an owner assertion, not live verification.
- Preparation additionally accepts optional `base: {artifactId, revision, confirmed: true}`. This is the explicitly declared original full artifact on which the incoming change/full snapshot was based, separate from the current baseline used for comparison and `sameSourceConfirmed`. The selected artifact must already be accepted in this exact lifecycle root, have explicit full scope and matching snapshot/original checksum, and match its recorded acceptance revision (initial full = 0). Historical accepted full bases remain selectable after reconciliation. Pending, partial, foreign-root and wrong-revision references are rejected; clients cannot supply checksum, Source or declaring actor. This first MR-01 slice does not select a virtual mixed state as a full base.
- `preview(id, owner, artifactId)` reloads the saved proposal; `accept(id, owner, artifactId, {expectedRevision, reviewedDigest, reviewedBoundaryKeys?, resolutions?})` reuses the existing reducer. Changed workspace revisions make proposals stale rather than silently rebasing earlier decisions. Replays cannot accept an already consumed proposal.
- `get`, active/archived `list`, `original` and revision-guarded `setArchived` preserve history. Snapshot originals are copied independently, so project selection, reparse and deletion do not mutate or remove the managed baseline/history. This does not grant access to the former project after deletion.

Capture uses `projectStore.snapshot(projectId, owner, snapshotId)` under the project's existing serialization. The source snapshot's checksum, creation time, parser revision/version and non-secret Source reference are retained. The managed engine parses the captured original once with its current parser; that separate parser version and result are persisted, not silently regenerated when the project is reparsed or a proposal is reopened. The adapter does not claim its projection is the source snapshot's original parsed document.

### Explicit change-base evidence — MR-01 / #94

Captured artifacts retain `baseDeclaration` schemaVersion 1. An explicit
declaration has status `declared`, method `explicit-assertion`, the accepted full
artifact/revision/checksum, its captured snapshot and scope declaration, trusted
declaring actor and time. The server verifies membership/integrity/acceptance;
actual native ancestry remains `ancestryVerified: false`. A user assertion that
two exports were based on B does not prove independent edits or native authors.

Omitting `base` records `unknown` / `not-declared`. Legacy artifacts with no
recorded declaration return `unknown` / `not-recorded` in technical review and
pending/completed-review metadata; reads never rewrite records or infer ancestry.
Source equality, filename, uploader, team, current baseline, content equality and
upload order do not promote unknown ancestry. Corrections without a new explicit
base declaration also remain unknown; previous declarations are not copied by
guessing. Actual scope is still recorded independently as full/partial.

The declaration is captured before review and included in the existing whole
artifact digest; it survives acceptance, restart and original project deletion.
`prepare`, `preview`, `review`, pending state and completed review metadata expose
the same immutable evidence. Changing it invalidates the reviewed digest.
Unknown bases remain useful for the existing comparison/review lifecycle, but
do not establish eligibility for automatic three-way merge or a physical build.
Existing sequential acceptance semantics are unchanged. Partial absence still
never deletes other objects; no personal branch, semantic merge, ancestry graph,
deletion/rename operation, compiler, composed candidate or Target write is
created by base provenance alone. The bounded deletion slice below adds a
separate declaration and review gate.

## Bounded captured-component scope and explicit deletion

For a partial change, `prepare` additionally accepts `changeScope: { name,
members: [componentKey, ...], deletions: [{ key, baseDigest, confirmed: true }],
confirmed: true }`. `deletions` defaults to an empty list. Keys are exact captured
component identities, never filenames, labels or parser array positions. A scope
requires the explicit accepted full `base` declaration above. Every supplied
partial component must be in scope; each named member must be uniquely proven in
the declared base or partial capture. Unknown/duplicate component evidence blocks
the declaration. Scope names describe the assertion, not native export coverage.

The server creates `changeScopeDeclaration` with the exact base artifact,
acceptance revision, checksum, member digests and original file evidence, partial
checksum, Source/scope assertions and trusted declaring actor/time. The reducer
revalidates these bindings before preview/acceptance. Omitted and historical
scope remains `unknown`; reads never infer or backfill declarations. A declared
scope can include an absent base member without requesting its deletion.

A deletion must name an existing member of that full base, include its exact
base digest, be in the declared scope and be absent from the incoming partial.
It additionally requires the declared base to remain the current baseline and
the working member to match it. Older bases, intervening edits, unsupported,
ambiguous, duplicate or contradictory claims are blocked; MR-02 must implement
actual delete/edit conflict resolution before those cases can advance. Source
and full/partial declarations are explicit assertions, not verified native
ancestry. No Source identity is inferred from package strings or upload order.

Preview emits an explicit `component-deleted` row. Acceptance requires the exact
whole-artifact reviewed digest, current workspace revision and explicit boundary
review for each deletion. Only these declarations remove working components;
partial absence alone leaves them unchanged. The original full artifact is
preserved. Accepted declarations and deletion rows survive restart and original
project deletion in the existing artifact/review/history stores. Scope evidence
is available in preview, review and pending/completed technical metadata.

This domain/API slice adds no scope/deletion UI. Automatic merge and physical
build remain disabled (`automaticMergeEnabled: false`, `buildEnabled: false`);
a virtual removal cannot qualify as an unchanged physical export. Native part,
application or server materialization requires its own supported adapters and
release evidence. Existing process-part responsibility tracking inside complete
supplied entities remains separate and unchanged.

## Conservative three-way component plan — MR-02 / #94 (PLAN-01 P2)

`planManagedComponentMerge(state, artifact)` is a pure, deterministic helper
beside the reducer. It compares the immutable declared full base B (the
`baseDeclaration` artifact, revalidated for membership, revision, checksum and
scope), the current accepted working state A and an incoming partial C. It
returns a deeply frozen plan; it never accepts, resolves, rewrites state,
materializes bytes or enables a build (`ancestryVerified`,
`automaticMergeEnabled`, `acceptanceEnabled` and `buildEnabled` are `false`).

`inputs` binds B's artifact ID, acceptance revision, checksum, artifact digest
and declaration; A's workspace ID, revision, current baseline and canonical
digest; and C's artifact ID, checksum, whole-artifact digest and revalidated
change scope. `planDigest` covers the whole plan. `assertCurrentManagedMergePlan`
recomputes it and rejects (409) any changed revision, base, artifact, scope or
edited plan. A forged base declaration or tampered scope evidence fails closed.
Declared ancestry stays an assertion.

Rows use exact component identity, whole-component digests and validated
tombstones only:

| B / A / C evidence | Classification | Proposal |
| --- | --- | --- |
| All agree, or C has no claim and A = B | `unchanged` | keep current |
| A changed or removed, C = B or no claim | `current-only` | keep current |
| A = B, C modified | `incoming-only` | take incoming |
| A and C made the same modification | `identical` | keep current |
| A and C modified differently | `divergent` | resolution required |
| Absent in B; added only by A / only by C | `addition-current` / `addition-incoming` | keep / take |
| Absent in B; both added, same / different | `addition-identical` / `addition-divergent` | keep / resolution required |
| A = B, C tombstone | `delete-incoming` | remove |
| A removed, C tombstone | `delete-identical` | keep current |
| A modified, C tombstone | `delete-edit` | resolution required |
| A removed, C modified | `edit-delete` | resolution required |

Absence from a partial is `no-claim` and never deletes. Only a tombstone that
binds a scoped, absent member to its exact declared-base digest counts as
removal. Unlike `declareManagedChangeScope`, the plan does not reject a tombstone
whose member A has since edited; it classifies `delete-edit` instead. Each row
retains B, A (digest, team, intervention ID) and C (artifact ID, digest or
tombstone) contributions with their original file evidence.

Unknown or undeclared bases produce a `blocked` plan without rows. Duplicate
identities in any input, incoming ambiguity (including unproven identity) and an
addition beside a removal of the same service/kind involving C (a possible
rename) block the affected rows and the plan; no rename is guessed. The plan
retains B and C ambiguities and unclassified files under `unknown`. An ambiguous
capture cannot carry a validated scope, so its tombstones are not used. A Source
declaration bound to an earlier baseline fails as stale. Plan status is
`blocked`, `resolution-required` or `clear`. Even `clear` is only a proposal.

This slice stops at the plan. It has no API or UI, durable resolutions (P3),
part-level process merge or generated artifact. Disjoint process-part edits stay
whole-component `divergent`. Evidence: `node --test test/managed-merge-plan.test.mjs`
(synthetic store-backed B/A/C fixtures).

State and proposals use one atomic JSON replacement after immutable artifact writes. A failed metadata replacement leaves the previous committed state; uncommitted artifacts are not discoverable. Restart reads the persisted baseline, decisions, proposals and archive status. This is single-process atomic persistence, not multi-process locking or a guarantee against storage-device power loss. A crash can leave unreferenced staging/artifact files; they are never auto-adopted. Operator retention/cleanup remains a follow-up.

Full reads, previews and mutations verify SHA-256 for referenced accepted/pending originals. `original` verifies the selected member. List rows are metadata summaries, not an integrity/verification pass. Missing/corrupt artifacts fail closed. There are at most 50 managed workspaces per owner and 100 captured artifacts (including pending) per workspace. This bounded checkpoint does not implement discard/retention or multi-reviewer collaboration; archived records still count toward the owner limit.

## Authenticated HTTP API

All routes start with `/api/managed-workspaces`. Authentication supplies the trusted actor; request bodies cannot override it. The service enables shared access centrally, preserving original uploader/storage provenance and recording the current session actor on mutations. An unauthenticated collection returns 401; unknown workspace IDs and anonymous item requests return 404; historical records are shared across signed-in users before body parsing, method checks or artifact access. Existing Host/Origin/service-header checks run first. Writes require JSON and `X-Elma-Wiki-Request: 1`, with a 256 KiB body limit. JSON reads and original downloads use `Cache-Control: no-store`.

| Method and suffix | Request / result |
| --- | --- |
| `GET` collection | Active metadata list; `?archived=true` selects archived records. Only literal `true`/`false` is accepted. |
| `POST` collection | `{name, baselineOwner, snapshot}` -> 201 with created workspace. |
| `GET /:id` | Checksum-verified state, immutable accepted history and pending proposal metadata. |
| `POST /:id/prepare` | Storage `prepare` input above -> 201 with saved review evidence and `artifactId`. |
| `GET /:id/artifacts/:artifactId/preview` | Reload a pending comparison; stale proposals return 409. |
| `POST /:id/artifacts/:artifactId/accept` | `{expectedRevision, reviewedDigest, reviewedBoundaryKeys?, resolutions?}` -> accepted state. Attribution cannot be replaced. |
| `GET /:id/artifacts/:artifactId/original` | Checksum-verified, workspace-member original as an attachment. |
| `POST /:id/archive` | `{archived: boolean, expectedRevision}` -> archived/reopened state. |

The collection URL has no trailing slash. Snapshot inputs are explicit `{projectId, snapshotId, scope: "full" | "partial", scopeConfirmed: true}`. Preparation also requires `sameSourceConfirmed: true`; neither assertion is inferred from a filename, manifest or successful parse. Unknown input fields, forged owner/Source data and mixed operation decisions are rejected. Review must be repeated after a revision conflict; no last-write-wins fallback exists. There is no automatic project migration, Source network call, candidate composition or deployment endpoint in this API.

State/list responses expose `baselineAcceptedAt`; only full baseline creation/acceptance updates it. Legacy reconciled records without this field return null instead of an invented timestamp. List rows also include `changedComponents` (current components carrying an intervention) and `pendingCount` (including stale proposals). These are metadata summaries, not conflict or checksum verification.

## Remaining integration gates

- The shared UI provides explicit scope/Source confirmations; uncoached first use and independent product review remain separate gates. Storage receives a trusted owner, not a browser identity assertion.
- Package-level metadata/dependency reconciliation and finer component adapters where stable identity is proven. An entity projection does not represent a deployable complete package. Partial deletion uses only the bounded tombstone declaration above; general delete/edit resolution and native part deletion remain open (the three-way plan classifies them but does not resolve them).
- Candidate handoff must use #11's exact artifact/review contract and cannot construct an archive from this projection.
- Shared Solution UI, attributed Change discussion, contextual supported code and captured process/form preview are wired. Live candidate/delivery integration, independent human usability and final owner acceptance remain separate gates.

This engine does not generate or publish a deployable package. Separate delivery/bridge capabilities and their live evidence are documented in [target deployment](target-deployment.md).

## Evidence

Run `node --test test/managed-workspace-api.test.mjs test/managed-workspace-store.test.mjs test/managed-workspace.test.mjs test/managed-merge-plan.test.mjs test/project-snapshots.test.mjs test/server.test.mjs`.

Domain tests cover all eight architecture comparison cases, identity/order/path stability, original side-script/resource evidence, immutable history, review binding, stale/mixed artifact rejection and archive/reopen. Storage tests use real synthetic archives, the existing parser and project store, and temporary file-backed storage: restart, complete reconciliation lifecycle, pinned historical snapshots, owner/membership isolation, stale/concurrent decisions, attribution pinning, unsupported evidence, corrupt bytes and failed atomic writes. HTTP tests exercise the same lifecycle through a loopback server, restart/re-authentication, scope/Source assertions, foreign/malformed requests, method/Host/CSRF/JSON/body-size gates, concurrent acceptance and corruption. CI execution evidence is recorded on the PR; syntax checks alone are not a test pass. No browser, uncoached first-use, live delivery or complete #34/#33 acceptance is established by these tests.

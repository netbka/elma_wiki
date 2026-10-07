# Analyst release workspace: implementation PR plan

Date: 2026-10-07.
Status: proposed plan for review; no runtime capability is delivered by this document.
Assignment: turn the analyst portal audit into a planning PR. Implementation PRs below are proposed follow-up work, not automatic assignments or permission to operate ELMA.

## Outcome and scope

An ELMA analyst can load a DEV configuration, understand its meaningful changes, optionally make a narrowly supported correction, verify an immutable candidate, and hand it off or deliver it through an authorized path. The ordinary path requires neither an editor nor a terminal.

Visible journey: **Load DEV -> Review changes -> Verify -> Deliver**. Editing is optional inside Review; post-import verification is mandatory for a Verified outcome.

This plan extends the existing [Source/Workspace/Target architecture](../SOURCE_TARGET_GATEWAY_AND_ENGINEERING_SYSTEM.md) and [non-production E2E plan](source-target-e2e.md). It does not create a second compiler, bridge, candidate pipeline or deployment state machine. Audit method, inherited research and adversarial scenarios live in the [audit brief](../audits/analyst-release-audit-brief.md).

### Planning baseline, not deployed-state evidence

- Inspected main: `6f821b2f1bccc9592175dfdf349ad6bbd838478b` on 2026-10-07. The upload viewer exists; source/target lifecycle capabilities are documented but not proven by [STATE](../STATE.md).
- [PR #8](https://github.com/netbka/elma_wiki/pull/8) is now merged into `docs/developer-value-workflow`, at merge commit `5195b08dbb9462401ddc09e95afb50d10d9b1ede`. It was not integrated into the inspected main. Its description reports browser workspace/offline compiler work and explicitly excludes build, bridge, deployment and read-back. Those claims are not a new runtime verification.
- Refresh main, integration ancestry, open PRs and deployed commit before each implementation slice. Coordinate integration of #8 instead of copying its implementation. Do not retarget, merge or rewrite another task's branch as a side effect.
- The public static site, private upload viewer and internal release workspace are separate surfaces. No live internal session or ELMA deployment was exercised for this plan.

## Product and safety decisions

1. **Release first.** A returning analyst resumes a named release. Show source snapshot/time, explicit destination and baseline freshness, meaningful change counts, unreviewed items, blockers, responsible person and one next safe action. A new analyst sees Prepare a release and a synthetic example. Keep the Russian UI convention; the explorer and developer tools remain secondary routes.
2. **Preserve upload isolation.** One manual upload still creates one private project. A release explicitly references authorized artifacts; matching names/codes never merge projects. Initial references must remain within one owner. Shared reviewer/operator access requires an explicit tenant and authorization design before it is introduced.
3. **Three comparisons, not one vague diff.** Distinguish new DEV versus previous DEV, workspace versus imported DEV, and candidate versus target. A shared baseline enables conflict classification; without it show two-way limitations. No baseline is not No conflicts. Review acknowledgement never changes package scope.
4. **Package capabilities are explicit.** Gate inspect/compare/edit/compile/build/import/verify by package kind, component, platform/tool profile and source/target role. Start with whole approved packages. Unknown or encrypted content remains preserved and visible; changed unsupported content cannot silently become supported. Do not bypass vendor protections or build from a search index.
5. **Freeze what is approved.** Unmodified exports keep their original artifact. Supported modifications use the compatible pinned build pipeline. Review generated differences before final approval. Candidate, plan, target identity/baseline, non-secret settings and check evidence are bound by stable identifiers/hashes. Relevant changes make evidence and approval stale. TEST-to-PROD promotion keeps the tested package bytes; destination-specific plans still require fresh checks and authorization.
6. **Keep statuses truthful.** Checks distinguish Pass, Fail, Not run, Unsupported and Stale. Prepared/Handed off does not mean Deployed. Successful import does not mean Verified. UI previews distinguish schematic/synthetic output from actual ELMA runtime evidence.
7. **Target state determines dispatch.** Target identity is proven independently of package provenance or a friendly name. Recheck drift before dispatch, including native update/preserve settings in the plan. Initial live work is explicitly designated TEST only; PROD dispatch stays denied server-side.
8. **Verify the expected outcome.** Read back the target and compare supported expected source/runtime/version and approved preserved/updated scope. Normalization must be explicit and tested, not blanket suppression of histories, identifiers or resources. Unsupported verification remains unverified. A timeout is Outcome unknown until reconciled, never permission for a blind retry.
9. **Small edits are not automatically cosmetic.** Use a versioned edit allowlist and verified resource/history consistency. Required fields, bindings, conditions, permissions and process logic are not cosmetic. Unsupported changes go back to Designer. A local correction needs a tracked return-to-DEV task and divergence warning; no silent write-back.
10. **Recovery is a separate capability.** A prior package is not proof that business data or running processes can be restored. Record exact recovery scope and tested limitations. No generic rollback promise before non-production recovery evidence exists.

## Shared domain model and technical ownership

Keep the current Node application modular. Preserve original private artifacts separately from the parsed/indexed model. Select transactional durable storage when resumable review, authorization or restart-safe jobs require it; do not introduce microservices without evidence of need.

| Record | Minimum responsibility |
| --- | --- |
| Release | Stable ID, owner/scope, business intent, source/baseline references, target intent, review progress and next action. |
| Snapshot / workspace revision | Immutable original provenance and optional versioned edits, with parser/profile coverage. |
| Candidate | Frozen package artifact/hash, source revision and build provenance; never rebuilt silently after approval. |
| Deployment plan | Explicit target, baseline, capability profile, settings references, native update/preserve behavior and expected outcome. No secrets. |
| Check / approval | Exact inputs and scope, actor, tool/profile versions, time, result, evidence and invalidation reason. |
| Attempt / verification | Durable job ID, authorization, idempotency key, target/scope lock, execution evidence, read-back artifact and comparison. |

Extend [project snapshots](../contracts/project-snapshots.md), [connections](../contracts/source-target-connections.md) and [target deployment](../contracts/target-deployment.md) rather than duplicating their authority. Keep candidate lifecycle separate from individual deployment-attempt states. Extend the owning contract to cover queued/running, failed, outcome-unknown, deployed-unverified, verification-failed and verified outcomes before wiring UI success states.

For private networks, reuse the approved bridge design. Jobs authorize allowlisted operations against an exact target and candidate, not arbitrary shell commands. Credentials stay outside project data, evidence, logs and Storybook. Every reference and API action is authorized server-side.

## Proposed PR sequence

AR identifiers below are planning IDs, not already-open GitHub pull requests. Each slice must remain independently reviewable and close with evidence or an explicit blocker. Documentation and synthetic Storybook states ship with their owning slice, not as final cleanup.

| ID | Proposed PR | Depends on | Existing work to extend |
| --- | --- | --- | --- |
| AR-00 | Audit evidence and release workflow contracts | This planning PR | Audit brief; current contracts; E2E phase 1 |
| AR-01 | Release records, artifact association and baselines | AR-00 | Projects/snapshots; E2E phase 2 |
| AR-02 | Analyst landing, semantic review and resumable decisions | AR-01; UI fixtures can start after AR-00 | Existing viewer; Storybook; E2E phase 4 review surface |
| AR-03 | Immutable candidate, checks and honest handoff | AR-01 and AR-02 | Candidate lifecycle; E2E phase 5; no editor dependency |
| AR-04 | Source/TEST adapter and verified delivery | AR-03 | E2E phases 3-4 and 6-7; one shared execution path |
| AR-05 | Optional supported edits and return-to-DEV tracking | AR-04 and coordinated workspace integration | PR #8; compiler contract; E2E phase 8 |
| AR-06 | Production policy, hardening and controlled enablement | AR-04; AR-05 only for edited releases | Target contract, security model and operations runbooks |

Critical path: AR-00 -> AR-01 -> AR-02 -> AR-03 -> AR-04 -> AR-06. AR-05 is optional and must not delay the no-edit release workflow. Backend adapter work may proceed in parallel after contracts settle, but no live dispatch precedes candidate/authorization gates.

### AR-00 - audit evidence and contracts

**Deliver:** refresh the capability inventory; reproduce the current journey; record gaps with code/runtime evidence; make the package/version/operation support matrix; define release, comparison, evidence-invalidation and failure-state contracts. Resolve existing E2E and workspace ownership. Update the Storybook review manifest with explicit design-only states where unwired.

**Owners:** `docs/audits/`, existing `docs/contracts/`, `docs/STORYBOOK.md`, `storybook/`, `testing/workflows/` and the capability router.

**Acceptance:** every gap distinguishes absent from unverified; deployed commit and tested environment are recorded or explicitly unavailable; no plan or PR description is labeled reproduced; each P0/P1 maps to a later slice and test. No production access is required to finish the code/design audit.

### AR-01 - release and baseline foundation

**Deliver:** owner-scoped release records, explicit association of uploaded artifacts, immutable snapshot references, selected source/target baselines, persistent review checkpoints and concurrency revision checks. Define storage migration and backup/restore behavior without changing existing upload semantics.

**Owners:** `lib/projects.mjs`, `lib/store.mjs`, `server.mjs`, the snapshot contract and focused storage/API tests. New release-domain modules should be assigned through the router when created.

**Acceptance:** two same-named uploads remain distinct; no cross-owner reference can be created or read; original bytes and prior snapshots remain unchanged; review progress survives restart; stale concurrent writes fail clearly; missing/old baselines cannot produce a conflict-free claim. Tests cover rollback of a failed storage migration before rollout.

### AR-02 - analyst review surface

**Deliver:** release-first landing and four-stage shell; explicit comparison selector; meaningful business-object groups and supported impact classification; before/after details, exact diff/provenance, review decisions and next safe action. Hide only noise covered by tested rules. Include empty, no-op, partial/unknown, blocked, stale and read-only states and contextual help.

**Owners:** `web/dashboard.html`, `web/service.js`, `dist/app.js`, shared renderer/view-model modules and Storybook/workflow tests. Reuse current viewer navigation; do not replace the public landing with private release controls.

**Acceptance:** a representative analyst identifies source, target, blockers and next action; the proposed usability target is 20 seconds, measured rather than claimed. The no-edit path never opens an editor. Required-field/permission changes are not labeled cosmetic; target-only changes are not overwritten by an unexplained decision; reviewed items remain in scope. Keyboard, focus and non-color-only status cues work. Reload resumes decisions.

### AR-03 - candidate, verification and handoff

**Deliver:** candidate freezing, check/evidence aggregation, final generated-diff review, approval binding and invalidation. Build a private handoff bundle containing exact artifact/hash, manifest, release notes, check scope/results, target instructions, recovery limitations and a verification checklist. Label unchecked exports and unknown target readiness honestly.

**Owners:** shared candidate/check modules under `lib/`, `server.mjs`, target-deployment contract, private release UI and analyst task guides.

**Acceptance:** the no-edit candidate preserves the original artifact; no compile profile is fabricated; unsupported checks never count as passing. Candidate/settings/profile/baseline changes invalidate affected evidence. Downloaded bytes match the recorded hash. Without execution evidence, status remains Prepared/Handed off. Final approval follows final package construction. Unit/API tests exercise stale approval, absent target evidence and bundle authorization.

### AR-04 - one complete TEST delivery

**Deliver:** explicit Source and TEST connection references; approved export/import/read-back adapter; capability/identity probes; target-specific preflight; durable job queue, idempotency, target/scope locking and restart reconciliation. Provide confirmation and visible import-unverified/verification-failed/verified outcomes. Record the native update/preserve plan. Keep upload-only review usable.

**Owners:** existing connection/deployment/verification capabilities, adapter/bridge boundary, target runbook, E2E workflow tests and release UI states.

**Acceptance:** an explicitly nominated non-production solution travels DEV export -> snapshot -> candidate -> TEST -> read-back with reproducible evidence. Inject import-success-but-unapplied content and prove it never becomes Verified. Cover target drift after approval, misleading target names, partial soft updates, duplicate clicks, process restart and ambiguous timeout. PROD identity is rejected server-side. No credentials/customer exports enter Git or synthetic fixtures. Without authorized TEST access, report the live-evidence blocker; synthetic success is not a substitute.

### AR-05 - optional supported corrections

**Deliver:** coordinate integration/reuse of workspace/compiler work; allowlisted edit controls or advanced workspace entry; checkpoints, undo and exact diff; pinned compile/build profile; resource/runtime/history consistency and explicit preview limits. Reuse AR-03/04 candidate and delivery logic. Track required DEV reconciliation for every retained local correction.

**Owners:** developer-workspace/compiler capabilities, their existing contract, review UI and supported synthetic fixtures.

**Acceptance:** only a demonstrated package/version/edit combination is enabled. A label/localization change must either preserve related structures and pass TEST/read-back or remain unavailable. Binding/permission/required-field edits cannot enter the cosmetic path. Editing after approval invalidates evidence. Unknown bytes remain preserved. Hosted Wiki never executes uploaded scripts. Both unchanged and edited flows have tests.

### AR-06 - production hardening and explicit enablement

**Deliver:** approved workspace/team ownership and reader/analyst/reviewer/operator permissions; production approval policy; protected credential/bridge setup; freshness policy, concurrency and restart handling; audit retention/backup policy; recovery runbook and operational kill switch. Promote the exact TEST-verified artifact with a separately approved target-specific plan.

**Owners:** security, deployment, verification and operations capabilities; product owner decides authorization and risk policy.

**Acceptance:** negative authorization tests deny cross-owner access and unauthorized dispatch; stale target/candidate/approval cannot execute; interrupted jobs reconcile without duplicate imports; restore rehearsal proves its documented scope in TEST; manual recovery and alert ownership are defined. PROD remains disabled until the owner explicitly authorizes the designated environment after reviewing this evidence. Cosmetic editing is not a prerequisite for no-edit production promotion.

## Gates and evidence

- **G1 - useful without live credentials:** AR-01/02/03 allow upload, baseline review, resumable decisions and truthful candidate handoff without JSON/terminal use.
- **G2 - first E2E:** AR-04 proves one real TEST round trip and a deliberately failing verification. Package hash, target identity, baseline, checks, confirmation, native result and read-back comparison are linked by release/attempt IDs.
- **G3 - optional edits:** AR-05 proves the precise edit capability; no generalization to unsupported entities or versions.
- **G4 - PROD:** AR-06 satisfies approved identity/permission, artifact-continuity, drift, recovery and operations gates. Missing evidence means disabled, not a cosmetic warning.

Each implementation PR records changed boundaries, focused tests run, actual environment/tool versions, synthetic versus live evidence, limitations and rollback/recovery impact. All adversarial cases in the [audit brief](../audits/analyst-release-audit-brief.md) must have an owner and evidence before the corresponding gate passes.

Documentation follows the analyst's task: first release; understand a difference; resolve a blocker; supported correction; handoff; verify an import; recover safely. Operational guides state supported versions, prerequisites, whether they mutate ELMA, expected evidence, failures and next action. Release notes describe the business release, not the portal changelog.

## Decisions to resolve at the owning slice

| Decision | Default until resolved | Owner / gate |
| --- | --- | --- |
| Initial package/version support | One explicitly demonstrated solution/profile; read-only outside coverage | Compiler/adapter owners, AR-00/04 |
| Durable store and migration | Keep modular service; do not assume current in-memory state supports durable jobs | Storage owner, AR-01/04 |
| Shared project membership and self-approval policy | Owner-only review; no invented team access or approval claims | Product/security owners, AR-06 |
| Private network execution and credentials | Approved bridge; no credentials in project content | Connection/security owners, AR-04 |
| PROD freshness, recovery and release-window policy | PROD disabled | Product/operations owners, AR-06 |

These are implementation decisions with conservative defaults, not blockers to this planning PR. External customer/environment access is requested only by the authorized slice that needs it.

## Planning PR completion

This PR is complete when the plan and audit brief are discoverable through INDEX/ROADMAP/capability routing; existing E2E/workspace work is reconciled; dependencies, acceptance and safety gates are reviewable; and the diff contains no runtime, dependency, customer-data or deployment changes. STATE remains unchanged because no feature is implemented by planning. Merging this document does not automatically start every roadmap item or authorize production writes.

# Solution-first execution plan

Authority: [SOLUTION_FIRST_PRODUCT_PLAN.md](SOLUTION_FIRST_PRODUCT_PLAN.md), including the owner's 2026-10-08 working-configuration correction (#94 / PR #92).
Coordination: #52 / #91. This plan records required product work; individual workers claim bounded outcomes, not the whole roadmap. Current task: GitHub-only documentation and handoff; no live execution.

## Goal

Preserve the useful Solution-first review product and complete its missing path from parallel configuration changes to a working, installable, verified release. Review-only acceptance is an intermediate milestone, not the full product endpoint. Production promotion is a required product capability with separate operational authorization.

## Retained P0-P5 foundation

| Stage | Existing outcome to retain | Current follow-through |
| --- | --- | --- |
| P0 | One Solution-first authority and contradiction register | Reconcile current instructions with the owner's merge/build/release outcome; remove obsolete private-admission and business-Storybook rules |
| P1 | Shared historical/new configuration content with stable trusted actors | #55 deployed two-user/integrity evidence remains separate; no sharing checkbox or roles UI |
| P2 | Solutions home, Overview / Changes / Solution | Keep the shell; build/delivery and multi-Solution scope are contextual, not another navigation rebuild |
| P3 | Deterministic state and one next action | Extend only for actually implemented base/merge/build/dependency/verification/release states |
| P4 | Attributed Change discussion, corrections, contextual code and review | Preserve anchors and add version-bound conflict resolutions and build inputs |
| P5 | Source-bound process/form preview and explanations | Preserve uncertainty labels; preview is not native acceptance |

## P6 - mandatory working-configuration release stream

P6 may ship in bounded increments but is not optional in the full product. #94 owns merge-to-materialized-revision integration; native [elma365#60](https://github.com/netbka/elma365/issues/60) owns package/compiler/native assembly adapters; #11 owns delivery. Do not create competing state, compiler or delivery engines.

| Slice | Outcome | Dependencies / exit |
| --- | --- | --- |
| MR-01 | Explicit base/ancestry and full/partial scope for two contributors | Existing immutable store/reducer; shared-server snapshots cannot masquerade as personal deltas |
| MR-02 | Three-way semantic merge plan and durable conflict resolution | MR-01; independent changes preserved, ambiguous or conflicting changes cannot silently win |
| MR-03 | Physical native materialization from resolved inputs | MR-02 plus native adapter; preserve baseline, resources and coupled runtime; exact output traceable to decisions |
| MR-04 | Part/application/Solution/server configuration coverage and dependency closure | Start design alongside MR-01; scope expansion and global configuration accounted for; no inspection-bundle-as-release claim |
| MR-05 | Locked target profile, paid/opaque dependency and environment-binding resolution | Start alongside MR-03; official distribution or verified licensed target prerequisites, not omitted dependencies |
| MR-06 | Composed candidate integration with guarded delivery | MR-03/04/05; reuse #90 handoff design and #11 single reservation/coordinator |
| MR-07 | Actual isolated native acceptance of the combined Contracts scenario | MR-06; both changes operate together and native source/runtime/business outputs match |
| MR-08 | Controlled next-server/production promotion and recovery | MR-07 plus concrete operational permission; target-specific evidence, drift/retry/partial-failure handling |

Detailed contracts, negative cases, evidence and team boundaries: [working-configuration-release.md](plans/working-configuration-release.md).

Critical path: MR-01 -> MR-02 -> MR-03 -> MR-06 -> MR-07 -> MR-08. MR-04/MR-05 must be resolved before a candidate is eligible for MR-06/MR-07. Start with one bounded Contracts vertical slice; expand every requested output scope through its own proven adapters. Block unsupported releases without redefining the intended product as a viewer.

## P7 - product usability and final acceptance

#59/#41 remains DEFERRED at the owner's prior request. This plan does not restart the human task. On resumption, preserve its actual tested revision/observations; review the old review milestone honestly and add version-bound merge/build/release tasks when implemented. #38 is final owner acceptance, not implied by documentation, a build or a test script.

Test with an ELMA-familiar technical user and a technically literate person who did not read repository docs. They should identify bases, compare colleague changes, distinguish conflict-free from verified, resolve a conflict, see the release scope and understand whether a package is built, tested or actually released. Fix misleading UI rather than adding explanatory prose to waive the finding.

## Cross-cutting audit follow-through

The updated [GitHub audit](audits/github-enterprise-audit-2026-10-08.md) retains EW-01 through EW-11 as supporting work. EW-01 authority consistency, EW-02 behavioral B2/current-state coherence and EW-03 evidence routing accompany the affected MR slices; they are not a long governance project that must finish before useful release engineering starts. EW-04/05/06 feed MR-06/07/08. EW-07 deployed Wiki and EW-09 operational recovery proceed independently. EW-10 AI and EW-11 agent pilot do not block the core merge/build result.

## Ready, verification and completion

Before changes: record assigned outcome, owning issue, phase, capabilities/boundaries, base/head, existing owners reused and overlaps reserved in #91. Inspect current main and preserve other lanes. A new scope/architecture decision belongs to the owner; technical choices inside accepted invariants belong to the implementing agent.

For a runtime slice: focused tests prove changed invariants and crossed boundaries. Visible state changes update the production renderer and synthetic Storybook in the same task. Verify trigger/ack/pending/success/failure/retry/cancel/return and dependent state; screenshots alone are not behavior evidence. Retest affected layers after integration, without ritual full-suite reruns.

For a release: bind base and input digests, merged revision/resolutions, target profile, dependency/compiler identities, physical artifacts, review and native acceptance. Separate build success, test-install permission, business acceptance and actual deployment. A native prerequisite cannot be satisfied by synthetic evidence. A code/diagram change may require the complete affected parent route, not just the edited node.

Complete each assigned outcome with proportional evidence or a concrete blocker. An unresolved required adapter/dependency becomes assigned remedial work, not a green release or a permanent scope excuse. Incomplete parent issues stay open. Never claim a worker is running because a GitHub task exists.

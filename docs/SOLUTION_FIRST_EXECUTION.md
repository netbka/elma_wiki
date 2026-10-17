# Solution-first execution plan

Authority: [SOLUTION_FIRST_PRODUCT_PLAN.md](SOLUTION_FIRST_PRODUCT_PLAN.md), including the owner's 2026-10-08 working-configuration correction (#94 / PR #92).
Coordination: #52 / #91. This plan records required product work; individual workers claim bounded outcomes, not the whole roadmap. Implementation status below was reconciled against main `6a3467f` on 2026-10-17 using merged PR records, current code and contracts. It records merged code with synthetic evidence. It does not record deployment, live execution or native acceptance; see [STATE.md](STATE.md).

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

One status table is maintained here; detailed acceptance cases remain in the release plan. All implementation evidence below is synthetic; no live result is inferred from a merged PR.

| Slice | Implemented on main | Remaining exit / evidence |
| --- | --- | --- |
| MR-01 | Declared bases, bounded scope and evidence-bound deletion (#95/#103/#110); fixed Source pull supplies a source-sequence base (#130) | Ancestry stays unverified; pull order is not proof of independent changes |
| MR-02 | Whole-component merge and durable resolutions (#107/#111); explicit process-part merge plan (#149) | Part-merged reference records still need physical file generation; other kinds need proven part adapters |
| MR-03 | E1 schema 1.3 pin and opt-in materialization bridge (#113/#122/#127/#135); validated build route (#147) | No native build observed. Service evidence source is absent, so real builds remain blocked |
| MR-04 | Scope planner, pinned native coverage contract/catalog and composer eligibility integration (#104/#109/#133/#135/#146) | Native declaration source, observed Target preconditions and complete required global coverage |
| MR-05 | Pinned dependency-receipt contract and resolver wired into eligibility (#108/#133/#146) | Admitted native Target-profile observation and actual compatible/licensed dependency evidence |
| MR-06 | Shared delivery coordinator and composer (#117/#123); trusted freeze route (#148) | The composer calls build, then freeze, for the accepted merged revision only (build-timing decision, slice 3); native candidates retain pending import/installation evidence and are refused for non-synthetic delivery |
| MR-07 | dev2 designation, presets and normalized read-back (#118/#119/#120) | P8: physical Contracts candidate, permitted native install, read-back, affected business route and recovery; none observed |
| MR-08 | Promotion/reconciliation/retry/evidence logic (#124) and shared renderer actions (#150) | Restore rehearsal, target-specific native acceptance and concurrent-draft preservation beyond drift refusal. PROD remains refused without the separate trusted owner grant |

Detailed contracts, negative cases, evidence and team boundaries: [working-configuration-release.md](plans/working-configuration-release.md).

Critical path: MR-01 -> MR-02 -> MR-03 -> MR-06 -> MR-07 -> MR-08. MR-04/MR-05 must be resolved before a candidate is eligible for MR-06/MR-07. Start with one bounded Contracts vertical slice; expand every requested output scope through its own proven adapters. Block unsupported releases without redefining the intended product as a viewer.

## Next execution steps: P8 Contracts vertical slice

These are ordered outcomes, not claims of assigned or running workers. Coordinate claims in #91; #94 owns configuration composition, #11 delivery and [elma365#60](https://github.com/netbka/elma365/issues/60) native tooling. The existing dev2 designation is retained; it does not authorize a different candidate or PROD action.

| Order | Work and owner boundary | Exit evidence |
| --- | --- | --- |
| 1 | Native tooling (elma365#60): provide the admitted read-only `targetProfile` worker and coverage/dependency observations; Wiki: supply those observations and declarations to the existing eligibility gate | Real profile, coverage and dependency locks pass their pinned contracts; missing/stale evidence still blocks |
| 2 | Composition (#94/native): resolve recorded Contracts section ownership through supported solution management, capture fresh full baseline/changes, and generate physical files for any selected part merge | Valid native composition and immutable original inputs; no forced ownership or stripped dependencies |
| 3 | Operator/native boundary: observe the updated dev2 bridge with `--materialize`, configure the named Wiki materialization settings, and repeat metadata read-back | Actual worker health/capabilities and metadata-bearing read-back; merged configuration tooling alone is insufficient |
| 4 | Wiki integration (#94/#11): complete the eligible build-to-freeze UI path using the existing routes; separate designated test-install eligibility from release completion without weakening evidence guards | Exact physical bytes and receipt bound to inputs; synthetic candidate, stale build and unknown evidence cannot become a verified release |
| 5 | P8 native acceptance (#37/#94/#11): designate the exact candidate digest, pass existing confirmation/reservation gates, install on dev2, read back and exercise the complete affected business route, then rehearse reset/recovery | Both intended changes survive, conflicts are resolved, source/runtime and outputs match; no-op, drift, partial and unknown outcomes fail safely |
| 6 | Scope expansion / promotion (#94/#11): prove each additional required scope and destination through its own adapters, dependencies and acceptance | Target-specific evidence packet and recovery evidence; no inference of full-server support from one Contracts slice |

Steps 1-3 can progress independently where inputs permit. A process-runtime change additionally needs a proven native compiler; profile-2 edits remain unsupported by the current catalog. The recorded ownership decision and environment steps are detailed in the release plan's owner/environment gates. Live execution must follow the [target-deployment runbook](runbooks/target-deployment.md).

## P7 - product usability and final acceptance

#59/#41 remains DEFERRED at the owner's prior request. This plan does not restart the human task. On resumption, preserve its actual tested revision/observations; review the old review milestone honestly and add version-bound merge/build/release tasks when implemented. #38 is final owner acceptance, not implied by documentation, a build or a test script.

Test with an ELMA-familiar technical user and a technically literate person who did not read repository docs. They should identify bases, compare colleague changes, distinguish conflict-free from verified, resolve a conflict, see the release scope and understand whether a package is built, tested or actually released. Fix misleading UI rather than adding explanatory prose to waive the finding.

## Cross-cutting audit follow-through

The updated [GitHub audit](audits/github-enterprise-audit-2026-10-08.md) retains EW-01 through EW-11 as supporting work. EW-01 authority consistency, EW-02 behavioral B2/current-state coherence and EW-03 evidence routing accompany the affected MR slices; they are not a long governance project that must finish before useful release engineering starts. EW-04/05/06 feed MR-06/07/08. EW-07 deployed Wiki and EW-09 operational recovery proceed independently. EW-10 AI and EW-11 agent pilot do not block the core merge/build result.

## Ready, verification and completion

Before changes: record assigned outcome, owning issue, phase, capabilities/boundaries, base/head, existing owners reused and overlaps reserved in #91. Inspect current main and preserve other lanes. Owner stops follow [Owner-reserved matters and blockers](SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers); technical choices inside accepted invariants belong to the implementing agent.

For a runtime slice: focused tests prove changed invariants and crossed boundaries. Visible state changes update the production renderer and synthetic Storybook in the same task. Verify trigger/ack/pending/success/failure/retry/cancel/return and dependent state; screenshots alone are not behavior evidence. Retest affected layers after integration, without ritual full-suite reruns.

For a release: bind base and input digests, merged revision/resolutions, target profile, dependency/compiler identities, physical artifacts, review and native acceptance. Separate build success, test-install permission, business acceptance and actual deployment. A native prerequisite cannot be satisfied by synthetic evidence. A code/diagram change may require the complete affected parent route, not just the edited node.

Complete each assigned outcome with proportional evidence or a concrete blocker. An unresolved required adapter/dependency becomes assigned remedial work, not a green release or a permanent scope excuse. Incomplete parent issues stay open. Never claim a worker is running because a GitHub task exists.

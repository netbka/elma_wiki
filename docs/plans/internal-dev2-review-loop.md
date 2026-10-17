# Internal DEV -> DEV2 review loop

Date: 2026-10-17. Assignment: plan the owner's four-module workflow, reorder the roadmap and assess current agent work. Phase: design; capability: agent-system. This plan does not start workers, interrupt tasks, merge code or authorize an environment operation.

Authority: [product contract](../SOLUTION_FIRST_PRODUCT_PLAN.md#current-operating-priority-owner-2026-10-17). Scheduling: [execution plan](../SOLUTION_FIRST_EXECUTION.md) and [roadmap](../ROADMAP.md). Findings: [process audit](../audits/internal-dev2-process-2026-10-17.md). The existing [working-configuration release plan](working-configuration-release.md) continues to govern native composition and release.

## Intended working result

Developers and contractors currently change shared DEV. A full capture builds an understandable, source-bound representation of Contracts, Correspondence, Powers of attorney and Bonds. People inspect familiar screens/forms/processes, leave contextual corrections, and understand the next update. A controlled DEV2 installation and read-back establish what is actually installed. The following capture shows changes and their likely effects without requiring another review of everything.

DEV stays a read-only donor for Wiki. DEV2 is the separate validation Target. Native execution stays in ELMA. Configuration and reference evidence stays in private runtime storage; Wiki is an authenticated internal service. Public use and hosting, including Vercel, are excluded. Provider shutdown is being handled by the owner separately.

The interim path is a sequence of full DEV captures, not automatically a merge of personal branches. Use the existing unchanged-original handoff/delivery path when the full native package is eligible. Do not require an artificial two-author merge or rebuild an unchanged native export just to inspect or transfer it. Actual composed/edited packages still require materialization, dependency and native verification gates. Current P8 Contracts composition work remains useful and required for that capability.

## Two comparisons and three separate facts

| User question | Exact comparison | If evidence is absent |
| --- | --- | --- |
| What changed in DEV since our previous capture? | Previous full DEV snapshot -> new full DEV snapshot, with recorded Source and scope | Establish the first full snapshot; do not infer deletion from a partial upload |
| What will this update change on DEV2? | Last verified installed DEV2 configuration -> exact proposed configuration | Show unknown/drifted installed base; offer source comparison without calling it a deployment delta |

An accepted Wiki revision, a physical package and a verified DEV2 installation are distinct facts. A Target-profile observation identifies the environment; it does not identify the installed Solution or prove installation. Record Source capture IDs/checksums, accepted revision, artifact digest, named Target identity, delivery attempt/read-back policy/result, observed inventory, time and business-check status through existing storage/coordinator. Derive the installed-base reference from trusted read-back, not a UI assertion. A prior manual import can be reconciled through read-only export/inspection with explicit provenance; a person's statement alone cannot establish equivalence.

Each comparison is immutable and scope-bound. A later capture, external DEV2 edit, partial/unknown delivery or failed read-back cannot silently advance the verified base. Read-back success establishes observed configuration; business acceptance remains separate. Prior comparisons/context remain accessible. Version identity does not establish native authorship or independent ancestry of shared-DEV exports.

## Ordered work packages

These identifiers name outcomes, not new engines or automatically assigned tasks. Start with Contracts because P8 already supplies the native path. Inventory all four now; apply the proven renderer to Correspondence, Powers of attorney and Bonds, changing that order if the inventory reveals a prerequisite. Cross-module dependencies remain visible even outside the four-module scope.

| Package | Deliverable and reused boundary | Dependency and exit evidence |
| --- | --- | --- |
| D0 — internal boundary | Integrate PR #175 through the normal review gate; reconcile active UI/Storybook PRs with its removed public surfaces. Reuse authentication and internal deployment. | Before internal rollout. Anonymous content/public builds refused; authenticated entry/guides work. Repository guards and provider shutdown tracked separately. |
| D1 — module/capture inventory | Map four modules to actual Solution/application/object identities. Preserve full originals and inventory forms, screens/dialogs, routes, scripts, actions, permissions, integrations, resources and dependencies. Extend existing parser/source capture where needed. | First new product task. Every main item has a source reference, support state and native reference or a reason it is unavailable. Partial parsing/opaque/paid content is visible. No real exports/screenshots in Git/Storybook. |
| D2 — version/installed-base binding | Extend existing snapshot/delivery records with both comparison bases and the durable links above; expose version labels and unknown/drift states contextually. | Starts with D1 identities, alongside D3. Prove base selection across multiple captures, manual import reconciliation, drift, failed/partial/unknown delivery, restart and stale inputs. Actual read-back proves the first real base separately. |
| D3 — faithful Contracts view | Reconstruct source-defined layout, groups/tabs, controls, labels, required/read-only/visibility declarations, dialogs and actions; connect forms to process steps and preserve geometry/branches. Reuse `lib/solution-visual.mjs`, `web/visual/` and Solution pages. Provide native reference/navigation for runtime behavior that cannot safely be reconstructed. | D1 defines actual scope. Every main Contracts screen/route has a comparison against the matching native version, including relevant roles/states. Required gaps stay assigned remediation, not a green fidelity claim. No arbitrary uploaded script execution. |
| D4 — corrections survive updates | Complete the existing object/field/step comment/request journey: actor/version/anchor, requested correction, resulting change and current/stale/removed/ambiguous anchors after refresh. | Starts with existing views; final visible checks use D3. Prove comment -> request -> next capture -> linked correction, preserving history. Fixed source and native-verified business correction remain distinct. No second ticket system or DEV write-back. |
| D5 — changed-only review/impact | Keep changed-only default; add field/control/action/step before/after and explain observed changes, affected references, likely consequences and required checks. Reuse diff/request/explanation contracts. Include removed items and dependent unchanged context. | D1 identities and D2 comparison modes; develop alongside D3/D4. Second full capture shows each change once against its selected base; identical content produces no semantic change; identities/renames are not guessed. Every consequence links to evidence or is marked hypothesis/unknown. |
| D6 — native DEV2 refresh | Complete the evidence consumer/native prerequisites through #94/#11 and elma365#60. Use the existing coordinator for the exact eligible original or composed candidate. Read back, exercise affected native routes and rehearse recovery; feed the observation into D2. | Prerequisites progress now, independently of preview. Exact candidate/Target authorization and applicable gates remain. Command success alone never advances the verified base. P8 composition also proves both contributions and the complete affected parent route. |
| D7 — all four modules/repeat cycle | Apply D3-D6 to Correspondence, Powers of attorney and Bonds using the shared renderer; close module-specific parser/render/native gaps and review cross-module effects. | First and changed full captures for each module. The acceptance matrix below passes for the agreed main scope in all four. One Contracts example or synthetic fixture cannot close this milestone. |

D1 is the first new product task. D2 and the D3/D4/D5 UI stream then proceed in parallel, with D6 as the continuing native stream. D3-D5 share `web/managed/`: use one integration owner and bounded sequential edits, not three agents rewriting the same screens. D7 reuses the implementation and adds support where modules differ.

## Coverage and acceptance

Keep the real matrix privately, keyed by module, Solution/capture, object ID, screen/route, state/role and native reference revision. Track capture coverage, rendering support and native comparison separately. Include every main screen/dialog/process from the inventory and the reason any item is outside the agreed main scope. An arbitrary percentage cannot hide a required unsupported form.

Each module's completion packet establishes:

1. Full initial and second captures of the same identified Solution(s); dependencies and unknown content accounted for.
2. Familiar main forms/windows/processes with layout and declared behavior matched to the same native version, including relevant empty/error/role/conditional states.
3. A contextual comment/request on a field or step; after correction, original context and relation to the new version remain inspectable.
4. Changed-only before/after, affected unchanged context, plain explanation and required checks. No-change capture, deletion, stale anchor and ambiguous identity have honest outcomes.
5. Correct source and installed-base comparisons. Unknown/drifted DEV2 never looks synchronized; read-back advances only its exact installed scope.
6. Native installation/read-back and affected business checks for the exact candidate, including failure/retry/recovery where crossed. Synthetic tests/Storybook prove UI behavior, not native fidelity or business acceptance.

AI follows a useful deterministic D5. It may summarize evidence and suggest effects; it cannot establish facts, approve changes or send private configuration externally under this plan. Final #38 owner acceptance remains separate; this plan does not lift #59/#41's existing deferral.

## Existing work: continue, finish or defer

Checkpoint: 2026-10-17; final planning refresh at Wiki main `3b503c6` (after #176). PR/worktree activity does not prove every worker is running. The Codex task “Monitor elma-wiki progress” was active and reported checks and Contracts parent-route test preparation. No worker was stopped or redirected in this planning task.

Native code evidence: [elma365 #106](https://github.com/netbka/elma365/pull/106), [#112](https://github.com/netbka/elma365/pull/112), [#113](https://github.com/netbka/elma365/pull/113). Wiki work reviewed: [#170](https://github.com/netbka/elma_wiki/pull/170), [#175](https://github.com/netbka/elma_wiki/pull/175), [#176](https://github.com/netbka/elma_wiki/pull/176), [#177](https://github.com/netbka/elma_wiki/pull/177). These are dated inspection evidence, not a live scheduler.

| Existing work | Recommended disposition | Relation / handoff |
| --- | --- | --- |
| #170 same-team divergent merge resolution | Finish current review/checks | Prevents silent loss; retain for composed candidates. Not prerequisite for viewing ordinary full captures. |
| #175 internal-only service/replan | Finish review; prioritize integration | D0; another branch must not restore public surfaces. Owner handles provider shutdown. |
| #176 operator Target-profile refresh (`PROFILE`) | Merged during replanning at `3b503c6`; do not assign it again | Continue its successor `BUILD-EVIDENCE` (new worktree observed at final refresh). Profile alone is neither D2's installed base nor complete dependency evidence. |
| #177 Storybook smoke | Finish bounded verification task | Reconcile catalog with #175 removals and #176/new UI stories. |
| Dirty `module-names` tree | Finish names/navigation correction, then hand off to D1/D3 | Source-derived labels help. Do not hard-code four names as identity mapping or start another navigation redesign. |
| Dirty `wiki-dev2-designations-20261017-DESIGNATE` tree | Continue bounded designation persistence/security verification | Supports D6 without restarting Wiki for each designation. Preserve exact digest/Target, withdrawal/staleness, DEV refusal and operator authority. No live designation granted here. |
| Dirty `composer-build-freeze` tree | Preserve; finish/reconcile check follow-up once with coordinator | Build/freeze is merged. Compare browser/fixture work with #176; reuse or retire superseded changes with its owner, not another UI path. |
| elma365 #106/#112/#113 producer/qualification work | Already merged; continue next integration/evidence step | `targetProfile`, `buildEvidence` and fixed qualification before import exist. Records claim no live acceptance. Verify running worker/profile and wire Wiki consumer; do not reimplement a supposedly absent worker. |
| Existing P8 Contracts acceptance / monitor | Continue aligned investigation and already-authorized bounded acceptance | Evidence feeds D2/D3/D6; preserve full route/recovery checks. This plan neither cancels existing authorization nor widens it to another candidate/integration/PROD. Never interrupt a live import/recovery between dispatch and reconciliation. |
| Unassigned broad scopes/PROD, general IDE, bot-agent automation, public product | Defer new work in the first categories; exclude public work | Native adapters needed by these modules stay current. Wider required release scopes resume after D7 with their own evidence. |

Do not stop all agents. Let useful bounded work reach verification/handoff; avoid automatically chaining into the old broad roadmap. Proposed next assignments: D1, then D2 and one D3-D5 UI stream, alongside D6. This recommendation has not been sent to or applied by another coordinator.

Use existing board #91 when assigning packets: outcome, base/head, capability, shared-file reservation, acceptance evidence and concrete stop condition. Serialize integration of `server.mjs`, `lib/managed-workspace-store.mjs`, `web/managed/` and the Storybook manifest. Independent verification attaches to the resulting head, not an earlier pre-rebase report. Estimate calendar time after D1 reveals actual form/runtime coverage.

## Worktree and artifact disposition

No worktree removed. Retain the primary checkout. Module-names, DESIGNATE and composer-build-freeze have uncommitted contributions; retain with owners until merged or explicitly superseded. #170/#175/#177 and the new BUILD-EVIDENCE tree support current implementation/review; the merged PROFILE tree remains for its verifier/coordinator handoff. Their dependencies/builds/synthetic QA serve those tasks; remove these task artifacts and trees after merge/closure once private runtime data is accounted for under its retention contract.

The PROFILE verifier trees (`20450fe...-2`, `ac86468...-4`) support earlier/current-head verification handoff. PROFILE and both verifier trees are cleanup candidates after their owners confirm the merged-head handoff is complete and no unique evidence/data is needed; a clean Git status alone cannot establish this. Do not archive obsolete artifacts or discard another worker's active verification output.

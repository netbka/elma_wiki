# Baseline-first product direction

> **Supersession note (2026-10-07):** this document remains the engine/lifecycle foundation from #33. User-facing product authority is now being converged in [SOLUTION_FIRST_PRODUCT_PLAN.md](SOLUTION_FIRST_PRODUCT_PLAN.md): **Solution -> Change -> Review -> Done**, one obvious next action, identity without MVP role tiers. Where this document says Workspace or preserves owner-private behavior, treat that as implementation/domain history to reconcile through [SOLUTION_FIRST_CONTRADICTIONS.md](SOLUTION_FIRST_CONTRADICTIONS.md), not as a reason to expose those concepts in the target UI.

Foundation: [epic #33](https://github.com/netbka/elma_wiki/issues/33) and the owner's 2026-10-07 instruction to preserve its lifecycle work across parallel changes. The current user-facing authority is [SOLUTION_FIRST_PRODUCT_PLAN.md](SOLUTION_FIRST_PRODUCT_PLAN.md) / #52; the older rules below describe the domain foundation and legacy compatibility to reconcile, not a competing private-Workspace product. Final acceptance remains [#38](https://github.com/netbka/elma_wiki/issues/38) after the current convergence gates.

## One primary lifecycle

An ELMA analyst/developer works in a long-lived workspace, not a succession of unrelated uploaded files:

**Create from an explicitly full snapshot -> add partial changes -> review impact, responsibility and conflicts -> reconcile a later full snapshot -> accept the next baseline -> continue or archive/reopen.**

The overview answers: which workspace, which accepted baseline and date, what changed, what needs attention, and what to do next. Primary actions are Continue work, Upload change, Refresh full snapshot. Technical archive/JSON/Git details are secondary evidence. Desktop-first tables, trees and diffs serve the task; narrow screens must retain readable review/status.

A partial package never establishes a managed workspace. Absence from a partial package never means deletion. Baseline, changes and history remain immutable. Unknown identity/coverage remains unknown. An intervention never transfers ownership of the whole process. The virtual working state is not a deployable archive; baseline acceptance, scenario acceptance, lint/compile evidence and authorized/verified delivery are separate outcomes.

## Existing capabilities fit inside this direction

| Existing work or older assumption | Required interpretation |
| --- | --- |
| Standalone upload/viewer; "one manual upload = one project" in older file-project/snapshot contracts | Preserve independent inspection and its private data/API behavior. This describes the legacy inspection mode, not creation of managed workspaces. No automatic migration, deletion or conversion of existing uploads into full baselines. |
| #30: Learn, Code & lint, solution review | Keep public education and synthetic examples. Supported private code and solution-synchronized scenarios/issues/comments are workspace capabilities, not competing file-first lifecycles. Wiki Storybook parity alone is not solution synchronization. |
| #31: ownership/interventions | Track only the smallest stable changed elements supported by evidence; preserve untouched baseline responsibility and explicitly review crossings. |
| #11: releases/Source/Target | Reuse the existing snapshot, candidate, approval and read-back contracts. No second deployment engine and no package generation from an index or virtual overlay. |
| #19: bot/agent work | Advance the same workspace/change/candidate contracts; keep bot execution state separate from product state and retain approval boundaries. |
| Earlier audits, plans, README and current UI | Evidence of past proposals or implemented behavior, not authority to reverse #33. Preserve useful existing capabilities while integrating them into this lifecycle. |

This direction does not change access rights, grant live ELMA/PROD authority, or claim unimplemented scope detection, component semantics or collaborative review already works.

## Current delivery priority

Owner decision, 2026-10-07: Vercel/public hosting is deferred to the [long-term roadmap](ROADMAP.md#later), not part of the current milestone. Focus current delivery and acceptance on the internal baseline-first Wiki. Preserve existing static-build support and educational content, but do not start further Vercel work or treat public hosting as a dependency or acceptance gate for the internal product. Resuming it requires a new explicit owner assignment; this decision does not select or authorize any deployment host.

## Execution and acceptance order

1. **#34 / existing draft PR #32:** continue the existing engine lane; complete its domain/storage/API and snapshot association requirements before claiming an integrated foundation. Do not start a competing engine. The published engine checkpoint is not completion of #34.
2. **#35 + #36:** wire the workspace-first UI against that foundation, applying the enterprise interaction rules. **#40** accompanies changed surfaces with the same production renderers and synthetic decision/error/recovery states; it is not a separate mock UI.
3. **#37:** verify the integrated full-baseline -> partial change -> conflict -> later full reconciliation -> new baseline -> archive/reopen journey. Record browser/keyboard/reflow/large-screen evidence and uncoached first use separately from CI.
4. **#39 + #40 -> #41:** resolve and record Dyk/Wiki/older-contract contradictions; complete the inspectable Storybook environment; iterate actual integrated visual/product review -> fixes -> re-review. Do not defer all Storybook work to this final gate.
5. **#38 last:** walk the working product with the owner, record accepted/deferred gaps and explicitly approve the canonical product contract. Update this authority in place or mark it superseded by the approved contract; do not create two competing authorities.

These are dependencies, not blanket task assignments or claims that every issue has an active worker. Claim a bounded slice in its issue/PR after checking current activity; record completion or a concrete blocker. Keep #33 open until its integrated acceptance criteria are met.

## Integration rule for every later PR

State the owning issue/stage, capability boundaries, current base/head and preserved parallel work. Before merge, refresh main and other overlapping PRs; integrate their fixes without wholesale `ours`/`theirs` replacement or force-pushing someone else's branch. Preserve the newer product direction even when an older feature lands later. Unrelated security/verification fixes may proceed; this is not a blanket merge freeze.

A competing top-level lifecycle or contradictory product rule must not be silently merged. Record the conflict, affected user journey and explicit owner decision in the owning issue and update this authority in the same change. Code choices compatible with this direction do not require a new product decision. Strengthen focused domain/UI regressions for changed behavior; do not weaken checks just to merge. Changes after the final audit rerun affected acceptance evidence.

Use the repository PR template to record this review. A checklist is a review rule, **not GitHub branch protection or proof of enforcement**. This change adds no permission bypass, required check, deployment action or automated product approval.

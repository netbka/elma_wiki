# Solution-first contradiction and migration register

Status: active product-convergence register.
Date: 2026-10-07.
Authority target: SOLUTION_FIRST_PRODUCT_PLAN.md.

| Area | Existing rule / evidence | Solution-first decision | Migration / action |
| --- | --- | --- | --- |
| Primary object | Older file-project flow: one uploaded .e365 creates a private project | User-facing primary object is Solution | Keep file-project primitives only as storage/legacy inspection where needed |
| Workspace term | #33 and managed-workspace contracts use Workspace | Workspace stays internal; UI says Solution | P2 reuses the renderer/engine with Solution copy; /workspaces remains private compatibility |
| Visibility | Legacy project/release APIs are owner-scoped/private | MVP authenticated users share the approved Solution catalog and permissions | P1 uses a separate explicitly admitted catalog; old records remain private until classified and copied with approval; see contracts/shared-solutions.md |
| Authentication | Legacy login/session implied owner scope | Authentication establishes actor identity; no role tiers in MVP | P1 persists trusted actors separately from sessions and attributes catalog mutations; ACL/roles remain deferred |
| Authorship | Uploader/owner may be confused with change author | Portal actor, uploader, ELMA publisher/author and responsible person are different evidence | Store/display separately; unknown stays unknown |
| Top navigation | Projects/Releases/Flows/Storybook/Developer Workspace existed as destinations | Solutions is home; Learn is secondary | P2 enters /solutions with Overview / Changes / Solution; compatibility files are disclosed and Delivery remains contextual/deferred |
| Three-area model | #30 frames Learn / Code & lint / Review as product entries | Keep capabilities, not equal destinations | Code and Review become contextual |
| Storybook | Engineering Storybook and solution review were conflated | Storybook is engineering infrastructure; user sees Preview/Review | Shared renderer, no Storybook vocabulary in product UI |
| Release entry | #11 starts from packages/releases | Delivery is contextual to accepted Solution state | Reuse domain, change entry/navigation |
| Code workspace | Browser editor exists as distinct capability | Code belongs to supported object/change | P4 links the existing editor from checksum-bound Change context, preserves immutable exports and attributes shared working-copy mutations |
| Manual upload | Every .e365 becomes isolated project | Files are inputs to Solution lifecycle | Standalone inspection remains compatibility-only |
| Partial package | File model can make each input look complete | Partial package never means deletion or baseline | Preserve explicit scope evidence internally |
| Baseline | Engine exposes baseline as core domain object | Prefer Current/Accepted version in normal UI | Keep baseline in technical details |
| Virtual state | Engine can compute effective state | Virtual state is not automatically deployable | No Send to TEST without proven candidate path |
| Delivery | Bridge foundation may tempt early pipeline UI | TEST is a later contextual phase | P6 only; no pipeline builder/PROD |
| Comments | Some Storybook review paths use unauthenticated signatures | Product comments belong to authenticated actors | P4 reuses review event rules in the private Solution record; trusted session actors, revision gates and persistent cross-version anchors |
| Legacy private data | Existing records may contain private content | Shared catalog must not expose them by default | P1 never reads legacy roots through shared routes; inventory/classify/approve a new copy explicitly |
| Public/Vercel | Earlier work treated public portal as milestone | Internal Solution-first product is priority | No new Vercel work without owner assignment |
| Git/GitHub | Engineering uses issues/PRs | Git is implementation ledger, not user model | No PR/branch/commit language in normal UI |
| VK/agent | #19 has rich orchestration states | Agent advances same Solution/Change/Review/Delivery contracts | Keep bot execution state separate |
| Roles | Older planning implies owners/reviewers | No role hierarchy in MVP | All authenticated users same permissions; identity only for provenance |

## Migration safety rules
1. Shared visibility applies only to records explicitly admitted to the shared Solution catalog.
2. Existing owner-private uploads do not become shared merely because a new shared route exists.
3. Do not infer consent from filename, package code, uploader or matching metadata.
4. Before exposing a legacy record, classify source, sensitivity, intended Solution and migration decision.
5. Actor attribution must survive migration.
6. ELMA-native authorship/history must never be overwritten by portal actor identity.
7. Public educational surfaces never receive private Solution data.
8. Storage/index rollout must have a backout plan.

## User-language defaults
| Internal term | Normal UI term |
| --- | --- |
| Managed Workspace | Solution |
| Full Snapshot / accepted baseline | Current version / accepted version |
| Partial package / intervention | Change |
| Reconciliation | Review changes / Update current version |
| Review thread | Comment / discussion |
| Issue | Needs changes / finding |
| Candidate | Version ready for TEST |
| Target connection | TEST environment, when needed |
| Verification / read-back | Verify TEST |
| Storybook | never shown as normal product term |
| Parser report | Technical details |
| Provenance | Source details |
| Conflict object | Conflict |

## UI copy checklist
- Is the action needed in the current state?
- Can the label be a familiar verb plus familiar object?
- Would an ELMA-familiar technical user understand it without a tooltip?
- Does it expose an implementation concept unnecessarily?
- Is it primary, secondary, or should it be hidden until context requires it?
- If the user asks what it means, can the UI be simplified instead of adding help text?

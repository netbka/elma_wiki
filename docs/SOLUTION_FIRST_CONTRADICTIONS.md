# Solution-first contradiction and migration register

Status: active product-convergence register.
Date: 2026-10-07.
Authority target: SOLUTION_FIRST_PRODUCT_PLAN.md.

| Area | Existing rule / evidence | Solution-first decision | Migration / action |
| --- | --- | --- | --- |
| Primary object | Older file-project flow: one uploaded .e365 creates a private project | User-facing primary object is Solution | Keep file-project primitives only as storage/legacy inspection where needed |
| Workspace term | #33 and managed-workspace contracts use Workspace | Workspace stays internal; UI says Solution | P2 reuses the renderer/engine with Solution copy; /workspaces remains authenticated compatibility |
| Visibility | Legacy project/release APIs are owner-scoped/private | MVP authenticated users share the approved Solution catalog and permissions | Owner clarification 2026-10-08 shares all historical/new configuration content with signed-in users; centralized store policy preserves bytes, IDs and provenance; no sharing checkbox |
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
| Comments | Some Storybook review paths use unauthenticated signatures | Product comments belong to authenticated actors | P4 reuses review event rules in the shared authenticated Solution record; trusted session actors, revision gates and persistent cross-version anchors |
| Legacy private data | Existing records may contain private content | Owner explicitly chooses no private configuration mode | Legacy content routes are shared; Solution-root references remain separate and require full/partial declarations |
| Public/Vercel | Earlier work treated public portal as milestone | Internal Solution-first product is priority | No new Vercel work without owner assignment |
| Git/GitHub | Engineering uses issues/PRs | Git is implementation ledger, not user model | No PR/branch/commit language in normal UI |
| VK/agent | #19 has rich orchestration states | Agent advances same Solution/Change/Review/Delivery contracts | Keep bot execution state separate |
| Roles | Older planning implies owners/reviewers | No role hierarchy in MVP | All authenticated users same permissions; identity only for provenance |

## Migration safety rules
1. All authenticated users share configuration content, including historical uploads, under the explicit 2026-10-08 owner decision.
2. The service enables the same shared-access policy for every legacy content store; roots remain distinct for lifecycle identity.
3. Do not infer consent from filename, package code, uploader or matching metadata.
4. No per-record private/shared choice or copy is required. Preserve original storage IDs, bytes and uploader provenance.
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

## Dyk consistency pass — #39 / #36

Primary sources read at Dyk `57622c7d05ffef152db2d438a86adab0bd823015`: Experience Review, Storybook and Principles. The governing adaptation is [ENTERPRISE_REVIEW_RULES.md](ENTERPRISE_REVIEW_RULES.md). Implementation inspected through integrated Wiki #70/#71, including actual shared-catalog, review, contextual-code, source-anchor and reconciliation checks.

| Competing rules / implementation | User impact | Resolution and decision owner | Evidence / remaining gate |
| --- | --- | --- | --- |
| Older #30/#33/#52 bodies and Storybook/index copy name three global tools or Workspace home; owner #52 plan names Solution home | Users must learn internal subsystems | Solution -> Change -> Review; engine Workspace stays internal. Owner-authorized #52 plan wins. Correct Storybook/index routing; older issue text is historical. | Shared shell/next action, #63; final comprehension #59 |
| Dyk U6 phone-first RU/EN/HE; Wiki #36 desktop engineering density | Applying mobile marketing layout increases navigation and hides diffs | Owner #36 explicitly chooses desktop tables/columns with narrow readable review, keyboard/reflow/zoom; no imported locale promise | Shared tables/columns, 1920/800/390 browser checks; independent visual pass #41 |
| Dyk S1 owner/grant checks; Wiki equal authenticated MVP permissions; historical owner-scoped content | Piecemeal access changes would contradict the owner-approved policy | Owner clarification 2026-10-08 and #80 centrally share all historical/new configuration content. Preserve bytes, IDs and provenance; authentication, artifact roots and execution controls remain enforced. | #80 two-actor API/restart/integrity/attribution tests; deployed two-user verification #55 |
| Dyk T1/A1 one renderer; old Wiki text calls only the flow catalog authoritative | Product state coverage becomes unclear | Manifest maps each wired renderer to current stories; flows remain engineering scenarios. No copied production markup. | Shared managed/visual/request/release/delivery renderers; catalog/browser checks |
| Local Storybook signature vs authenticated Solution discussion | A local name could be mistaken for a verified reviewer | Separate local catalog evidence from trusted actor/change/artifact/step-bound product review | #67/#69/#70 API/browser discussion and correction checks |
| Dyk T2 current state vs old snapshot, code working copy or native simulation | An accepted review could be mistaken for delivered/native state | Commit/reload current state; keep original artifacts, working copies, local checks and observed runtime separate. Scope/Source confirmations remain deliberate safety cost (#52). | Revision/digest gates, preserved drafts, immutable captures; live candidate path #11 |
| Dyk U4 avoid known questions vs explicit archive scope/team declarations | Guessing would create deletion or authorship errors | Ask only non-inferable declarations; do not infer full scope or native authors from package provenance. Sharing is already decided by the owner and needs no per-upload question. | Full/partial tests, per-part attribution and #80 sharing-choice removal |
| Dyk review/approval/wiring/verification discipline vs treating CI or a static story as final acceptance | False completion hides usability/native delivery gaps | Use the evidence stages above without a second lifecycle; developer tests are not uncoached review. Final owner acceptance remains #38 after #59. | Automated paths pass; human gates remain open |
| Dyk A4 legacy quarantine/removal dates vs retained Wiki historical uploads | Copying a deletion deadline could destroy source evidence | Retain compatibility, original bytes and immutable history under the approved shared-content policy; sharing does not authorize deletion or a retention deadline. | #80 original-byte/provenance preservation; deployed verification #55 |
| Execution plan P1 retained the pre-#80 private-record migration gate | Contributors could reintroduce personal content visibility or a sharing checkbox | Reconcile P1 to the explicit 2026-10-08 owner decision and #80. Operational credentials and Target confirmation remain separate. | Documentation reconciled; no runtime or rollout claim |
| Dyk automatic production release policy vs Wiki unknown internal host and separate ELMA targets | Reference policy could authorize the wrong server | This owner's assigned rollout and Wiki target runbook govern; target identity/candidate/read-back must be proven. Vercel remains deferred. | No Wiki rollout or ELMA Verified claim; #11 target evidence remains separate |

Resolved documentation findings: primary Storybook entry, catalog authority, existing authenticated product discussions, and docs/index product authority. No Dyk consumer/person/messenger model or deployment policy was imported. This consistency pass does not claim blind-intent acceptance, independent browser review, live ELMA behavior or a service rollout.

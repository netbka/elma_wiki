# Enterprise product and review rules

Authority: the current [Solution-first plan](SOLUTION_FIRST_PRODUCT_PLAN.md) and owner decisions in #36/#52. These rules adapt Dyk's review mechanics; they do not import its consumer product, hosting authority or account model. Consistency findings belong in the existing [contradiction register](SOLUTION_FIRST_CONTRADICTIONS.md).

## Product review

Review the goal and next action before individual components. Keep the Solution name, current version and affected object visible. The implemented Solution -> Change -> Review journey is an intermediate milestone; the owner's #94 outcome also requires merge/conflict resolution, physical build, native verification and controlled release under the current product contract. Code, process preview and delivery stay contextual. Learn is secondary; technical evidence is disclosed when needed. Do not expose planned build/release actions as implemented.

For each important goal record actions, navigation transitions, decisions, required input and context loss. Start where the need arises. Reuse the existing contextual capability before adding a destination. Infer only facts captured evidence proves; package scope, change base, responsible team and deployment authority cannot safely be guessed. Shared configuration visibility is already decided centrally and requires no per-upload sharing question. Necessary scope/Source/Target confirmations remain deliberate interaction cost.

Desktop work may use dense tables, trees and diffs when they reduce navigation. Group by task and consequence; place decisions near the affected object. Large screens should use useful columns rather than stretched paragraphs. Narrow widths retain readable review/status and accessible table scrolling; a complete mobile engineering workstation is not required. Russian is the current product language. These are explicit enterprise adaptations from #36.

## State and action rules

- One dominant next action per primary state. Secondary inspection/download actions do not compete with acceptance.
- A successful mutation loads committed server state before presenting success. Counts, history, source context and next action use that state. Stale reviews or code buffers never appear current.
- Errors preserve entered values and saved evidence. Offer retry or refresh; revision conflicts block writes until current evidence is loaded. No optimistic acceptance or automatic deployment replay.
- Empty, loading, error, ambiguous, stale, conflict, archived and recovery states are explicit. Unsupported capabilities explain the available inspection path; disabled controls never imply capability.
- Separate manual declarations, immutable source evidence, local simulation, compiler checks, accepted review and observed ELMA runtime/delivery. Unknown identity, authors, rules and permissions stay unknown.
- Destructive, baseline-changing and deployment decisions show their consequence and bind reviewed evidence. Ordinary navigation stays reversible and direct.
- Keyboard reaches actions and scrollable evidence. After a mutation focus returns to the current heading; failures focus the error. Check reflow and zoom without page-wide overflow.

## One current review surface

Wired surfaces use the production renderer with synthetic fixture ViewModels in Storybook. The [manifest](../storybook/review-manifest.json) identifies current story/state authority and reasoned exclusions. Stories never copy markup, use customer exports or impersonate native ELMA. Workflow models explain behavior without replacing product/API evidence. Update affected fixtures and contracts in the same task.

Catalog signatures are local unauthenticated development evidence. Product discussions use trusted authenticated actors and Solution-member artifacts. All authenticated MVP actors share historical and new configuration content, including legacy project, portal, workspace and release records, under the owner's 2026-10-08 decision. Private runtime storage protects content from Git/public Learn; it is not a per-user private mode. Separate roots still enforce artifact/lifecycle identity, and operational credentials/connection controls retain their execution contract. Preserve original bytes, IDs and uploader provenance; attribute mutations to the actual actor. Portal actors and declared teams are not native authors.

## Evidence lifecycle

| Stage | Required evidence | Does not establish |
| --- | --- | --- |
| Draft | Need, source, uncertainty, bounded outcome | Accepted scope |
| Review | Inspectable current scenario and material findings | Human acceptance from a build |
| Approved | Existing owner-authorized contract or explicit new scope decision | Production authority for another target |
| Wired | Integrated implementation and affected API/renderer checks | Deployment or native behavior |
| Verified | Evidence at the claimed layer: actual browser, observed read-back, or human journey | Layers not observed |

These are evidence distinctions, not another product state machine. Completion records the actual outcome with proportional proof or the exact unmet dependency. Independent browser/human review is separate from CI. #59 requires uncoached users; #38 reserves final owner acceptance. Continue other authorized work when one gate is blocked.

## Audit record

Record intent, observed behavior, expected result, the five interaction costs, affected journey/state, governing rule, evidence and resolution. One root cause gets one finding. Fix existing capability gaps in the shared renderer, refresh fixtures and repeat the affected browser path. A new capability goes through its owning scope decision. A report, screenshot or CI result cannot close a material usability finding.

Comparison sources pinned at Dyk `57622c7d05ffef152db2d438a86adab0bd823015`: [Experience Review](https://github.com/netbka/Dyk/blob/57622c7d05ffef152db2d438a86adab0bd823015/docs/EXPERIENCE_REVIEW.md), [Storybook](https://github.com/netbka/Dyk/blob/57622c7d05ffef152db2d438a86adab0bd823015/docs/STORYBOOK.md), [Principles](https://github.com/netbka/Dyk/blob/57622c7d05ffef152db2d438a86adab0bd823015/docs/PRINCIPLES.md). Wiki's owner-authorized contract governs this repository.

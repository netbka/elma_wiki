# Solution-first execution plan

Status: current execution plan from merged PR #53 / issue #52. P0-P5 implementation is authorized; final usability/owner acceptance remains P7 / #38.
Date: 2026-10-07.
Product contract: SOLUTION_FIRST_PRODUCT_PLAN.md.

## Goal

Converge the current E365 Wiki into a simple Solution-first product without losing the useful parser, review, developer-workspace, Storybook, delivery and agent capabilities already built.

## Delivery order

### P0 - one authority
- Link the Solution-first contract from README, AGENTS and docs/INDEX.
- Mark conflicting product statements historical/superseded instead of deleting evidence.
- Maintain SOLUTION_FIRST_CONTRADICTIONS.md.
- Add one user-language table and copy checklist.

Exit: a new contributor can identify one current product truth; no current contract simultaneously claims private owner isolation and shared authenticated visibility as the intended MVP.

### P1 - identity and shared catalog foundation
- Resolve a stable application actor from trusted VK Teams sender identity.
- Persist actor identity separately from session state.
- Attribute uploads, comments, findings, review decisions and audited mutations.
- Design one explicit migration from owner-scoped storage to a shared authenticated Solution catalog.
- Keep legacy private records private until explicitly migrated.
- Keep portal actor identity separate from ELMA-native author/publisher evidence.

Exit: two authenticated users can see the same approved shared Solution record and their actions retain distinct authors; anonymous mutation is rejected; no role/ACL UI exists.

### P2 - Solution-first shell
- Replace file/capability-first landing with Solutions.
- Implement Add solution.
- Route a managed Solution to Overview / Changes / Solution.
- Show Delivery only when relevant and supported.
- Demote legacy inspection/subsystem routes from primary navigation.

Exit: first-time user sees one obvious action and an existing Solution opens into one stable context.

### P3 - deterministic next action
- Create a pure ViewModel from Solution state to attention summary + primary action.
- Cover no-source, ready, unreviewed, conflict, needs-fixes, accepted, TEST-awaiting-verification and verified states.
- Keep secondary actions visually subordinate.

Exit: every primary state has exactly one recommended next action and explicit empty/error/stale/conflict/recovery states.

### P4 - one Change review
- Consolidate diff, responsibility/boundary evidence, object context, comments, findings and decision.
- Use Comment / Needs changes / Accept change in the normal UI.
- Record actor attribution.
- Preserve discussion across revisions with stale/removed/ambiguous anchors.
- Link code editing contextually from supported objects.

Exit: reviewer can answer what changed, where, who acted, what needs attention and whether it is accepted on one screen, without Git vocabulary.

### P5 - visual Solution review
- Coordinate #51.
- Use one shared renderer for production review and Storybook fixtures.
- Reconstruct one supported process/form vertical slice.
- Distinguish source-derived, reconstructed, observed and unknown evidence.
- Anchor comments/findings to stable references.

Exit: analyst can review one supported business journey visually; Storybook remains engineering infrastructure, not a user destination.

### P6 - TEST delivery
- Coordinate #11 and existing delivery contracts.
- Expose Delivery only when a valid accepted state exists.
- Guide Send to TEST -> Verify TEST -> Done.
- Reuse bridge/read-back; do not create another deployment engine.
- PROD remains unavailable.

Exit: one explicitly authorized non-production slice reaches TEST and read-back proves the intended result; no-op/drift stays unverified.

### P7 - usability convergence
- Run uncoached review with one ELMA-familiar technical user and one technically literate user who did not read project docs.
- Record hesitation, wrong turns, misunderstood labels and dead ends.
- Fix UI before adding documentation.

Exit: users independently add/open a Solution, understand state, find/review a change, leave an attributed comment and know the next action.

## Dependency order

P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P7.
P6 is a later bounded milestone after a valid accepted state exists and must not block P0-P5/P7 usability.

## Definition of ready for implementation
- Identify phase and owning issue.
- Name affected product states and one user-facing outcome.
- Name existing renderer/domain/storage capability being reused.
- List contradictions touched from SOLUTION_FIRST_CONTRADICTIONS.md.
- State explicit non-goals.

## Definition of done
- Shared production renderer updated where UI changed.
- Storybook state updated for user-visible states.
- Focused domain/API tests.
- Browser evidence for the changed journey.
- Keyboard/focus/reflow check where relevant.
- Actor attribution checked for mutations.
- Copy reviewed against ordinary-language rules.
- No new top-level navigation concept.
- No live-ELMA claim without live evidence.
- Owning issue ends with DONE or a concrete blocker.

## Execution rule

Prefer deleting, hiding or contextualizing an existing option over adding a new navigation concept. If normal flow needs a new noun, first prove it cannot be represented with Solution -> Change -> Review -> Done.

# Integrated developer visual pass — 2026-10-08

Owning issues: #41 / #37, under the Solution-first product contract. Starting
main: `75f54dc0c1627927298505bfa3f96a34e032412a` (#73). This is a direct local
Chrome pass through the working portal, separate from GitHub CI. It is not the
independent uncoached user pass or final owner acceptance.

## Finding and fix

Intent: explore approval, return and repeat-review paths without confusing
inspection with a checked transition. The original renderer appended every
selected node to the simulated path. After approval reached the end node,
clicking the review node produced an apparent end -> review transition that
the export never declared. Re-selecting a node by keyboard also extended the
path. At 100 steps the renderer silently discarded the accumulated path.

Rule: source evidence, local simulation and unknown behavior must remain
distinct; inspection cannot invent a source relation. The shared production
renderer now starts a new path on direct selection, retains temporary values,
and extends the path only after a supported transition passes the bounded
field check. Its 100-step limit explicitly blocks further transitions without
discarding evidence. The current Happy Storybook story explains this behavior.

Interaction costs: direct selection remains one action, zero navigation
transitions, one choice, no repeated input and no loss of selected process/form
context. An explicit transition remains one action with the existing required
field evidence. Starting a new path does not require re-entering previous
fixture values.

Regression evidence: actual authenticated shared capture/review in Chrome;
mouse and Enter selections do not manufacture an edge; checked return/repeat
edges remain connected; missing required comment keeps the current step;
100 checked steps retain their path and values when the next edge is blocked.
No imported actions run and no native ELMA execution is inferred.

## Re-review

After preparing the local editor, static synthetic Learn assets and current
Storybook build, the managed Solution browser journey passed: creation,
full/partial changes, attributed finding/reply/correction, contextual editor
save/check, acceptance guards, later full reconciliation, element responsibility
and conflict/report, archive/reopen, stale/retry and 30 shared renderer states.
The captured process/form journey passed source geometry, form association,
happy/return/missing-comment checks, attributed step discussion, duplicate
identities, inert source, keyboard, 390px reflow and 200% zoom. Exact private
source search and static synthetic learning exploration also passed.

Fresh synthetic screenshots were inspected for the 1920px Solution overview,
Change findings, process-part conflict and corrected missing-comment path.
The overview has one dominant action; findings and team conflicts visibly
block acceptance; object context and attribution remain in the Solution;
the corrected local path omits the invented end -> review edge. No further
material finding was identified in these inspected states. This does not
claim exhaustive visual acceptance of every catalog state.

Local focused source/anchor/API checks: 9 passed. Catalog validation: 108
stories. Storybook build passed. Screenshots and browser JSON remain ignored
synthetic QA artifacts, not customer exports or native observations.

## Remaining gates

The local runtime access gap reported in #37 is resolved for this developer
pass. #41 remains open for independent integrated review; #59 needs the two
specified uncoached users, then #38 needs the owner's acceptance. No developer
script or screenshot supplies those people or decisions. Native history,
physical candidate/Target read-back and worker credentials retain their
separate owning issues. No service rollout or live ELMA operation was performed.

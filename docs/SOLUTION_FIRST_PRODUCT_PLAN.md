# Solution-first product plan

Status: proposed canonical product simplification for owner review.
Date: 2026-10-07.
Coordinates: #33, #35, #38, #39, #40, #41, #47, #52.

## Product sentence

E365 Wiki is a guided engineering and review system for an ELMA solution.

A user opens a familiar **Solution**, sees its current state and the one thing that needs attention next, reviews changes in context, and only when relevant proceeds to TEST delivery and verification.

The product is not presented as a Wiki, Git client, Storybook, IDE, release center, parser or deployment platform. Those are capabilities behind the Solution.

## Deliberate MVP boundary

### Shared system, identified people

For the current MVP, authentication establishes **identity, not authorization tiers**.

- Login continues through the VK Teams bot.
- The trusted bot sender identity creates/resolves the application user.
- All authenticated users see the same Solutions and have the same product permissions.
- There are no private workspaces, teams, ACL configuration, role editor or per-Solution membership rules in this milestone.
- Identity is retained so the system can show who uploaded a configuration, created/changed a review item, commented, accepted/rejected a change or performed another auditable mutation.
- Actor identity and ELMA-native author/publisher evidence are different facts and must never be silently conflated.
- Anonymous access does not gain private-system mutation rights.

Existing owner-scoped storage/API behavior is therefore legacy implementation behavior that conflicts with this target. Changing it requires an explicit migration and security review; do not merely bypass owner checks piecemeal.

Future authorization is deliberately deferred. The data model should keep stable actor IDs so permissions can be added later without rewriting authorship history.

## Borrowed interaction model

Do not invent a novel shell. Borrow mature patterns selectively:

- **Power Platform Solutions:** Solution is the familiar home object; object tree and contextual commands live inside it.
- **Salesforce DevOps Center:** changes are reviewed/promoted as work, while Git mechanics remain hidden from non-Git users.
- **GitHub pull-request review:** one change gathers diff, discussion, checks and accept/request-changes decisions.
- **OutSystems / Mendix:** application/version/environment promotion is contextual and sequential, not a separate cockpit.

Do **not** copy their administrative density, configurable pipeline builders, repository vocabulary, environment administration or large settings surfaces.

ELMA visual styling is not the target. Familiar enterprise interaction patterns are.

## Product laws

1. **Solution is home.** A user starts from Solutions, not subsystems.
2. **One obvious next action.** Every primary state has one visually dominant recommended action.
3. **Complexity follows the object.** Code belongs to a supported script/widget; comments belong to a reviewed object/change; delivery belongs to an accepted version.
4. **Use ordinary words.** Prefer Solution, Change, Review, Comment, Needs changes, Accept, Send to TEST. Hide snapshot/candidate/parser/Storybook/Git terminology unless technical evidence is explicitly opened.
5. **Show state, not instructions.** The normal screen answers where I am, what changed, whether attention is needed and what I should do next. Help text is exceptional.
6. **Progressive disclosure.** Raw JSON, archive paths, provenance internals and technical evidence are secondary.
7. **No capability dashboard.** Do not expose Code, Storybook, Releases, Connections, Flows or Parser as competing global destinations.
8. **Truth before convenience.** Unknown remains unknown; reconstructed UI is not native ELMA runtime evidence; accepted review is not verified deployment.

## User language

The domain model may retain Workspace, Full Snapshot, Baseline, Intervention, Candidate and Verification internally. The normal user model is intentionally smaller:

**Solution -> Change -> Review -> Done**

When delivery is available:

**Solution -> Change -> Review -> TEST -> Done**

Use technical domain terms only when they communicate a decision the user genuinely needs.

## Top-level information architecture

The authenticated product has one primary destination:

### Solutions

Optional educational material is a separate **Learn** surface and must not compete with active work.

Do not add top-level navigation for Projects, Workspaces, Releases, Storybook, Code, Connections, Deployments, Snapshots or Flows.

### Empty state

A first-time authenticated user should see approximately:

**Solutions**

No solutions yet.

**Add solution**

One dominant action. No architecture lesson.

### Add solution

Expose only acquisition methods that really work.

Initial milestone may contain only:

**Upload .e365**

with concise supporting text such as "Full export of the ELMA365 solution."

When a live Source path is proven, add **Load from ELMA**. Both create the same immutable source evidence downstream.

Do not ask for baseline/parser/workspace/snapshot terminology. Infer safe facts. Ask only a question that cannot safely be answered from evidence.

## Solution home

A Solution overview answers:

- which Solution is this;
- how current is the accepted source state;
- what changed;
- what needs attention;
- what is the next action.

Example state:

**CRM**

Current version: updated today 14:32

3 changes since the accepted version

1 needs attention

**Review changes**

Secondary contextual actions may include **Add change** and **Update from ELMA**.

Avoid general dashboards, charts and metric cards unless later evidence proves a real decision need.

## Inside a Solution

Target navigation:

- **Overview**
- **Changes**
- **Solution**
- **Delivery** only when delivery is relevant and supported

### Overview
State + attention + one next action.

### Changes
Human-readable changes, responsibility/boundary evidence, conflicts and review state. This is where GitHub PR interaction mechanics may be borrowed without Git vocabulary.

### Solution
Reconstructed ELMA object/process/form tree. Supported objects expose contextual actions. Code editing is an object capability, not a product area.

### Delivery
Appears only for a review state that can produce/use a valid candidate. It guides TEST promotion and verification. It is not a configurable pipeline product.

## Contextual review

For a change, gather in one place:

- what changed;
- affected objects;
- added/modified/removed/ambiguous evidence;
- responsibility/boundary crossings where proven;
- before/after or visual reconstruction;
- comments and "needs changes" findings;
- checks/evidence;
- **Accept change** or **Needs changes**.

Comments and findings record the authenticated actor.

Use **Comment**, **Needs changes**, **Accept change** in the user UI. "Issue", "PR", "Story", "review thread ID" and similar engineering implementation terms stay internal unless an advanced evidence view needs them.

## Visual reconstruction

"Storybook" is an engineering implementation/review technology, not normal product vocabulary.

A user opens a Solution/process/form/scenario and sees a **Preview** or **Review** surface reconstructed from source evidence. Clearly distinguish:

- extracted from ELMA source;
- reconstructed/simulated by this product;
- observed in native ELMA;
- unknown/unsupported.

Do not claim pixel-perfect ELMA runtime parity.

## One-next-action state map

The state machine chooses the primary action.

| Current state | Primary action |
| --- | --- |
| No Solution | Add solution |
| Solution lacks accepted full source | Upload full export |
| Accepted source, no pending change | Add change |
| Unreviewed change | Review changes |
| Boundary/conflict blocks review | Resolve conflict |
| Review has requested fixes | Review fixes |
| Change review complete, no delivery requested | Finish review |
| Valid delivery candidate and TEST enabled | Send to TEST |
| TEST delivery awaiting evidence | Verify TEST |
| Verified | Done |

Secondary actions must not visually compete with the primary action.

## MVP scope

The first product milestone should excel at:

**Load Solution -> understand it -> add a later export/change -> see what changed and whose boundary is affected -> visually review -> accept/reject -> establish the next accepted state.**

TEST delivery is the next bounded milestone and reuses the same Solution/change/review state.

### Explicit non-goals for the first milestone

- private workspaces or per-Solution ACLs;
- role/permission administration;
- Git/GitHub UI, branches or commits;
- separate Storybook UI for business users;
- separate IDE destination;
- separate Release Center;
- configurable pipelines;
- arbitrary workflow builder;
- universal dashboard;
- AI chat as primary navigation;
- user-customizable layouts;
- large Settings area;
- PROD deployment;
- claiming a virtual merged state is a deployable .e365 without proven round-trip semantics.

## Work plan

### P0 - authority and terminology

1. Make this contract, once owner-approved, the product authority referenced by README, AGENTS and docs index.
2. Build the contradiction register and mark stale file-first/private-workspace/capability-first language as legacy or superseded.
3. Define one terminology table: internal domain term vs user-facing term.
4. Add a UI copy rule/checklist: every new button must use a familiar verb+noun or established ordinary action; no invented nouns without owner approval.

### P1 - identity without authorization complexity

1. Resolve/create a stable user from trusted VK Teams bot sender identity.
2. Persist stable actor ID + safe display identity.
3. Attribute uploads, comments, findings, review decisions and mutations to actor ID.
4. Change product visibility from owner-scoped private projects to the approved shared authenticated Solution catalog in one explicit migration.
5. Preserve authorship history and distinguish uploader/reviewer from ELMA author/publisher evidence.
6. Add tests proving authenticated shared visibility, attribution, anonymous rejection and no accidental role divergence.
7. Do not add roles/ACL UI.

### P2 - Solution-first shell

1. Replace capability/file-first landing with Solutions.
2. Implement minimal empty state and Add solution.
3. Make a managed Solution the primary navigation object; retain legacy standalone inspection only as secondary compatibility where required.
4. Implement Overview / Changes / Solution; conditionally expose Delivery.
5. Remove/hide competing top-level subsystem entries from normal navigation.

### P3 - guided state and next action

1. Derive an attention/next-action ViewModel from deterministic product state.
2. Put one primary action on every Solution state.
3. Add explicit empty, ambiguous, conflict, stale and recovery states.
4. Test that each state has exactly one recommended next action and a return path.

### P4 - change review

1. Consolidate diff, responsibility evidence, visual/source context, comments and decision into one Change review.
2. Use shared actor attribution.
3. Reuse existing review primitives but rename product language to ordinary terms.
4. Preserve comments across revisions with explicit stale/removed/ambiguous mappings.
5. Keep code editing contextual to supported objects.

### P5 - reconstructed Solution review

1. Continue #51 using the same Solution shell.
2. Process/form previews are contextual views, not a new Storybook destination.
3. Anchor comments/findings to stable source/scenario/object references.
4. Keep evidence labels explicit.

### P6 - TEST delivery, later bounded milestone

1. Expose Delivery only when a valid accepted state exists.
2. Guide **Send to TEST -> Verify TEST -> Done**.
3. Reuse #11 delivery/read-back contracts; no second deployment engine.
4. No configurable pipeline UI and no PROD in this milestone.

### P7 - usability convergence

Before acceptance, test with an ELMA-familiar technical user and a technically literate user who has not read project docs.

They must be able to:
- identify how to add a Solution;
- identify current Solution state;
- find what changed;
- understand what requires attention;
- review a change;
- find a supported object's code without a global Code area;
- leave a comment and see its author;
- know the next action without documentation.

Record hesitation, wrong clicks and misunderstood labels. A button that repeatedly requires explanation is a product defect, not a documentation gap.

## Open decisions to validate before broad implementation

These require small prototypes/evidence, not architecture expansion:

1. Whether user-facing **Solution** should map one-to-one to an ELMA exported solution or can later represent a broader environment/application grouping. MVP should choose the narrowest proven meaning.
2. The smallest reliable component identity for comments/history across exports.
3. Which ELMA object types can be reconstructed usefully enough for first review; start with one process/form vertical slice.
4. Whether **Change** should be created automatically for every later full export or only when the user explicitly adds a partial package.
5. How to represent an accepted change that is understood virtually but cannot yet be safely rebuilt into a deployable package.
6. Exact VK Teams identity fields that are stable and safe to persist/display.
7. Migration treatment for existing owner-scoped private uploads when the shared catalog is enabled. Do not expose old private content merely because the new MVP is shared.
8. Whether "Accept change" or a simpler phrase such as "Looks good" tests better with the intended Russian-speaking ELMA audience. Use usability evidence, not clever terminology.

## Acceptance guardrail

Do not accept a product-shaping PR because it adds capability. Accept it only if it preserves the simple user model, reduces or does not increase navigation choice, has one clear next action, uses familiar language and does not expose implementation concepts without need.

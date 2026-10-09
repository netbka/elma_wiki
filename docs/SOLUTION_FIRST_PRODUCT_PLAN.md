# Solution-first product plan

Status: current owner-authorized product contract. Updated by the explicit owner correction on 2026-10-08, recorded in #94 / PR #92. Final acceptance and implementation evidence remain separate.
Coordinates: #52, #33, #34, #11, #38, #41, #47, #55, #59, #94.

## Product sentence and required result

E365 Wiki is a guided collaborative engineering system that compares and merges ELMA configuration changes and produces a working installable configuration for the next server and controlled production release.

A user opens a familiar Solution, understands its current state, compares independently based versions, resolves conflicts, reviews the combined result, and obtains a physical configuration whose installation and affected business behavior have been verified for an explicit target profile.

Understanding, code review, visual review and offline handoff are useful intermediate outcomes. They are not the complete product endpoint. The owner explicitly rejected treating native materialization and working release as optional features outside the product. Missing serializers, partial-package semantics, paid dependencies and platform coverage are engineering work to resolve, not a permanent viewer-only boundary.

Wiki owns the path to the working result; native execution remains in ELMA and its existing adapters. This does not require a second document-process runtime, ELMA Designer, Git host, general IDE, compiler or deployment engine.

## One user model

**Solution -> Changes -> Compare and resolve -> Review -> Build -> Verify -> Release.**

The existing Solution -> Change -> Review flow stays intact. A review-only task can finish as reviewed; it must not label a configuration released. For a release task, Done requires the working-configuration outcome and target-specific evidence. Internally retain Workspace, snapshots, baseline, interventions, candidate and delivery attempts; do not make these competing global destinations.

The primary home remains Solutions. Learn is secondary. Inside a Solution retain Overview / Changes / Solution, with contextual build/delivery when the capability actually exists. A server-wide release can select several Solutions in that context; it is not an unrelated control panel. Do not expose unsupported actions as if this contract implemented them.

## Supported output scope is a product obligation

The product must develop and verify these release scopes:

| Requested scope | Required result |
| --- | --- |
| Application part | Selected change plus complete required references and the smallest proven native import unit; show any necessary scope expansion before acceptance |
| Application | Definition, forms, scripts, processes, permissions, resources and required dependencies relevant to that application |
| Solution | Complete native package or supported package set representing the reviewed Solution |
| Server configuration | Accounted-for configuration across Solutions and global/platform configuration domains, with an executable installation plan and explicit target bindings |

A server configuration is not automatically a database/business-record/file or infrastructure backup. Required reference/configuration data must be classified explicitly rather than silently omitted. An all-Solutions inspection download is not a full deployable server configuration if it omits global configuration or paid dependencies.

One release may contain multiple intact native packages, a dependency lock, supported configuration actions and an installation/evidence manifest. Do not fabricate a universal .e365 wrapper or claim that the existing inspection container is directly importable by ELMA. Every release member must have an actual supported installation path. A partial requested scope does not authorize overwriting unrelated target content.

## Shared system, identified people

Authentication establishes identity, not authorization tiers, in the current MVP.

- Login continues through the trusted VK Teams bot identity and existing authentication contracts.
- All authenticated users share all historical and new configuration content with equal product permissions. There is no per-user private configuration mode, sharing checkbox, role editor or per-Solution membership UI in this milestone.
- Preserve original bytes, storage IDs and upload provenance in place. Separate roots protect artifact and lifecycle identity, not personal content visibility.
- Record trusted actors for uploads, changes, comments, resolutions, review decisions and releases. Uploader, declared team and ELMA-native author/publisher are distinct facts.
- Public Learn, credentials and operational connection controls remain separate. Shared content access never grants arbitrary Target execution.
- Stable actor IDs allow future authorization without rewriting history. Future role tiers remain a separate owner decision.

## Product laws

1. Solution is home; capabilities follow the object and current task.
2. Every primary state has one obvious next action and a return path.
3. Use ordinary familiar actions, not Git/parser/Storybook vocabulary in the normal UI.
4. Show current committed state consistently across lists, details, counts, history and next action. Preserve drafts and context on failure.
5. Use desktop tables, trees and diffs where they reduce work; retain readable narrow review, keyboard/focus and reflow.
6. Preserve immutable original source, reviewed decisions, physical build and evidence separately. Never build a deployable package from the sanitized search index.
7. Truth before convenience: unknown remains unknown. Review, conflict resolution, compilation, native installation, business acceptance and production readiness are separate assertions.
8. Working configuration is the required release outcome. Never release a known-broken or unverified required scope, and never downgrade the product to review-only merely because an adapter is unfinished.

## Parallel versions and merge

Canonical example: full baseline B; one developer exports Contracts changes A; another exports Contracts changes C. Establish each change's actual base and ancestry before combining it. Two exports of shared DEV may already include one another's changes; uploading them does not establish independent personal branches or authorship.

Compare B->A and B->C, using proven service/namespace/object identities and supported field/node/transition/script identities. Absence outside a declared partial scope is not deletion. An explicit supported deletion is different from an omitted object. Renames and duplicate/missing identities must not be guessed from display names.

Auto-combine proven independent changes and identical edits. Conflicting edits to the same value, delete-vs-edit, ambiguous identity, incompatible dependency/schema/permissions and uncertain behavioral combinations require an explicit resolution or additional evidence. Disjoint text edits are not proof of compatible business behavior.

The resolution produces a new immutable merged revision referencing originals, bases, selected edits, decisions and actors. No last-upload-wins overwrite, silent content loss, invented native history or automatic acceptance of AI suggestions. Invalidate affected review/build/verification when any relevant input changes.

The current reducer's conservative whole-object/whole-file conflict handling is an implementation foundation. Fine-grained merge and physical composition extend it under #94; current unsupported behavior remains blocked until its replacement is proved.

## Build and release guarantee

For every released scope, the system must establish:

- complete physical artifacts and accounted-for required configuration/dependencies;
- a pinned compiler/platform/package profile and target requirements;
- consistent source, generated executable runtime, manifests, resources, bindings and permissions;
- native validation and installation of the exact artifact on an authorized isolated matching environment;
- affected parent business-route acceptance, not just a child task finishing or import exit 0;
- exact target read-back under a versioned expected-outcome policy and no unexpected missing/changed/extra content;
- a controlled next-server promotion path, drift checks, known partial-failure behavior and verified recovery appropriate to the change.

A static check or code review cannot satisfy the whole guarantee. Evidence states what was observed for which artifact/profile. Passing on a different server does not automatically certify a new Target; recheck actual dependencies, licenses, bindings, baseline and impacted acceptance there. Prefer promoting identical frozen bytes. Necessary environment substitutions are explicit, reviewed, hashed and reverified; do not silently rebuild after acceptance.

An unmet required condition prevents release and identifies the exact remediation: resolve a conflict, add a dependency, provision a licensed module, implement a configuration adapter, correct a build or run a required scenario. Unsupported scope remains an open product-delivery gap, not a successful release with a disclaimer.

Paid modules must be handled through compatible licensed preinstallation or an authorized intact distribution/import path, with preserved references and verified target functionality. Do not remove payment flags, decrypt protected internals, invent entitlement or omit required modules to turn a failure green. Purchasing, credentials and legal distribution decisions remain owner-reserved.

Production promotion is part of the intended product. This product decision itself does not select a live host/candidate, grant credentials, or authorize a PROD write. Existing target-deployment confirmation and recovery rules remain binding. The current GitHub-only task performs no live operation.

## Review and explanation remain contextual

One Change review gathers differences, affected objects, responsibility, before/after context, comments/findings, resolutions, checks and accept/request-changes decisions. Findings keep stable source references and current/stale/removed/ambiguous states. Supported code is contextual; an edited working copy enters a release only through a reviewed build input.

The user sees process/form Preview, not an engineering Storybook destination. Distinguish source-derived, reconstructed/simulated, native-observed and unknown behavior. Production and Storybook use the same renderer with synthetic fixtures; hosted Wiki never executes arbitrary uploaded code.

Saved explanations retain sources, human edits, authors and history. Current deterministic explanation is not an external AI service. AI may assist explanation and conflict proposals only under an approved data-transfer and review policy, never inventing source truth or accepting its own proposal.

## One-next-action map

| State | Primary action |
| --- | --- |
| No Solution/full base | Add solution / load full export |
| Ready for development | Add change |
| Changes need comparison | Compare changes |
| Conflict or unknown base | Resolve conflict / establish base |
| Resolved change needs review | Review changes |
| Review requests fixes | Review fixes |
| Accepted merged revision | Build configuration |
| Required dependency/coverage missing | Resolve the named requirement |
| Built, unverified candidate | Verify configuration |
| Passed matching-profile candidate | Prepare release / choose approved destination |
| Deployment awaiting evidence | Verify target |
| Required target checks passed | Release complete |

These are product targets, not a claim that every mapped UI/API state is implemented. Keep secondary actions subordinate and disclose technical evidence progressively.

## Delivery and acceptance

Execution order is [SOLUTION_FIRST_EXECUTION.md](SOLUTION_FIRST_EXECUTION.md). Detailed merge/materialization/dependency gates are in [the working-configuration plan](plans/working-configuration-release.md), tracked by #94 and native netbka/elma365#60; #11 retains delivery ownership, #47 native history/identity evidence, and #91 coordination.

P0-P5 review implementation and an independently accepted review milestone remain valuable. They do not complete the full merge/build/release product. #59/#41 user review remains deferred by the owner's existing instruction; #38 still requires the actual integrated walkthrough. Neither this document nor CI supplies those observations.

## Non-goals and boundaries

No competing Git host, general workflow builder, second compiler/deployment engine, global IDE/Storybook/pipeline dashboard, role administration or public customer-code catalog. Native runtime stays in ELMA. No fake claims of universal export/import support, arbitrary byte merging, automatically safe rollback, unrestricted PROD writes or removal of data-retention/credential safeguards. Working configuration production is in scope; implementing it must preserve these boundaries.

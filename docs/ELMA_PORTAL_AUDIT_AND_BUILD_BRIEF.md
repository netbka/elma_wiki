# ELMA developer portal: audit and build brief

Prepared: 2026-10-07
Audience: product, design, documentation, ELMA engineering, QA, and implementation agents.
Status: research-backed recommendation plus source-level preliminary findings. This is not a completed live-browser audit or an authorization to deploy.

## Repository integration and authority

This documentation-only change preserves the review brief and makes it discoverable from [the documentation map](INDEX.md). It does not implement the recommendations, change runtime capability status, or supersede [AGENTS.md](../AGENTS.md), [the developer workflow contract](DEVELOPER_VALUE_WORKFLOW.md), [public/private deployment boundaries](PUBLIC_DEPLOYMENT.md), [Storybook authority](STORYBOOK.md), or [the source-target implementation plan](plans/source-target-e2e.md). Follow the current repository authority order when assigning implementation.

The baseline findings below remain dated observations. Proposed priorities, audience hypotheses, and acceptance targets are not measured outcomes or release claims.

## 1. Mission

Help a junior or mid-level ELMA365 developer answer:

> I have a task in an ELMA solution. Where should I look, what can I safely change, and how will I know it worked?

The two working product goals are usable developer tools and a clear route to understanding and using them. The user's second goal was not fully specified; do not invent a commercial objective or make lead capture a prerequisite.

Provide one coherent journey: understand the task -> inspect the relevant object -> choose a supported change path -> review the change -> verify the result.

Designer-first use must remain valuable. Git, a terminal, AI, and an understanding of export internals are not prerequisites for the first useful result. Keep advanced JSON, CLI, VS Code, and automation material available without putting it in every beginner's path.

## 2. Evidence baseline and limits

Repository baseline: netbka/elma_wiki at commit 6f821b2f1bccc9592175dfdf349ad6bbd838478b. The parent netbka/elma365 repository referenced this same Wiki commit when inspected.

The deployed URL recorded in GitHub is `https://elma-wiki.vercel.app`. The preceding review did not establish a live-browser audit. No deployed screenshots, Lighthouse measurements, accessibility-conformance result, or independently rerun application-test results are asserted here. This documentation PR does not claim new browser or live ELMA verification.

Inspected repository material included:

- web/index.html; lib/public-site.mjs; tools/build-public.mjs.
- dist/developer-articles.js and selected article definitions.
- docs/PUBLIC_DEPLOYMENT.md; docs/DEVELOPER_VALUE_WORKFLOW.md; docs/STATE.md; docs/STORYBOOK.md.
- package.json; tools/public-browser-check.mjs.
- Pull requests #8 and #9.
- Parent repository elma-development/README.md.

Surfaces at the original review baseline must be tracked independently:

| Surface | Evidence at baseline | Do not infer |
| --- | --- | --- |
| Public build | Static landing, guide, article pages, synthetic example tables; no upload, authentication, or backend requests | A publicly available IDE or connected workspace |
| Main private service | Manual .e365 upload, isolated projects, structural viewer; file-oriented tooling also exists | Completed source-to-target deployment |
| Browser workspace PR #8 | Open, unmerged; describes script editing, checks, diffs, checkpoints, and an offline SDK profile | Deployed functionality, real customer SDK verification, build/import readiness |
| Source/target PR #9 | Merged documentation and engineering contracts | Implemented and verified Source/Target runtime |

**PR preparation refresh (2026-10-07):** `main` still points to `6f821b2f1bccc9592175dfdf349ad6bbd838478b`. [PR #8](https://github.com/netbka/elma_wiki/pull/8) is now merged into `docs/developer-value-workflow`, with merge commit `5195b08dbb9462401ddc09e95afb50d10d9b1ede`; its target was not `main`. The original table records the earlier review state. Do not infer main-branch integration or deployment from that merge.

Refresh all refs, PR states, deployment metadata, and contracts before implementation. Do not overwrite parallel work or silently treat a plan as a completed capability.

## 3. External reference set

These are complementary reference systems, not a claim that one is an identical competitor or an objectively measured market winner.

| Reference | Relevant observed pattern | Application to ELMA portal |
| --- | --- | --- |
| XrmToolBox | Independent Dataverse tooling; categorized tool discovery; tool versions and developer documentation | A discoverable, maintained toolkit around an established enterprise platform |
| Microsoft Power Platform CLI and VS Code tools | Solution clone/unpack/pack workflows plus editor installation and CLI reference | A coherent path between low-code artifacts and conventional developer tooling |
| n8n documentation | First-workflow learning, JSON import/export, explicit limits and warnings | Task-led onboarding connected to reusable artifacts |
| Node-RED | JSON flow sharing and project/version-control workflows within a visual environment | Progressive disclosure: visual work first, source and review when needed |
| bpmn.io / bpmn-js | Try Online, a working editor/viewer, examples, embedding and extension guidance | Show the useful result before presenting internal implementation |
| Supabase documentation | Task/framework-specific starts, runnable steps, expected results, production cautions | Clear starting points and an explicit distinction between tutorial success and production readiness |
| Diataxis | Separates tutorials, how-to guides, reference, and explanation | Prevent one article collection from having to serve every reading mode |

Borrow capabilities and navigation patterns, not visual branding, platform-specific assumptions, broad vendor marketing language, or a requirement to register before seeing value.

ELMA's official documentation already describes elma365pm, package layouts, .d.ts generation, and external development workflows. It also describes limitations of extracted script files. The portal should explain its tested workflow and its version boundaries, not claim that JSON editing or external tooling was newly invented.

## 4. Product principles

1. Start with the user's task rather than the export's directory structure.
2. Show one useful result before requesting installation or a private file.
3. Keep the public learning site and the private working service visibly distinct.
4. Every important claim needs a scope: what operation, which version, what evidence, and what remains unknown.
5. A local check, a successful import, and verified runtime behavior are different results.
6. Tool results should link to explanations; explanations should link to an example or a tool.
7. Unknown or partially indexed data must remain visibly unknown, not silently disappear.
8. Unsupported changes should offer a Designer path or explain the limitation, not offer an unsafe automated shortcut.
9. Production interfaces and Storybook must use the same renderer; fixtures remain synthetic.
10. Reduce the number of disconnected concepts, not merely the number of clicks.

## 5. Target first visit

### Junior developer hypothesis

The visitor understands forms, fields, processes, and some scripts, but may not understand manifests, generated runtime, or cross-file relationships. They need a concrete task, recognizable ELMA terminology, a small example, and a safe next step.

### Mid-level developer hypothesis

The visitor wants fast field/handler lookup, exact source locations, usages and their confidence, compatibility evidence, a precise diff, installable tools, and a reproducible validation/deployment workflow.

These are hypotheses to validate with representative users, not findings from interviews already conducted.

### Homepage content hierarchy

Recommended headline: "Find where to change your ELMA365 solution."

Recommended supporting copy: "Explore forms, fields, and handlers. Understand their connections and follow a checked path to your next change."

Primary public action: "Walk through an example."
Secondary public action: "Find a recipe."
A separate "Use your own solution" action explains the private service and setup; it must not open a nonexistent upload flow on the public build.

Publish user-facing copy in Russian first, consistent with the existing portal. Keep technical identifiers unchanged. The English wording here expresses intent rather than approved Russian final copy.

A short trust statement should explain that the public example is synthetic, needs no registration, and receives no private exports. Do not imply that an uploaded archive stays on the user's computer when the private server stores it.

The visible product example should show a recognizable task:

- A form accepts a title containing only spaces.
- The developer locates the title field, its form binding, and a relevant handler.
- The portal distinguishes proven event bindings from text-only references.
- The developer sees the intended small change, the verification plan, and any unsupported step.

Provide optional views such as Form, Fields, Source, and References. A generated form preview is illustrative, not a faithful ELMA runtime or proof of permissions and RPC behavior.

Below the first section, prioritize:

- Three actual tasks: find a field; understand a handler; investigate why an update did not take effect.
- Tools with availability, prerequisites, limitations, and one relevant guide.
- The JSON/file-development path requested for the project, with field/form and relationship examples.
- Compatibility and verification evidence.
- Project history and the research narrative as optional depth.

Move detailed author-company collision explanations into the relevant compatibility context rather than making every first-time visitor read them.

## 6. Documentation architecture

Primary navigation: Start, Recipes, Tools, Reference, Search. Keep Concepts, Compatibility Lab, Research, and Changelog accessible through those sections without overcrowding the main navigation.

### Start: guided learning

A complete synthetic task with prerequisites, sequential actions, expected results, a completion condition, and a next step. Use a safe Designer-first option. Advanced file editing is a continuation, not a compulsory prerequisite.

### Recipes: solve a known problem

Examples: find a field and its form bindings; locate a handler; distinguish Context from ViewContext; understand references; diagnose a script that was not applied; compare a candidate; prepare a TEST import; assess an experimental field change.

Give users outcome names, not only internal terms such as descriptor, manifest, or runtime.

### Reference: exact contracts

Versioned package anatomy, observed schema keys, supported object types, CLI commands, diagnostics, APIs, and relationship semantics. Mark official documentation separately from observations and hypotheses. Do not present a reverse-engineered schema as an official or complete platform specification.

### Concepts and research: explain why

Explain source versus generated runtime, history markers, company/solution roles, internal versus external references, safety boundaries, and the research history. Keep long investigations out of the shortest task-completion route.

### Recipe contract

Every actionable recipe must define:

| Field | Requirement |
| --- | --- |
| Outcome | A result the developer can recognize |
| Prerequisites | Platform/tool versions, environment, permissions, files, knowledge |
| Artifact | Exact synthetic example, file names, and starting state |
| Procedure | Reproducible steps with no hidden private checkout |
| Expected result | Output, diff, UI behavior, or an explicit illustrative result |
| Evidence | Scope, date, operation, source, and test method |
| Failure handling | Common error, likely cause, next action |
| Recovery | Restore original/candidate/previous state with limits |
| Next step | Continue in Designer, inspect, edit, verify, or read exact reference |

Code blocks must say whether they are a full runnable file, a fragment, a command, or expected output. Do not make a copy button imply completeness. Supply shell-appropriate instructions where behavior differs. Keep private credentials, hostnames, configuration names, and content out of published examples.

Use meaningful evidence labels: Explained only; Synthetic test passed; Tested on named platform/tool versions; Experimental; Unsupported. Display availability separately: Public example; Private service; Local CLI; VS Code extension; Planned. Evidence is not a single maturity ladder: static, compile, import, read-back, and runtime checks are different dimensions.

### Reading and search experience

Keep the existing local table of contents. Add breadcrumbs, a stable section navigation, and sequence-aware Previous/Next links. Render source/evidence metadata currently available in article definitions. Show last verification, not merely last edit.

Search should understand Russian user terms and exact English identifiers. Include task names, field codes, CLI names, diagnostics, and known errors. Public search indexes public documentation and synthetic data only. Private project search stays within the owner's project and must not submit code or query text to external analytics.

The public build currently prohibits network connections. An initial search can use a build-time embedded index. Do not loosen CSP or connect the public build to the private API merely to add search.

## 7. Preliminary gap register

Priority here is proposed: P0 blocks the first useful journey or leaves a critical prerequisite unresolved; P1 materially impairs repeat use, trust, or maintenance. These are not claims of security incidents.

| ID | Priority | Evidence and actual behavior | Required change and acceptance |
| --- | --- | --- | --- |
| UX-01 | P0 | Public examples render synthetic object tables, with an explicit non-importable warning | Add one guided task. It must have a start, observable result, and safe next action without registration |
| UX-02 | P0 | publicTemplate maps the "Find a field" task to field-form-recipe, whose purpose is creating an experimental field/form draft | Route lookup to a lookup journey. Add a semantic destination test, not only an href-existence test |
| DOC-01 | P0 | The developer workflow contract calls for an illustrated end-to-end tutorial and identifies it as not implemented | Deliver that existing product requirement before adding unrelated articles |
| TOOL-01 | P0 | The script-roundtrip recipe requires an elma-dev checkout; the inspected implementation is in the private parent repository and the public recipe lacks a complete acquisition path | Prove clean-room execution using distributable artifacts, or clearly label the unavailable dependency and offer the supported alternative |
| DOC-02 | P1 | The public renderer offers grouped article cards and article TOCs but no site search or persistent task-oriented documentation navigation | Add search and stable navigation. Keep useful existing TOCs and status badges |
| TRUST-01 | P1 | Articles contain sources and statuses; the public renderer renders status but does not render article.sources as an evidence panel | Expose provenance and verification scope beside the recipe; retain the existing compatibility matrix |
| UX-03 | P1 | The landing includes a detailed author/installed-company collision discussion before the final developer-links section | Move the detail behind the applicable task and compatibility reference; retain a concise safety warning where relevant |
| GOV-01 | P1 | At the original review PR #8 was unmerged; the preparation refresh above records its merge into a non-main base. PR #9 and state docs distinguish design from runtime | Track shipped/main/branch/planned capability separately and generate truthful availability copy |
| QA-01 | P1 | Public browser tests check render, overflow, copy, basic focus, pages, and absence of backend calls | Add task success, correct destinations, evidence comprehension, error recovery, accessibility, and clean-install tests |
| ARCH-01 | P1 | Public behavior is derived by string replacement of an internal HTML landing; articles use embedded HTML strings | Move toward explicit mode-aware renderers and structured content incrementally, preserving outputs and security boundaries |

Additional discrepancy to reconcile: the workflow contract still mentions GitHub identity while the current service README describes email-key login and GitHub being disabled. Confirm the intended authority and update stale references. Do not re-enable an authentication mode just to match an old document.

## 8. Build shape

### Public learning layer

Keep static delivery. Include documentation, recipes, typed reference material, local search, and a synthetic guided example. Do not require a backend for learning. No private imports, project sessions, or production credentials belong here.

### Private workspace layer

Keep owner-isolated projects, immutable originals, partial-parse reports, and provenance. Build on reviewed existing workspace work rather than reimplementing an editor. Inspection remains useful without editing. Show exactly which operation is available for a particular object and environment.

### Shared domain rules

Use common packages/contracts across viewer, CLI, VS Code, and future automation adapters for object identity, JSON pointers, reference classification, diagnostics, and capability decisions. Browser/CLI/extension adapters should not independently invent different meanings for the same field.

Retain raw archive bytes and unknown parts. Represent text matches, structural references, unresolved external references, and dynamic references distinctly. Absence from a partial index is not proof of absence or safe deletion.

### Content and capability registries

Use structured content with stable IDs, task, level, prerequisites, snippet fixture, availability, applicable versions, and evidence links. Markdown plus metadata is sufficient; adopting a large framework is not a prerequisite.

A capability registry should specify operation, interface, availability, object scope, supported version combinations, required SDK, tests, limitations, and runtime evidence. Generate tool cards and badges from it, without letting marketing text promote a capability beyond its evidence.

Move command snippets into testable fixtures where practical. Avoid copying slightly different code into articles, examples, tests, and extension docs.

### Change lifecycle

Manual .e365 upload remains a valid entry.

Source or uploaded export -> immutable snapshot -> isolated working copy -> reviewed immutable candidate -> Target TEST operation -> deployed but unverified -> read-back and behavior checks -> verified for that scope.

Record source snapshot, candidate hash, platform/tool/SDK versions, target identity, declared expected change, outcomes, and unresolved checks. A source or SDK change invalidates relevant stale evidence. A successful command is not the same as observing the intended change.

Follow the existing source-target E2E implementation order and capability contracts. Do not shortcut to production deployment or mix source and target credentials. The first operational E2E should use a fake adapter and explicit TEST environment gates before authorized real testing.

### Design system and Storybook

Use the existing shared-renderer contract. Stories are a test surface for the same production components, not an alternate mock product.

Required story states include empty, loading, partial parse, missing dependency, unknown version, unavailable capability, stale SDK evidence, save conflict, auth/session failure, blocked candidate, deployment error, deployed-unverified, and verified. A success-colored state must not conceal unverified behavior.

Use synthetic fixtures only. A Storybook result proves UI behavior for that fixture, not ELMA import or runtime behavior. Interactive stories can assert user actions and results; choose the tooling compatible with the implemented stack.

## 9. Full audit execution instructions

### Phase A: establish authority and baseline

Read AGENTS.md, CLAUDE.md, .agent/capabilities.yaml, docs/INDEX.md, docs/STATE.md, current product/workflow contracts, deployment docs, and active plans. Record commit SHA and deployment version for each tested surface. Inspect active PRs, particularly the workspace lineage, before changing shared files.

Classify every claimed feature as deployed-observed, source-confirmed, branch-only, planned, or not verified. Never infer deployment from merge status, tests from a README claim, or customer success from a synthetic fixture.

### Phase B: inventory content, routes, tools, and claims

Inventory pages, navigation entries, task cards, examples, APIs, CLI entry points, extension installation steps, capability badges, and evidence panels. Build a graph from each user task to its entry point, guide, artifact/tool, expected result, and verification step.

Check orphan pages, ambiguous labels, repeated content, missing prerequisites, stale commands, private dependencies, inconsistent versions, mixed official/experimental guidance, missing source attribution, and dead ends.

### Phase C: benchmark actual comparable journeys

Re-open the primary references listed below. Walk a first-use task, a known-problem lookup, and a tool-installation or extension path. Record the entry, number of decisions, prerequisites, proof shown, and failure guidance. Do not award points for screenshots alone or imitate an enterprise vendor's sales homepage.

### Phase D: test the developer journeys

Use synthetic fixtures and a disposable private environment. Complete these tasks without hidden knowledge:

- Understand the purpose of the site and the public/private boundary.
- Find an existing field from the relevant homepage card.
- Follow its form binding and distinguish real references from text matches.
- Identify the correct handler and determine whether an event binding is established.
- Understand Context versus ViewContext in the supplied example.
- Complete the Designer-first route without Git or AI.
- Install the documented CLI/extension from a clean environment.
- Make a supported synthetic script change; inspect exact diff; restore it.
- Explain what a local check did and did not prove.
- Diagnose a missing dependency, unknown version, stale SDK profile, or changed source.
- Distinguish a successful import from verified target behavior.
- Find the rollback/recovery instructions and their limitations.

Test real deployment only when explicitly authorized and only within the approved non-production scope. Never upload a customer archive to public tools, external analytics, or Storybook.

### Phase E: quality, privacy, accessibility, and maintenance

Run the current documented test commands and record actual output, environment, and omissions. Inspect loading, errors, expired sessions, permission denial, retry, partial results, and empty states.

Audit keyboard-only operation, focus visibility, screen-reader semantics, zoom, reduced motion, code/table overflow, touch use, and mobile navigation against the chosen WCAG 2.2 AA target. Automated checks do not replace manual flow checks. Report measured performance, caching, payloads, and layout shifts only when measured.

Check public artifacts for private data and internal endpoints. In the private service, review owner checks, original preservation, archive limits, unknown fragments, candidate immutability, SDK provenance, credential storage, telemetry, and safe failure behavior. Verify source-derived claims through tests before calling the audit complete.

Check content ownership, version review triggers, stale-page detection, license and redistribution prerequisites for public tools/SDK/compiler artifacts, and dependency/security maintenance. A tool described in a private repository is not automatically a releasable public dependency.

### Phase F: issue format

Every gap must record:

ID; affected persona and task; surface; route; commit/file or deployed evidence; actual behavior; expected behavior; reproduction; severity; confidence; root cause; proposed fix; responsible role; dependencies; acceptance test; regression risk; state.

Use evidence categories: observed in browser; confirmed in source; reported by project documentation; hypothesis; not verified. Missing evidence is not a failed test, and inaccessible deployment is not proof the site is down.

### Phase G: required outputs

Produce:

- Evidence-backed audit and benchmark comparison.
- Task/route/content/capability inventory.
- Prioritized gap register, with existing work identified rather than duplicated.
- Proposed homepage, documentation navigation, and one canonical tutorial specification.
- Capability/evidence model and content-authoring contract.
- Incremental implementation plan mapped to current contracts and active PRs.
- Browser, accessibility, privacy, clean-install, and snippet-test plans.
- Usability-test script and baseline measurements.

Do not merge code, publish claims, connect production, or deploy merely as part of the audit. Implementation requires the relevant user authorization and repository workflow.

## 10. Proposed acceptance targets

These are initial product targets to validate, not measured current outcomes or universal industry benchmarks.

Run an initial pilot with three junior and three mid-level ELMA developers; keep failures and qualitative observations rather than treating six people as statistically representative.

- After brief homepage exposure, at least five of six can explain the portal's purpose and identify the appropriate starting action.
- At least five of six complete the guided lookup task unaided and do not enter an experimental modification route by accident.
- The first guided example requires no private archive, login, Git, or AI.
- Participants can explain whether a result is illustrative, locally checked, deployed, or verified on a target. Misunderstanding deployment safety blocks release regardless of aggregate usability score.
- Every public runnable recipe can be completed using its documented public prerequisites in a clean supported environment; exceptions are visibly non-runnable research material.
- Each tool has an installation/acquisition path, scope, version information, and a troubleshooting route.
- Each promised task has a semantic navigation test and a verifiable completion state.
- Public releases retain zero private-service network calls unless an explicit architectural decision changes that boundary.
- No keyboard blocker remains in the primary tasks; accessibility claims reflect the actual tested scope.
- Every current P0 is resolved or the corresponding promise/action is removed until it is supportable.

Track useful completions and successful recovery rather than page-view totals. Private query text, source, file names, and customer identifiers must not become analytics payloads. Any new telemetry requires an explicit privacy decision; absence of telemetry should not block manual research.

## 11. Delivery sequence

### Slice 1: coherent public journey

Correct task destinations, create the canonical guided synthetic example, clarify public/private use, and expose a useful result on the homepage. Preserve the dedicated file-development path, but make it an optional progression.

### Slice 2: repeat-use documentation and tools

Add navigation/search, evidence panels, clean installation paths, tested snippets, a tool catalog, and the highest-value recipes. Refactor content and renderer duplication only as required to support these changes.

### Slice 3: private supported editing

Review and reconcile the PR #8 workspace lineage with current main and the source-target contracts; recheck its base branch and integration status first. Integrate only supported editing and checks, with exact diffs, restore, conflict handling, and scoped evidence. Do not label it a universal ELMA IDE.

### Slice 4: verified non-production lifecycle

Implement the planned source-target chain in its approved order: engineering skeleton, snapshots, adapter/fake adapter, source import, candidate, Target TEST, read-back, then supported editor integration. Advanced structural editing, production automation, and broader extension/plugin ecosystems follow evidence, not precede it.

The first release should prove one complete useful journey rather than present more disconnected features.

## 12. Primary-source register

URLs are retained from the 2026-10-07 research brief for direct reuse by the audit team. This documentation PR does not independently re-verify external vendor behavior or every reference URL. Re-open the primary sources and confirm current behavior and version applicability during the full audit.

### Comparable systems and documentation

- XrmToolBox home: `https://www.xrmtoolbox.com/`
- XrmToolBox catalog: `https://www.xrmtoolbox.com/plugins/`
- XrmToolBox developer docs: `https://www.xrmtoolbox.com/documentation/for-developers/`
- Power Platform solution CLI: `https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution`
- Power Platform VS Code installation: `https://learn.microsoft.com/en-us/power-platform/developer/howto/install-vs-code-extension`
- n8n documentation: `https://docs.n8n.io/`
- n8n first workflow: `https://docs.n8n.io/build-your-first-workflow`
- n8n JSON import/export: `https://docs.n8n.io/build/manage-workflows/export-and-import`
- Node-RED import/export: `https://nodered.org/docs/user-guide/editor/workspace/import-export`
- Node-RED projects: `https://nodered.org/docs/user-guide/projects/`
- bpmn-js toolkit: `https://bpmn.io/toolkit/bpmn-js/`
- bpmn-js walkthrough: `https://bpmn.io/toolkit/bpmn-js/walkthrough/`
- Supabase getting started: `https://supabase.com/docs/guides/getting-started`
- Supabase React quickstart: `https://supabase.com/docs/guides/getting-started/quickstarts/reactjs`
- Diataxis: `https://diataxis.fr/`

### Platform and quality references

- Official ELMA package tooling: `https://elma365.com/ru/help/platform/lowcode-devops-pm.html`
- Official ELMA help entry: `https://elma365.com/ru/help/`
- W3C WCAG overview: `https://www.w3.org/WAI/standards-guidelines/wcag/`
- Storybook play functions: `https://storybook.js.org/docs/writing-stories/play-function`

### Project evidence

Use immutable links at the baseline commit for files described in Section 2:

`https://github.com/netbka/elma_wiki/tree/6f821b2f1bccc9592175dfdf349ad6bbd838478b`

- Workspace PR: `https://github.com/netbka/elma_wiki/pull/8`
- Source-target contracts PR: `https://github.com/netbka/elma_wiki/pull/9`
- Parent tooling README, private repository: `https://github.com/netbka/elma365/blob/main/elma-development/README.md`

Do not publish private parent-repository content or customer evidence as fixtures. Public evidence should be synthesized or explicitly approved and redacted.

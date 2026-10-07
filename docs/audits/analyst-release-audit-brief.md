# Analyst release workspace: audit brief

Date: 2026-10-07.
Status: audit instructions and inherited research inputs, not a completed runtime audit.
Source: the owner's analyst DEV-to-PROD portal review and the supplied ELMA_Analyst_Release_Audit_Instructions.md.
Sequencing and acceptance ownership: [implementation plan](../plans/analyst-release-workspace.md).

## Mission and authority

Evaluate the internal portal as an ELMA analyst preparing a release: load DEV, review meaningful changes, optionally make a supported presentation correction, verify and deliver. The no-edit path is primary. This brief does not authorize live writes, PROD enablement or merging another task's work.

Read [AGENTS](../../AGENTS.md), [capability routing](../../.agent/capabilities.yaml), [STATE](../STATE.md), [architecture](../SOURCE_TARGET_GATEWAY_AND_ENGINEERING_SYSTEM.md), [snapshot contract](../contracts/project-snapshots.md), [deployment contract](../contracts/target-deployment.md), [workspace contract](../contracts/developer-workspace.md), [E2E plan](../plans/source-target-e2e.md) and [Storybook authority](../STORYBOOK.md). Load deeper material only for the audited boundary. Plans do not outrank current code or reproduced behavior.

## Establish current truth

Record repository/commit, PR integration ancestry, deployed commit, environment, date and tool versions. Check the current status of workspace PR #8; it was open during the original research and has since merged into a development branch, not the inspected main. The implementation plan records that planning snapshot; refresh it before execution.

Trace `web/dashboard.html`, `web/service.js`, `dist/app.js`, `server.mjs` and the parser/storage owners. Separate the intentional public static site from the private viewer and proposed release capability. Do not report an intentionally absent public deployment control as a product defect.

Classify each capability: reproduced; implemented but unverified; reported in a PR/branch; designed only; absent; unknown. Do not infer latest DEV changes from a single file, target identity from embedded URLs, deployment from a screenshot, or applied content from an import exit code.

Create a support matrix by package kind/component, source/target role, platform/tool version and operation: inspect, compare, edit, compile, build, validate, import, verify. Include unknown/encrypted content and native update modes. Preserve unsupported content and vendor protections.

## Research-to-requirement inputs

The following are references from the prior research, not freshly reproduced vendor demonstrations in this planning PR. Revalidate relevant official pages and installed ELMA capabilities during AR-00. Record mechanism, analyst benefit, ELMA mapping, limitation and implementation dependency; do not copy vendor UI as proof of ELMA support.

| Reference | Pattern to assess | Proposed application |
| --- | --- | --- |
| [Appian Compare and Deploy](https://docs.appian.com/suite/help/26.9/direct-deployment.html) and [inspection](https://docs.appian.com/suite/help/26.9/inspect-deployment.html) | Explicit destination, inspection and final review | Guided release decisions and actionable blockers |
| [Power Platform pipelines](https://learn.microsoft.com/en-us/power-platform/alm/run-pipeline) | Preflight, settings and artifact continuity | Promote the tested package, separately approve destination settings |
| [Gearset comparisons](https://docs.gearset.com/en/articles/619012-configuring-comparisons) and [problem analyzers](https://docs.gearset.com/en/articles/625488-an-introduction-to-gearset-s-metadata-problem-analyzers) | Meaningful metadata differences and dependency findings | Object-level review; distinguish portal checks from native validation |
| [ServiceNow update-set preview](https://www.servicenow.com/docs/r/application-development/system-update-sets/t_PreviewARemoteUpdateSet.html) | Preview problems and local/remote conflicts | Target drift and explicit conflict decisions |
| [OutSystems dependencies](https://success.outsystems.com/documentation/11/deploying_apps/deploy_an_application_with_dependencies/) | Destination compatibility and dependent applications | Explain impacted objects and required follow-up checks |
| [ELMA configuration](https://elma365.com/ru/help/platform/configuration.html) and [solution update](https://elma365.com/ru/help/platform/update_solution.html) | Package distinctions, compatibility and update/preserve behavior | Versioned capability checks and expected-outcome verification |

Consult the parent repository's compiler/import investigations only for their tested scope. Do not copy private exports, credentials, customer code, hostnames or internal investigation artifacts into this public repository.

## Audit passes

### 1. First screen and normal task

Ask representative analysts to identify the release, exact source/time, destination/baseline freshness, changed/unreviewed items, blockers and next safe action without coaching. Returning users should resume; new users should prepare a release or explore a synthetic example. Measure the proposed 20-second orientation target, active working time separately from server wait, terminal dependence, errors and recovery. Do not invent usability results.

### 2. Load, compare and optional correction

Preserve upload isolation, original bytes and unknown content. Test explicit source/workspace/target comparisons and missing-baseline limits. Inspect semantic impact, exact provenance and tested noise rules. Review status must not alter package contents. Defer arbitrary selective packaging until dependency-safe round-trip support exists.

Check any cosmetic allowlist against actual package/version evidence, including related localization, runtime and history. Unsupported edits return to Designer. Require undo, final diff, preview labeling and tracked DEV reconciliation. Uploaded code is untrusted data, never an instruction or hosted execution request.

### 3. Checks, candidate and delivery

Inspect separate integrity, structure, compile, package-consistency, target-preflight, TEST and approval evidence. Each records exact inputs/scope/profile/time; unsupported or stale is not pass. Approval follows final build and expires when relevant inputs change.

Handoff exports the exact artifact and evidence without claiming deployment. Connected delivery independently proves target identity, binds authorized plan/candidate, refreshes drift and uses an allowlisted execution path. Read-back checks the approved update/preserve outcome. Record recovery limits separately from import success.

### 4. Failure behavior and access

| ID | Scenario | Required outcome | Earliest owning slice |
| --- | --- | --- | --- |
| AT-01 | Clean no-edit release | No editor/terminal; original artifact preserved | AR-01/03 |
| AT-02 | No actual change or missing baseline | Explain no-op or comparison unknown; never invent a delta | AR-02 |
| AT-03 | Same name/code uploaded twice | Separate private projects; explicit association only | AR-01 |
| AT-04 | Label/localization correction | Preserve all required related structures under a verified profile or keep editing disabled | AR-05 |
| AT-05 | Required-field, permission or binding change | Behavioral/data/access impact, not cosmetic | AR-02/05 |
| AT-06 | Missing dependency or changed unsupported component | Actionable scope and blocked unsupported promotion, never silent pass | AR-03/04 |
| AT-07 | Target changed after review | Stale checks/approval, refreshed comparison before dispatch | AR-04 |
| AT-08 | Wrong target or misleading environment name | Independently proven identity; unsafe dispatch denied | AR-04 |
| AT-09 | Candidate, profile or settings changed after approval | Invalidate relevant evidence and approval | AR-03 |
| AT-10 | Import succeeds but content is skipped | Mismatch or unverified result; never Verified | AR-04 |
| AT-11 | Native soft update preserves conflicts | Compare actual result to the approved preserved/updated scope | AR-04 |
| AT-12 | Timeout, job interruption or restart | Durable evidence and reconciliation; no blind retry | AR-04 |
| AT-13 | Double-click or concurrent release | Idempotent attempt and target/scope exclusion | AR-04 |
| AT-14 | Reader deploys or another owner's artifact ID is used | Server-side denial on every reference/action | AR-01/06 |
| AT-15 | Malformed archive, embedded instructions or secrets | Safe processing; no execution or unapproved external disclosure | AR-01/05 |
| AT-16 | Review resumes or concurrent edit occurs | Decisions persist; revision conflict is explicit | AR-01/02 |
| AT-17 | Recovery rehearsal | Prove exactly what configuration/data/process state is restored | AR-06 |
| AT-18 | TEST package promoted to PROD | Same artifact bytes; fresh destination-specific plan and authorization | AR-06 |

P0: false readiness/success, unauthorized/wrong-target write, data/secret loss or ambiguous outcome treated as success. P1: ordinary safe release flow cannot be completed reliably. P2: efficiency, polish or secondary documentation gaps. A severity describes a demonstrated finding, not an assumption that the scenario currently fails.

### 5. Documentation and visible-state coverage

Audit a synthetic first-release walkthrough and task guides for differences, blockers, supported corrections, handoff, verification and recovery. Each operational guide names scope/versions, prerequisites, whether it mutates ELMA, expected evidence, failures and next safe action. Contextual error links must retain release context. Separate release notes from portal documentation.

Use shared production renderers with synthetic Storybook data. Cover empty, loading, no-op, clean, blocked, stale, partial/unknown, read-only, approval-pending, running, outcome-unknown, imported-unverified, verification-failed and verified states. Unwired designs must be labeled; Storybook is not ELMA runtime verification. Test keyboard/focus, status announcements and severity cues independent of color.

## Required audit output

Deliver a current-versus-required capability matrix, research mapping, annotated journey, reproducible gaps, proposed contract changes, prioritized slice mapping and evidence ledger. Each finding has ID, severity, role/task, code/runtime evidence, reproduction, observed/expected behavior, risk, fix, owning capability and acceptance test.

Use synthetic fixtures in Git. Keep any authorized customer/environment evidence private, with redacted references and access controls. Missing live access is a concrete evidence limitation, not permission to claim deployment readiness. The critical E2E gate requires both a successful TEST read-back and an injected mismatch that cannot produce Verified.

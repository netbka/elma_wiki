# ELMA Wiki open work

Coordination only. Work starts from the owner request or assigned issue.

## OPEN
- Source/Target E2E phase 2 snapshot storage and explicit snapshot selection for release inputs are implemented. Next: authorize named Source references through an approved adapter/bridge, then wire import and project-viewer selection UI. No live Source load is proven.
- Analyst release offline milestone is implemented for review: explicit upload/baseline pinning, owner-only resumable decisions and unchanged-original candidate/handoff. See contracts/analyst-releases.md. Supported widget-script edits (AR-05, PR #125) are implemented as review-only: an edited candidate is not deployable until native build exists. Production gates remain open.
- AR-04 delivery: lifecycle, guards, read-back verification and the `/releases` delivery UI are implemented against a synthetic Target (contracts/target-deployment.md). The operator bridge adapter (`elma-dev bridge`; tokens and `elma365pm` stay on the operator machine) is implemented and exercised read-only against dev2. On 2026-10-14 the owner designated dev2 as the non-production Target for PLAN-01 P8 acceptance of the Contracts candidate only (recorded by PR #118 in [SOLUTION_FIRST_PRODUCT_PLAN.md](SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers)). Predefined DEV/DEV2 Targets (PR #119) and `import-normalized-v1` read-back for a designated DEV2 candidate (PR #120) are implemented with synthetic evidence only. No live deploy has run.
- PLAN-01 P8 (#94 MR-07, #11 live delivery): P1-P7 are merged (PRs #95, #103, #104, #107-#111, #113, #117), as are the composer screen (#123), MR-08 promotion/recovery logic (#124), the E1 pin (#122) and the bridge `materialize` transport (#127); see STATE. In elma365, the read-back `metadataFiles` fix (#100), E1 revision 1.2 (#99) and an offline E1 executor (#101) are merged. Nothing has run live. Remaining P8 blockers:
  - operator: restart the dev2 bridge worker from merged elma365 main with `--materialize` (elma365 PR #102, `materialize` job and dev2 check runners), set `WIKI_NATIVE_MATERIALIZATION_*` on the Wiki service and repeat read-back with the updated worker ([required fields](contracts/target-deployment.md#read-back-metadata-bytes)); no Wiki route calls the materialization adapter yet;
  - the Contracts section-ownership conflict (elma365 E3) needs an owner/composition decision;
  - real dev2 exports of the Contracts baseline and changes;
  - P4/P5 native coverage and dependency receipt contracts (in progress in elma365); until then real coverage and dependency evidence fail closed;
  - manifest regeneration policy v2;
  - a process-runtime compiler;
  - then a designated candidate SHA-256 in `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` on the running service, and the live evidence gate G2: install, read-back, affected business checks and reset/recovery on dev2.
- Source -> Workspace -> Target E2E implementation - plans/source-target-e2e.md.
- Extend workflow Storybook to existing public/auth/viewer renderers and authenticated remote collaboration when assigned.
- Analyst release workspace - [proposed PR sequence](plans/analyst-release-workspace.md) and [audit brief](audits/analyst-release-audit-brief.md). Extends the existing E2E. Offline review/handoff, synthetic delivery UI, composed-candidate delivery (PRs #117, #123), review-only supported edits (PR #125) and API-only promotion/recovery logic (PR #124) are implemented; real TEST delivery, native build of edited candidates and production enablement remain open. No-edit review/handoff precedes TEST delivery and optional edits.
- Create ELMA-specific Product Constitution + executable Principles as a separate product-authority task.
- Supported Developer Workspace/compiler edits are integrated into the release review and candidate lifecycle as review-only (PR #125). Open: native build of edited widget descriptor/runtime, so an edited candidate can become deployable.
- VK Teams request-to-Dev2 agent delivery - plans/vk-teams-agent-delivery.md; proposed six-PR implementation plan, not a connected bot or deployment authorization. User conversation: workflows/vk-teams-agent-delivery.md.

## LATER
- Long-term / deferred: public Vercel hosting, promotion and further public-site delivery work. Owner decision, 2026-10-07: Vercel is not relevant to the current milestone. Prioritize the internal baseline-first Wiki; Vercel availability or deployment is not a blocker or acceptance requirement for it. Retain the existing static build/configuration and educational content; resume hosting work only after a new explicit owner assignment. Reference: [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md).
- VS Code client over shared Developer Core.
- richer trace/replay and custom component framework research.
- PROD deployment policy after TEST E2E is proven; use AR-06 in the analyst plan for explicit permission, drift, recovery and operational gates. The coordinator's promotion, drift and recovery logic and the owner-grant hook exist (PR #124), but no grant is wired, so PROD remains disabled until separately authorized.

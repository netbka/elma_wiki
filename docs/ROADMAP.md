# ELMA Wiki open work

Coordination only. Work starts from the owner request or assigned issue.

## OPEN
- Source/Target E2E phase 2 snapshot storage and explicit snapshot selection for release inputs are implemented. Next: authorize named Source references through an approved adapter/bridge, then wire import and project-viewer selection UI. No live Source load is proven.
- Analyst release offline milestone is implemented for review: explicit upload/baseline pinning, owner-only resumable decisions and unchanged-original candidate/handoff. See contracts/analyst-releases.md. Optional edited candidates and production gates remain open.
- AR-04 delivery: lifecycle, guards, read-back verification and the `/releases` delivery UI are implemented against a synthetic Target (contracts/target-deployment.md). The operator bridge adapter (`elma-dev bridge`; tokens and `elma365pm` stay on the operator machine) is implemented and exercised read-only against dev2. On 2026-10-14 the owner designated dev2 as the non-production Target for PLAN-01 P8 acceptance of the Contracts candidate only (recorded by PR #118 in [SOLUTION_FIRST_PRODUCT_PLAN.md](SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers)). Predefined DEV/DEV2 Targets (PR #119) and `import-normalized-v1` read-back for a designated DEV2 candidate (PR #120) are implemented with synthetic evidence only. No live deploy has run.
- PLAN-01 P8 (#94 MR-07, #11 live delivery): P1-P7 are merged (PRs #95, #103, #104, #107-#111, #113, #117; see STATE). P8 is blocked by native-side work, not by an owner decision:
  - the netbka/elma365 bridge worker answers `readBack` with `{inventory, version}` only, so every dev2 read-back under `import-normalized-v1` fails closed until it returns `metadataFiles` ([required fields](contracts/target-deployment.md#read-back-metadata-bytes));
  - no native materialization worker exists, so Wiki cannot obtain a physical Contracts candidate;
  - netbka/elma365 PR #89 published contract `elma365-native-materialization@1` (no worker implements it yet); Wiki has not reviewed and pinned it in `NATIVE_MATERIALIZATION_CONTRACTS`, which is a Wiki task;
  - after these, a designated candidate SHA-256 in `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` on the running service, then the live evidence gate G2: install, read-back, affected business checks and reset/recovery on dev2.
- Source -> Workspace -> Target E2E implementation - plans/source-target-e2e.md.
- Extend workflow Storybook to existing public/auth/viewer renderers and authenticated remote collaboration when assigned.
- Analyst release workspace - [proposed PR sequence](plans/analyst-release-workspace.md) and [audit brief](audits/analyst-release-audit-brief.md). Extends the existing E2E. Offline review/handoff, synthetic delivery UI and composed-candidate delivery wiring (PR #117) are implemented; real TEST delivery, optional edited candidates and production gates remain open. No-edit review/handoff precedes TEST delivery and optional edits.
- Create ELMA-specific Product Constitution + executable Principles as a separate product-authority task.
- Integrate supported Developer Workspace/compiler flow with snapshot/candidate lifecycle after the Source/Target skeleton works. Refresh PR #8 integration ancestry as described in the analyst plan; a merge to a development branch is not proof of main/deployed availability.
- VK Teams request-to-Dev2 agent delivery - plans/vk-teams-agent-delivery.md; proposed six-PR implementation plan, not a connected bot or deployment authorization. User conversation: workflows/vk-teams-agent-delivery.md.

## LATER
- Long-term / deferred: public Vercel hosting, promotion and further public-site delivery work. Owner decision, 2026-10-07: Vercel is not relevant to the current milestone. Prioritize the internal baseline-first Wiki; Vercel availability or deployment is not a blocker or acceptance requirement for it. Retain the existing static build/configuration and educational content; resume hosting work only after a new explicit owner assignment. Reference: [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md).
- VS Code client over shared Developer Core.
- richer trace/replay and custom component framework research.
- PROD deployment policy after TEST E2E is proven; use AR-06 in the analyst plan for explicit permission, drift, recovery and operational gates. PROD remains disabled until separately authorized.

# ELMA Wiki open work

Coordination only. Work starts from the owner request or assigned issue.

## OPEN
- Source/Target E2E phase 2 snapshot storage and explicit snapshot selection for release inputs are implemented. Next: authorize named Source references through an approved adapter/bridge, then wire import and project-viewer selection UI. No live Source load is proven.
- Analyst release offline milestone is implemented for review: explicit upload/baseline pinning, owner-only resumable decisions and unchanged-original candidate/handoff. See contracts/analyst-releases.md. Optional edited candidates and production gates remain open.
- AR-04 delivery: lifecycle, guards, read-back verification and the `/releases` delivery UI are implemented against a synthetic Target (contracts/target-deployment.md). The operator bridge adapter (`elma-dev bridge`; tokens and `elma365pm` stay on the operator machine) is implemented and exercised read-only against dev2. Open: owner designates the non-production Target and a candidate for the first live deploy; then the live evidence gate G2.
- Source -> Workspace -> Target E2E implementation - plans/source-target-e2e.md.
- Extend workflow Storybook to existing public/auth/viewer renderers and authenticated remote collaboration when assigned.
- Analyst release workspace - [proposed PR sequence](plans/analyst-release-workspace.md) and [audit brief](audits/analyst-release-audit-brief.md). Extends the existing E2E. Offline review/handoff and synthetic delivery UI are implemented; real TEST delivery, optional edited candidates and production gates remain open. No-edit review/handoff precedes TEST delivery and optional edits.
- Create ELMA-specific Product Constitution + executable Principles as a separate product-authority task.
- Integrate supported Developer Workspace/compiler flow with snapshot/candidate lifecycle after the Source/Target skeleton works. Refresh PR #8 integration ancestry as described in the analyst plan; a merge to a development branch is not proof of main/deployed availability.
- VK Teams request-to-Dev2 agent delivery - plans/vk-teams-agent-delivery.md; proposed six-PR implementation plan, not a connected bot or deployment authorization. User conversation: workflows/vk-teams-agent-delivery.md.

## LATER
- VS Code client over shared Developer Core.
- richer trace/replay and custom component framework research.
- PROD deployment policy after TEST E2E is proven; use AR-06 in the analyst plan for explicit permission, drift, recovery and operational gates. PROD remains disabled until separately authorized.

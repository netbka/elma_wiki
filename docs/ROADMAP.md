# ELMA Wiki open work

Coordination only. Work starts from the owner request or assigned issue.

## OPEN
- Source -> Workspace -> Target E2E implementation - plans/source-target-e2e.md.
- Analyst release workspace - [proposed PR sequence](plans/analyst-release-workspace.md) and [audit brief](audits/analyst-release-audit-brief.md). Extends the existing E2E, not a competing pipeline. Current assignment is planning; runtime slices require assignment. No-edit review/handoff precedes TEST delivery and optional edits.
- Port/adapt generic Storybook engineering skeleton from Dyk.
- Create ELMA-specific Product Constitution + executable Principles as a separate product-authority task.
- Integrate supported Developer Workspace/compiler flow with snapshot/candidate lifecycle after the Source/Target skeleton works. Refresh PR #8 integration ancestry as described in the analyst plan; a merge to a development branch is not proof of main/deployed availability.

## LATER
- VS Code client over shared Developer Core.
- richer trace/replay and custom component framework research.
- PROD deployment policy after TEST E2E is proven; use AR-06 in the analyst plan for explicit permission, drift, recovery and operational gates. PROD remains disabled until separately authorized.

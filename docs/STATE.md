# ELMA Wiki current state

Last repository verification: 2026-10-07.

## Implemented
- Node service with identity/auth (e-mail code login; GitHub OAuth removed) and isolated user projects.
- Manual .e365 upload/project parsing and structural viewer.
- Synthetic showcase/fixtures.
- E365 workbench tooling exists for file-oriented work.
- Browser Developer Workspace (PR #8, fix PR #12): for a recognised WIDGET the
  workspace offers Monaco, inferred context types/RPC completion, diagnostics,
  lint, a separate working copy, autosave, diff, checkpoints/restore and tab
  conflict detection. The original .e365 is never modified. Native lowercase
  widget exports open in the workspace.
- Per-project offline compiler profile (see COMPILER_PROFILE.md): operator-provided
  full-context SDK and dependency typings; check uses the researched platform
  compiler, TypeScript 5.9.3 and an explicit host/version; profile/request/content
  hashes invalidate stale evidence. Without a profile no external SDK is resolved,
  and TypeScript PASS does not mean ELMA compiler PASS. The SDK is never downloaded
  by the application.

## Designed, not yet proven as runtime
- Source ELMA connection/export into immutable snapshots.
- Separate Target ELMA connection.
- Snapshot/workspace/target comparisons.
- Deployment candidate lifecycle and Target read-back verification.
- Complete ELMA Wiki Storybook governance/catalog.
- Build, live ELMA connections, deployment candidates and read-back for the
  browser workspace (Slice B not started).

## Safety
- No PROD deployment capability is verified.
- Public copy must not claim Source/Target gateway until E2E evidence exists.
- Synthetic unit/API/browser checks cover the editor workflow, compiler/profile
  gates, SDK completion and invalidation; they do not prove live platform
  equivalence for a customer host/version.

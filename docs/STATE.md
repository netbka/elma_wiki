# ELMA Wiki current state

Last repository verification: 2026-10-07.

## Implemented
- Release input selection: explicitly pick immutable source/baseline snapshots, including two versions of one project, with hash/provenance and blocked/retry loading. Capture uses pinned parser documents without changing the project/workspace selection. Synthetic local evidence only.
- Immutable project snapshot storage foundation: isolated upload snapshots, trusted Source-reference append methods, pinned original bytes/parser revisions/provenance, owner-scoped snapshot reads and stale-safe selection. Legacy reparse pins its prior index; releases capture explicit snapshots. Synthetic evidence only; no Source adapter or project-viewer selector UI. See contracts/project-snapshots.md.
- Release delivery UI: unavailable state keeps offline handoff usable; explicitly enabled synthetic mode provides stand selection/probe, separate typed confirmation, read-back, discrepancies/history, preparation cancellation and lost-response reconciliation. Historical evidence becomes stale after candidate/condition changes. Shared production/Storybook renderer; no live adapter or ELMA delivery.
- Delivery foundation (AR-04 part 1): owner-scoped Target connection references without credentials, attempt lifecycle `prepared -> deploying -> deployed-unverified -> verified | verification-failed` with `failed`/`unknown-outcome`/`blocked`/`cancelled`, server-side PROD refusal (environment and probed identity), explicit confirmation, idempotent single dispatch, drift/stale-approval blocking, restart reconciliation and read-back verification by file hash. Synthetic adapter only, disabled on a hosted service by default; no live Target. See contracts/target-deployment.md.
- Owner-only offline analyst releases at /releases: explicitly pinned DEV/baseline originals, complete inventory comparison and structural field impact, durable decisions, revision conflicts, unchanged-original candidate and exact private handoff. Local acceptance never authorizes import; ELMA, dependency and target checks remain Not run. Workspace edits are excluded. See contracts/analyst-releases.md.
- Node service with identity/auth (e-mail code login; GitHub OAuth removed) and isolated user projects.
- Manual .e365 upload/project parsing and structural viewer.
- Synthetic showcase/fixtures.
- E365 workbench tooling exists for file-oriented work.
- Local workflow Storybook and shared /flows system map: investigation, review, upload, proposed Source/Target and synthetic ELMA examples.
- Persistent local comments, replies, rejection/resolution/reopen and version-bound acceptance. Remote collaborative review is not implemented.
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
- Separate Target ELMA connection with a real adapter/bridge (the reference model and lifecycle exist; the live path does not).
- Snapshot/workspace/target comparisons.
- Live Target adapter and read-back evidence beyond the synthetic delivery UI.
- Storybook coverage of existing public/auth/project viewer renderers; workflow catalog has explicit exclusions for these surfaces.
- Build, live ELMA connections, deployment candidates and read-back for the
  browser workspace (Slice B not started).

## Safety
- No PROD deployment capability is verified.
- Public copy must not claim Source/Target gateway until E2E evidence exists.
- Synthetic unit/API/browser checks cover the editor workflow, compiler/profile
  gates, SDK completion and invalidation; they do not prove live platform
  equivalence for a customer host/version.

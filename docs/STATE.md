# ELMA Wiki current state

Last repository verification: 2026-10-07.

## Implemented
- Node service with identity/auth and isolated user projects.
- Manual .e365 upload/project parsing and structural viewer.
- Synthetic showcase/fixtures.
- E365 workbench tooling exists for file-oriented work.
- Local workflow Storybook and shared /flows system map: investigation, review, upload, proposed Source/Target and synthetic ELMA examples.
- Persistent local comments, replies, rejection/resolution/reopen and version-bound acceptance. Remote collaborative review is not implemented.

## Designed, not yet proven as runtime
- Source ELMA connection/export into immutable snapshots.
- Separate Target ELMA connection.
- Snapshot/workspace/target comparisons.
- Deployment candidate lifecycle and Target read-back verification.
- Storybook coverage of existing public/auth/project viewer renderers; workflow catalog has explicit exclusions for these surfaces.
- Browser Developer Workspace.

## Safety
- No PROD deployment capability is verified.
- Public copy must not claim Source/Target gateway until E2E evidence exists.

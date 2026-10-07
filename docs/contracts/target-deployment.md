# Target deployment and verification contract

Own the transition from reviewed workspace/snapshot to Target ELMA and proof of resulting state.

## Invariants
- Target is an explicit connection reference.
- Deployment input is an immutable candidate derived from a known snapshot/workspace.
- Required supported compile/validation gates are green.
- User sees target identity and candidate diff before state change.
- Initial E2E requires explicit confirmation.
- Exit success is not deployment proof.
- After deployment, read back/re-export Target and compare expected source/runtime/version where supported.
- Verification evidence attaches to the deployment record.
- Failure never produces Verified state.
- PROD is not enabled by the first implementation.

Candidate states: draft -> checked -> ready -> deploying -> deployed-unverified -> verified.

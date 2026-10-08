# Target deployment runbook

Initial scope: explicitly designated non-production Target only.

## Preconditions
Authorized healthy Target, visible target identity/version, ready candidate, required checks green, pre-deploy target evidence where supported, explicit confirmation.

## Procedure
1. Freeze candidate.
2. Record pre-deploy target evidence.
3. Deploy through approved adapter/bridge.
4. Mark deployed-unverified after operation returns.
5. Read back/re-export affected solution.
6. Compare expected source/runtime/version and supported structural evidence.
7. Mark verified only on matching evidence.
8. Record rollback reference.

Stop before state change if target identity differs, checks fail, candidate changed after review, capability/credential is unavailable, or operation would hit PROD without separate authorization.

One unresolved attempt reserves the observed Target host across releases and connection aliases in the single Wiki service. Finish/read back that attempt, or cancel its preparation before dispatch, before preparing another. A stale preparation can still be cancelled. If older records contain overlapping preparations, cancel the preparations that should not run; neither may dispatch while the other holds the reservation. Do not delete private records to bypass the guard. External operators and multiple Wiki processes require separate operational coordination.

Never record secrets in evidence.

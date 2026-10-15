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

One unresolved attempt reserves the observed Target host across releases and connection aliases in the single Wiki service. An operation error (`failed`) and a diverged (partial) read-back count as unresolved until a read-back reconciles them. Finish/read back that attempt, or cancel its preparation before dispatch, before preparing another. A stale preparation can still be cancelled. If older records contain overlapping preparations, cancel the preparations that should not run; neither may dispatch while the other holds the reservation. Do not delete private records to bypass the guard. External operators and multiple Wiki processes require separate operational coordination.

Never record secrets in evidence.

## Promotion and recovery (MR-08)

Promote only from a verified, current attempt on a non-production Target to an explicitly selected destination; the destination must be in the verified baseline state on the same platform version. A drift refusal means investigate the destination, never force it. After a lost response, timeout, restart or adapter error, read back first; retry only through `retry` after a `not-applied` reconciliation, and confirm the new attempt separately. A `diverged` (partial) install needs a recovery plan unless the adapter proves idempotent re-import. PROD needs a separate owner authorization that this service does not wire. Contract: [target deployment](../contracts/target-deployment.md#promotion-recovery-and-evidence-packets-mr-08).

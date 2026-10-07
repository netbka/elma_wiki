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

Never record secrets in evidence.

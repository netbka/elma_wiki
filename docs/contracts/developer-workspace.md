# Developer Workspace contract

Own supported code editing/checking between an immutable snapshot and a deployment candidate.

Initial supported scope: existing widget/form scripts only where the verified round-trip contract applies.

Primary editable artifacts: client.ts/server.ts when present and supported. Generated runtime/history/types are tool-owned and read-only by default.

Required capabilities: open source, ELMA-aware diagnostics where typings exist, compile/check, conservative lint, exact diff, checkpoint/restore and candidate build only after required checks pass.

This is not a visual ELMA Designer. Unsupported entities remain inspect-only. Hosted Wiki never executes arbitrary uploaded customer code. AI and VS Code are optional clients.

## Supported edits in the reviewed release lifecycle (AR-05, #11)

Implementation: `lib/supported-edits.mjs`, `workspaceStore.generate/objectFor` in `lib/workspaces.mjs`, release actions in `lib/releases.mjs`, renderer `web/releases/edits.js`. Policy id `widget-script-edit-v1`.

- **Editable scope.** Only a structural `widgets` object of kind WIDGET whose `client.ts`/`server.ts` the workspace already supports, and only when the operator-provisioned offline compiler profile is available for that exact snapshot (`compilerContract` `widget-worker-ts-5.9.3-v1`, a supported platform version, matching `sourceChecksum` and evidence). Every other entity stays read-only; the release lists it as such. The release UI only hints at candidates; the server re-verifies object, snapshot and profile on every attach.
- **Exact base and actor.** `attach-edit` names the object by archive path within the release's pinned source snapshot. The workspace revision (explicit or current) must have a current Check with `typescript` and `elmaCompiler` `passed` under the current profile hash, differ from the original, and be based on the same snapshot checksum as the release. The authenticated session actor is recorded; HTTP never supplies an actor.
- **Separate artifacts.** The generated artifact `.local/releases/<id>/edits/<editId>.json` holds the original sources, edited sources, runtime emitted with the worker's wrap/transpile settings (no execution) and the compiler profile metadata. The pinned `source.e365`, the project original and unknown bytes are never modified. The edit record keeps per-file original/edited SHA-256, line deltas and the artifact SHA-256.
- **Invalidation.** Attaching, replacing, reviewing or removing an edit clears candidate and approval. Attaching also clears earlier file reviews of the object's archive paths and any review of a replaced edit. Edit status is derived on every read and gate: a changed/missing generated artifact is `corrupt`; a moved project snapshot, a workspace no longer based on the pinned snapshot, or a changed/unavailable compiler profile is `stale`. Non-current edits block freeze and approval.
- **Review before candidate.** Each edit needs an `accepted` `review-edit` with a reason bound to its artifact SHA-256. Acceptance by the edit author is recorded with `independent: false`; it is not independent review evidence. Freeze then produces a candidate with `provenance: supported-edit`, whose SHA-256 covers the original checksum and every edit artifact digest, with `deployable: false` and `materialization: unavailable`. Approval scope is `edited-review-only`, and the release state is `edited-review-only` (never `prepared`/`handed-off`). The approval counts only while every edit is `current`; an edit without derived status is treated as not current.
- **Fail-closed boundary.** An edited candidate cannot be bundled, handed off or delivered (`candidateArtifact`, `withCandidate` and `bundle` refuse it; the UI disables handoff and delivery preparation and states that the candidate is review-only until elma365#60). A native package containing the edit requires native materialization of the descriptor, runtime, declarations, history and resources together, which is the open #60/P8 gate in [native-materialization.md](native-materialization.md). The generated runtime is offline compiler output, not native validation or Target evidence.

Not implemented: native package assembly of edits, label/localization or any non-script edit, process runtime, reconciliation back to DEV, and a Solution-UI entry for attaching edits. The Solution handoff store is wired to the same workspace capability and action allowlist, but that path has no dedicated test yet and is not claimed as verified. Evidence: `node --test test/supported-edits.test.mjs` (synthetic fixtures and compiler profile only).

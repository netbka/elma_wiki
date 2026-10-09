# Native unit and configuration-coverage adapter

Owner: #94 MR-04, PLAN-01 P4 (Wiki side). Native counterpart: netbka/elma365#60. Product authority: [Solution-first](../SOLUTION_FIRST_PRODUCT_PLAN.md) and [working configuration release](../plans/working-configuration-release.md). Implementation: `lib/native-coverage-adapter.mjs`; planner: [release-scope-planner.md](release-scope-planner.md).

`adaptNativeCoverage({request, artifacts, declarations, targetProfile})` is a synchronous pure function. It admits pinned native coverage declarations, projects them into the existing `planReleaseScope` inputs (`importUnits`, `applications`, `serverInventory`), runs that planner and returns a deeply frozen record. It performs no IO, provider call, native command, materialization or Target selection; `publicationReady` and `executionEnabled` are always false. It is not wired into a store, API or UI.

## Inspected native contract

Read-only inspection of netbka/elma365 `main` at `a762173faf67656273fcee258f799017c562a585` (issue #60 and `docs/`, `tools/config-workspace/`) found no published native declaration schema for import-unit membership, application membership, part-to-unit expansion, global-domain inventory or executable global handlers, no Target-preservation policy and no native import receipts. `tools/config-workspace/package_inventory.py` hashes packed archive files only. `INSPECTED_NATIVE_CONTRACT` records this revision and the missing facts.

Therefore `NATIVE_COVERAGE_CONTRACTS` is empty and cannot be extended by callers. Every declaration under any other contract id returns `unknown-native-coverage-contract` and is not admitted. `SYNTHETIC_COVERAGE_CONTRACT` exists only to test Wiki accounting; any admitted synthetic declaration adds the `synthetic-evidence-only` blocker, so a synthetic result never reaches `wikiAccounting.planningComplete`. When elma365#60 publishes a versioned contract, it is pinned here by id/version after review of its schema; this adapter shape is the Wiki consumer proposal, not a native commitment.

## Declaration document

`{contract: {id, version}, nativeRevision, adapter, evidenceRef, targetProfileDigest, captures, units, applications, parts, server}`:

- `nativeRevision` is a 40-hex native commit, with `adapter` and `evidenceRef`; otherwise `unpinned-native-declaration`.
- `targetProfileDigest` must equal `targetProfile.digest`; otherwise `stale-native-profile`.
- `captures: [{solution, artifactChecksum}]` binds the declaration to exactly one supplied capture per Solution by its `parseManagedArtifact` checksum; otherwise `stale-native-capture-binding`. A capture without a checksum is `unbound-capture`. Unit members outside the bound Solutions are `unbound-native-unit-member`.
- `units: [{id, status, evidenceRef, members: [{solution, key, digest}], unsupportedMembers?, targetPrecondition, receipt?}]` become planner import units under the declaration's adapter and profile. Member digests remain checked by the planner (`stale-native-unit-coverage`). Nonempty `unsupportedMembers` block as `unsupported-native-unit-member`.
- A nonempty Target (`mode: 'existing-target'`) additionally requires `preservation: {policy: 'retain-unlisted', evidenceRef}` and, when `targetProfile.baselineDigest` is supplied, an equal `requiredBaselineDigest`. Otherwise the precondition is withheld (`unproven-target-preservation` or `stale-target-baseline`, plus the planner's `unknown-target-precondition`).
- `applications` rows pass to the planner unchanged in shape; membership is never inferred.
- `parts: [{solution, key, componentDigest, partId, unitId}]`: a part request requires exactly one row whose `componentDigest` equals the captured component digest and whose unit contains that component; otherwise `unknown-native-part-expansion` or `stale-native-part-expansion`.
- `server: {coverage, evidenceRef, solutions, requiredGlobalDomains, domains}`. An `included` domain is projected only with `handler: {status: 'executable', evidenceRef}`; an `externally-provisioned` domain only with `verification: {status: 'verified', evidenceRef, targetProfileDigest}` on the same profile. Anything else becomes `unresolved` so the planner's global floor blocks full-server completeness, and the missing handler/verification is listed as native evidence.

Admitted declarations are merged. The same unit, component, application, part, domain or server inventory supplied by more than one declaration is `duplicate-native-provider`; no winner is chosen.

## Result

- `plan`: the unchanged planner output over the projected inputs.
- `adapterBlockers`: adapter-level blockers above.
- `wikiAccounting`: `evidence` is `planned` when declarations were admitted, else `unknown`; `planningComplete` requires both the plan and the adapter to be unblocked.
- `nativeEvidence`: facts Wiki cannot observe, kept separate from accounting: `pinned-native-coverage-contract`, per selected unit `native-import-receipt` and `native-installation-observation`, and per server domain `global-domain-executable-handler` or `global-domain-verification`. `complete` is always false here; installation observation, read-back and business acceptance remain P6/P8 native work and are named prerequisites, never synthetic success.
- `evidenceBasis`: `synthetic`, `native` or `unknown`.

## Verification

`node --test test/native-coverage-adapter.test.mjs test/release-scope-planner.test.mjs test/dependency-evidence.test.mjs` covers: no pinned contract and a parser-generated capture staying unknown; minimal supported unit; application membership and digest-bound part expansion to whole units; diamond, component cycle and coupled-unit cycle; unsupported/unbound members; nonempty-Target preservation and baseline drift; duplicate providers; stale capture/profile/unit digests and unpinned revisions; unknown globals and missing domain handling under full-server scope; immutability and order independence. This is synthetic repository evidence, not native or live verification. No visible UI changed.

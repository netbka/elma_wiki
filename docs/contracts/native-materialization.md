# Native materialization adapter (Wiki side)

Owner: #94 MR-03, PLAN-01 P6. Native counterpart: netbka/elma365#60. Product authority: [Solution-first](../SOLUTION_FIRST_PRODUCT_PLAN.md) and [working configuration release](../plans/working-configuration-release.md). Implementation: `lib/native-materialization.mjs`. Inputs: [managed-workspace.md](managed-workspace.md) resolved revisions (P3), [native-coverage-adapter.md](native-coverage-adapter.md) units (P4) and [dependency-resolver.md](dependency-resolver.md) locks (P5).

This is the thin Wiki consumer of a native materialization service. It binds exact inputs, calls an injected native adapter and verifies the exact output. It assembles no package itself, stores nothing, adds no API/UI and never sets `publicationReady` or `executionEnabled`. P7 (#11 delivery coordinator) remains the only path to a candidate.

## Inspected native contract

Read-only inspection of netbka/elma365 `main` at `a762173faf67656273fcee258f799017c562a585` (issue #60, `tools/config-workspace/GUIDE.md`): the versioned HTTP/artifact request is an open #60 deliverable. The existing `workspace.py stage` → `elma-dev compile` → `check.mjs` → `elma365pm pack` path is a credentialed local CLI tied to a native checkout and live hosts. No process-runtime compiler, native package-validation receipt, manifest-regeneration policy or isolated assembler is published. `INSPECTED_NATIVE_MATERIALIZATION` records this revision and the missing facts.

`NATIVE_MATERIALIZATION_CONTRACTS` is therefore empty and callers cannot extend it. An adapter under any other contract returns `unavailable` with `native-materialization-contract-unavailable` and is never invoked. `SYNTHETIC_MATERIALIZATION_CONTRACT` exists only to test Wiki accounting. Its output always carries `synthetic-evidence-only` and is never `releaseEligible`. When #60 publishes a contract, pin it here by id/version after schema review.

## Request: `prepareMaterializationRequest`

Input: workspace `state`, the incoming change `artifact`, its stored `resolution`, P4 `coverage` (an `adaptNativeCoverage` result over the resolved revision), P5 `dependencies` (a `resolveDependencyEvidence` result over `coverage.plan`), a `compiler` lock `{contract, profileDigest, platformVersion, evidenceRef, services}`, `targetProfile` `{digest, platformVersion}` and `originals`, a `Map` from artifact ID to private original bytes.

- The resolution must be `current` for the freshly recomputed B/A/C plan (`managedResolutionStatus`). A corrupt resolution blocks as `corrupt-resolution` and a moved plan as `stale-resolution`.
- Bytes come from the declared full base B and from each resolved component's chosen side: the incoming artifact, the accepted change named by `interventionId`, or the workspace baseline. Each source must be supplied and match its stored checksum. Otherwise the request blocks with `missing-original` or `original-checksum-mismatch`. The chosen component digest must exist in that artifact (`unlocatable-component-source`).
- Operations are whole-component `add | replace | remove`. All evidence files of a component (entity, side scripts, resources) come from one side, so coupled descriptor/source/runtime/resources cannot be mixed. A path shared by components with different chosen bytes blocks as `shared-path-conflict`.
- Expected files: every base path is `preserve` (exact sha256) unless a changed component owns it (`replace` with the chosen bytes, or `remove`). A file that the old version of a replaced component declared, but the new version does not, is `remove`. The service manifest of each changed service is `native-manifest`. Only its `entities` records may differ, and those are checked by component digests. `package.json` and unrelated manifests are preserved byte for byte. This is no blanket metadata exclusion.
- P4: each changed component must be in exactly one selected native unit (`uncovered-resolved-component`, `duplicate-native-unit`). Every member of a selected unit must carry the resolved digest (`stale-native-unit-member`). Coverage blockers other than `synthetic-evidence-only` block as `native-coverage-incomplete`.
- P5: `dependencies.planDigest` must equal `planDigest(coverage.plan)` (`stale-dependency-resolution`), its blockers other than `synthetic-evidence-only` must be empty, and the Target profile must match both coverage and dependency evidence.
- Compiler: a missing lock blocks (`missing-compiler-profile`). Its platform must equal the Target's (`compiler-platform-mismatch`). Every changed coupled service (side scripts or `processor`) must be declared in `services` (`unsupported-compiler-scope`). The widget compiler does not certify process runtime.

`inputs` bind solution, resolution revision/result/plan digests, base and original checksums, coverage plan digest/units/import order, dependency plan digest/locks, compiler lock and Target profile. `inputsDigest` is their canonical hash. Any changed input produces a different digest. `evidenceBasis` is `native` only when both coverage and dependency evidence are native, `synthetic` when either is synthetic, and `unknown` otherwise.

## Materialization: `materializeNative`

A non-`ready` request returns `blocked` without calling the adapter. A pinned adapter (`id`, 40-hex `nativeRevision`, `contract`) receives the frozen request and copies of the required originals, and must return `{inputsDigest, artifacts: [{solution, bytes}], validation}`. Wiki then checks the output:

- An echoed `inputsDigest` mismatch fails as `stale-native-output`. Anything other than exactly one artifact for the Solution fails as `unexpected-native-artifacts`. A thrown adapter error becomes `native-materialization-failed` without leaking its message.
- Each expected path must be present with the exact bytes (`preserved-bytes-changed`, `replaced-bytes-mismatch`, `missing-output-path`) or absent (`removed-path-present`). Unplanned paths fail as `unexpected-output-path`. Native manifests must keep every non-entity field (`manifest-fields-changed`). The outer native layout, nested service ZIP or directory, must match the base (`native-layout-changed`).
- `parseManagedArtifact` over the output must yield exactly the expected component digests, with no new ambiguity.
- Native validation must be `passed` and name the exact output sha256, the adapter contract, the Target profile and the compiler profile. Otherwise it is `native-validation-missing` or `native-validation-mismatch`.

Determinism policy `unpacked-content-v1`: compare unpacked per-path bytes, component digests, outer layout and exact non-entity manifest fields. The ZIP container sha256 is recorded but not compared, because native packing timestamps may differ.

The result is a frozen build manifest bound to `requestDigest` and `inputsDigest`. It records adapter, artifact sha256/size, per-action file counts, validation and blockers, with a `manifestDigest`. Output bytes are returned only for a verified `materialized` result. `releaseEligible` requires a materialized output, native evidence and no blockers, so it is always false today. `materializationStatus(manifest, request)` returns `corrupt` for a tampered manifest, `stale` when the current request differs and `current` otherwise.

## Verification and current gap

`node --test test/native-materialization.test.mjs` uses synthetic Contracts-shaped B/A/C archives through the existing store. It covers an unpinned/forged contract never being invoked; a no-edit round trip preserving every byte, resource, unknown manifest field and layout under a different container; a one-edit whole-component replacement, including removal of a resource the new version no longer declares; and two same-base changes with a resolved conflict and coupled client source. It also covers fail-closed output defects (dropped manifest field, changed preserved resource, extra/missing path, mixed coupled source, nested layout, missing/mismatched validation, stale echo, adapter failure) and fail-closed inputs (missing/altered original, missing/unsupported/mismatched compiler, missing/stale coverage, stale dependency plan/profile, corrupt and moved resolution, relocked compiler staling the manifest).

This is synthetic Wiki evidence only. Removal through validated tombstones is supported by the operation model but is not separately exercised here.

## Open P8 gate: native validation of exact output

The owner accepted this Wiki side of P6 on 2026-10-11 with the native-validation criterion deferred. Native materialization and native validation of exact physical Contracts output are an **open P8 gate** (PLAN-01 P8, #94 MR-07). They depend on netbka/elma365#60 publishing a versioned materialization/validation contract executed by an approved native worker. They are **evidence-unavailable** here, not passed. elma365 `main` was still `a762173` when re-inspected on 2026-10-11.

Until #60 is pinned in `NATIVE_MATERIALIZATION_CONTRACTS` after schema review, and P8 observes native validation of the exact output bytes:

- every real adapter returns `unavailable` and is never invoked, so `releaseEligible` stays false;
- `SYNTHETIC_MATERIALIZATION_CONTRACT` is used only by `test/native-materialization.test.mjs`. Its output carries `synthetic-evidence-only`, has `evidenceBasis: synthetic` and is never native-valid or release-eligible;
- no build manifest from this adapter may feed a P7 candidate as native evidence. P7 ([target-deployment.md](target-deployment.md), composed candidates) freezes a manifest only after it re-derives this request from current Solution state. A synthetic or non-eligible candidate reaches only a synthetic training adapter.

Native materialization is not claimed to work.

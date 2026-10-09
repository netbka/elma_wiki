# Dependency and Target-profile evidence resolver

Owner: #94 MR-05 (PLAN-01 P5), Lane C in #91. Product authority: [Solution-first](../SOLUTION_FIRST_PRODUCT_PLAN.md) and [working configuration release](../plans/working-configuration-release.md). Implementation: `lib/dependency-resolver.mjs`. Upstream input: [release scope planner](release-scope-planner.md).

`resolveDependencyEvidence` is a synchronous pure accounting function over one `planReleaseScope` result. It returns a deeply frozen JSON-serializable record and performs no IO, provider call, licence purchase/provisioning, installation, decryption or deployment. It adds no store, API, UI or eligibility switch. `publicationReady` and `executionEnabled` always remain false. `resolutionComplete` means only that the supplied evidence has no accounting blockers under a native receipt contract; it is not native entitlement, activation or business acceptance.

## Inputs

- `plan`: planner output. Dependency prerequisites (`{from, service, namespace, code, status, candidates}`) are resolved; global-domain prerequisites stay with the planner. `planDigest` binds the result to the exact plan bytes.
- `targetProfile`: `{targetId, environment, digest, platformVersion, changedAt}`. All fields are required. Every plan `targetPreconditions[].targetProfileDigest` must equal `digest`; no precondition (`unbound-plan-target-profile`) or a different/inconsistent one (`stale-target-profile`) blocks.
- `receiptContract`: `{id, version}` naming the receipt semantics. Only contracts in the module constant `NATIVE_RECEIPT_CONTRACTS` that declare provenance, expiry and compatibility semantics, or the test-only `SYNTHETIC_RECEIPT_CONTRACT`, are recognised. Callers cannot register one.
- `receipts`: unique-ID rows `{id, contract, kind, status, provider: {code, version}, provides: [{service, namespace, code}], targetId, environment, targetProfileDigest, verifiedAt, expiresAt, provenance: {source: 'native-adapter', adapter, evidenceRef}, compatibility: {status, platformVersion, evidenceRef}, entitlement: {status, evidenceRef}, requiredBindings: [{name, kind}]}`. `kind: 'licensed-preinstallation'` also needs `activation: {status: 'verified', evidenceRef}`; `kind: 'official-distribution'` needs `distribution: {official: true, intact: true, artifactDigest, authorization: {status: 'authorized', evidenceRef}}`.
- `revocations`: `{receiptId, revokedAt}`; effective when `revokedAt <= now`.
- `bindings`: `{name, kind: 'secret-reference' | 'environment', reference, targetProfileDigest}`. Any other field, such as a value, is rejected; references never appear in the output.
- `distributionArtifacts`: privately held intact vendor artifacts `{code, version, sha256}`.
- `now`: explicit evaluation time; there is no implicit clock.

## Resolution

Without a recognised contract every dependency row is `unknown` with `native-receipt-contract-unavailable`; receipts are not evaluated. A prerequisite captured in several Solutions (`ambiguous-reference`) is `duplicate-provider`. The required provider is the single catalog candidate code and version; zero, several or versionless candidates block (`unknown-required-provider`, `ambiguous-provider`, `unknown-required-version`).

A receipt locks a prerequisite only when it names that exact reference and has none of these failures: contract mismatch; revoked; non-`verified` status or non-native provenance (`assertion-only-receipt`); provider/version mismatch; Target, environment or profile mismatch; unknown or future verification time; verification older than `targetProfile.changedAt` (`stale-receipt`); unknown or passed expiry; incompatible, unknown or platform-mismatched compatibility; unverified entitlement; unverified activation (preinstallation) or unofficial/altered, unauthorized, missing, ambiguous or digest-mismatched distribution artifact. Entitlement is required even when the catalog says `paid: false`. Catalog membership, readable paid bytes and a `paid` flag never satisfy any check. Verified receipts from different providers for one reference block as `duplicate-provider`; no winner is chosen. The selected receipt's required bindings must each match exactly one binding for the same profile, otherwise `missing-binding`, `ambiguous-binding`, `binding-profile-mismatch` or `unknown-required-bindings` blocks.

`locks` records provider, path, receipt, evidence reference, required binding names, profile digest and, for distribution, the artifact digest with `activation: 'pending-installation'`. `remainingPlanBlockers` is the plan's blockers minus the `missing-reference` / `unverified-licensed-prerequisite` rows whose prerequisite was locked; all other planner blockers stay. Output ordering is deterministic under input reordering, and inputs are not mutated.

## Synthetic evidence and the missing native contract

Positive results in this repository use `SYNTHETIC_RECEIPT_CONTRACT`. Such locks carry `evidence: 'synthetic'`, the result has `evidenceBasis: 'synthetic'` and a top-level `synthetic-evidence-only` blocker, so a synthetic resolution can never be complete.

`NATIVE_RECEIPT_CONTRACTS` is empty. As of revision `19a46fa`, netbka/elma365#60 lists paid/opaque dependency paths as an adapter deliverable but publishes no versioned receipt schema defining receipt provenance (which adapter/observer signs it), expiry/revocation semantics, or platform/module compatibility rules. Until the native adapter publishes that contract and it is added here with tests, every actual dependency remains `unknown` and blocks release. Purchasing, licence provisioning, credential access and distribution rights remain owner-reserved.

## Verification

`node --test test/dependency-resolver.test.mjs test/release-scope-planner.test.mjs test/dependency-evidence.test.mjs` covers absent/unknown contracts, compatible synthetic preinstallation and distribution locks, incompatible/missing receipts, version/provider/profile/platform/digest mismatch, revoked/expired/stale/assertion-only evidence, duplicate providers, missing/ambiguous/mismatched bindings, readable paid source, catalog-only and `paid: false` cases, and deterministic ordering. This is synthetic repository evidence, not native, licence or live verification. No visible UI changed, so Storybook is not applicable.

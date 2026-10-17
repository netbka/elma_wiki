# Release scope and dependency coverage planner

Owner: #94 MR-04, Lane C in #91. Product authority: [Solution-first](../SOLUTION_FIRST_PRODUCT_PLAN.md) and [working configuration release](../plans/working-configuration-release.md). Implementation: `lib/release-scope-planner.mjs`.

`planReleaseScope` is a synchronous pure accounting function. It consumes captured evidence and trusted adapter declarations, returns a deeply frozen JSON-serializable plan, and performs no IO, parsing, compilation, materialization, connection, provider call or deployment. It introduces no state store or delivery coordinator. `publicationReady` and `executionEnabled` always remain false. `planningComplete` means only that this supplied inventory has no accounting blockers; it does not mean native installation, entitlement, business acceptance or release eligibility has been verified.

## Inputs

- `request`: explicit `kind: part | application | solution | server`. A Solution request supplies `solution`. An application request supplies `solution` and `applicationId`. A part request supplies `component: {solution, key}` and `partId`, using an existing captured `structure.elements[].id`; names, positions and guessed IDs are not identities.
- `artifacts`: existing `parseManagedArtifact` records, with `solution`, explicit `scope`, captured `components`, `ambiguities`, `unclassifiedFiles`, and `dependencies` from the existing `dependencyReport`. Exactly one capture per Solution is allowed; callers must choose a frozen revision rather than overlaying competing captures here. Keys use the existing `componentIdentity` profile; component digests are retained in the required closure. This input must come from captured evidence, never the sanitized search index.
- `applications`: adapter-declared membership rows `{solution, id, coverage: 'complete', evidenceRef, members: [{solution, key}]}`. No application boundary is inferred from a namespace or display name. Missing/incomplete/ambiguous membership blocks.
- `importUnits`: adapter-declared native unit rows `{id, status: 'supported', adapter, evidenceRef, members: [{solution, key, digest}], targetPrecondition}`. A required component must have exactly one supported unit, with its exact current captured digest; unit IDs and member identities must be unique. Native import granularity is not inferred from parser support. Whole-unit siblings expand the closure and bring their own dependencies.
- `targetPrecondition`: `{mode: 'empty-target' | 'existing-target', evidenceRef, targetProfileDigest}`; an existing Target additionally requires `requiredBaselineDigest`. These are pinned prerequisites for later preflight, not observations made by this function. Missing preconditions or inconsistent profiles block planning. Later native/Target evidence must verify them afresh.
- `serverInventory`: `{coverage: 'complete', evidenceRef, solutions, requiredGlobalDomains, globalDomains, targetProfileDigest}`. `solutions` is the explicit required Solution catalog, not all captures that happen to be supplied. The required-domain list augments the exported `REQUIRED_GLOBAL_DOMAINS` accounting floor: global settings, access/groups/relations, schedules, integration bindings and configuration/reference data. This floor is not a universal native domain enumeration; the native adapter must declare every additional domain under its version contract.

Each `globalDomains` row has exactly one `domain` and either:

- `status: 'included'`, `evidenceRef` and nonempty component `members`, which must themselves reach supported native units; or
- `status: 'externally-provisioned-and-verified'`, `evidenceRef`, `adapter` and the same `targetProfileDigest` as the server inventory.

Unknown, duplicate, unresolved, unverified or profile-mismatched global domains block. Declaring a complete inventory is a trusted adapter responsibility, not an upload checkbox. An all-Solutions inspection bundle lacks the required native/global coverage and cannot stand in for this inventory.

## Closure and results

Required `dependencies`, `internalDependencies` **and `sysDependencies`** participate in closure. The existing inspection report's non-required system classification does not make system runtime prerequisites optional here. Exact service/namespace/code references resolve against captured components across Solutions; multiple identities/providers block, even with equal bytes. Missing/unknown identity, incomplete source tuples and unknown categories block. References without a source tuple are conservatively applied to every included component in their captured Solution. Exact source tuples apply to the corresponding included components. `optionalDependencies` are explicitly reported as `excluded-optional`, not silently dropped; an adapter must classify any runtime-required optional reference as required in its captured inventory before release use.

The queue computes dependency closure and native-unit expansion together, so an included sibling can add another required package. `requestedComponents`, `requiredComponents` and `expansions` disclose the requested boundary and wider physical scope. Part scope expands to the containing component and then its unit; Solution scope requires an explicitly full capture. Partial absence never creates a deletion. Unknown/opaque/unclassified capture bytes remain blockers.

`dependencyOrder` places dependencies before consumers for the known component graph. `nativeImportOrder` separately orders whole native units. No arbitrary cycle order or joint-import support is invented.

Package-internal dependency groups. A supported import unit is already the indivisible native import granularity in this contract: whole-unit siblings are always required together and only whole units are ordered. That existing trusted assertion is sufficient for one case only. A component cycle (strongly connected group, including a self reference) is admitted as a package-internal dependency group when every member is covered by the same unit and that unit is:

- uniquely resolved: exactly one row with that id, and each of its members has no other providing unit;
- supported: `status: 'supported'`, with `adapter` and `evidenceRef`, and valid member coverage;
- complete: every declared member resolves to exactly one captured component;
- digest-current: every member digest equals the captured digest.

No new input field, joint-import capability or cross-unit waiver is added. Every other component cycle blocks as `dependency-cycle`, with the group's `components` and the `unitIds` that cover them. This includes cycles across units, cycles through an uncovered component, and cycles inside a missing, duplicate, ambiguous, stale, unsupported, invalid or incomplete unit. An admitted group changes no other gate: the unit's Target precondition, profile consistency, coupled-unit cycles (`native-import-unit-cycle`), capture completeness, references and prerequisites still block as before.

Ordering output:

- `internalDependencyGroups` lists `{unitId, components}`, with components in canonical key order. That order is a listing, not an installation order.
- `dependencyStages` places dependencies first, using `{kind: 'component', component}` or `{kind: 'package-internal-group', unitId, components}` entries. It is `null` when a blocking cycle exists.
- `dependencyOrder` remains the total component order. It is `null` when any cycle exists, admitted or blocked, because no total component order exists then.
- `nativeImportOrder` orders the group's whole unit. A plan with admitted groups adds a limitation stating that the group has no component order and that the unit's native import remains unverified.

Admission is accounting only. It does not prove that the native importer accepts the cycle. The native coverage adapter's `native-import-receipt` and `native-installation-observation` remain required native evidence.

An acyclic order on a blocked plan is provisional for known units/components, not an executable instruction set. The native-unit cycle diagnostic lists the units that cannot yet be ordered, including consumers waiting on that cycle.

`prerequisites` retains missing/ambiguous source references, source availability classification and catalog candidate code/version/paid facts, plus declared external global provisioning. Source catalog membership, uploaded readable bytes, a paid flag or a matching namespace cannot prove compatibility, activation, entitlement or native installability. Missing paid/opaque source remains a blocker requiring MR-05 licensed preinstallation or authorized intact distribution and actual matching-profile evidence. Readable source with a paid or unknown-license catalog candidate also returns an unverified licensed-prerequisite blocker. This planner does not provide that resolver or bypass it; the separate pure [dependency evidence resolver](dependency-resolver.md) consumes its output.

Blockers, expansions, closure and ordering are deterministic under inventory reordering. The function leaves input records untouched. Dynamic script bindings are not discovered by this function; the native adapter and affected business-flow acceptance remain required. Full package assembly, target read-back, native business acceptance and controlled promotion remain separate open work under #94, native elma365#60 and #11.

## Current metadata gap and verification

Current managed captures contain component identities/digests and dependency reports. They do **not** supply verified native import-unit coverage, application membership, exhaustive global-domain inventory or Target prerequisites. Directly passing those captures returns explicit unknown blockers. Trusted native adapter metadata and evidence are the next integration dependency. The plan reaches the composer only through the native coverage adapter and the [build eligibility gate](composed-build-eligibility.md), which keeps every such blocker visible. Provider #19 stays prepared-disabled.

`node --test test/release-scope-planner.test.mjs test/dependency-evidence.test.mjs` covers synthetic diamond/cycles/missing/ambiguous/system/paid references, admitted package-internal cycle groups and their stale/unsupported/incomplete/ambiguous/cross-unit/uncovered negatives with Target and coupled-unit gates still binding, part and unit expansion, acyclic-component/cyclic-unit boundaries, empty/nonempty Target prerequisites, stale digest/profile, global-domain gaps and a parser-generated capture with unknown native metadata. This is repository evidence, not native or live verification. No visible UI changed, so Storybook changes are not applicable.

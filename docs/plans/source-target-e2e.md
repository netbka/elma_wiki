# Source -> Wiki -> Target E2E implementation plan

Status: assigned direction / ready for implementation
Tracking: PR #9 architecture branch

## Goal

Prove one complete non-production flow:

Source DEV -> explicit solution export -> immutable snapshot -> existing viewer -> optional supported widget workspace change -> candidate -> Target TEST -> deploy -> read-back -> verified evidence.

Do not start with PROD, continuous sync, arbitrary entity editing or a full browser IDE.

## Phase 1 - engineering skeleton

1. Keep AGENTS/capability router current.
2. Establish Storybook package and review manifest for the affected Wiki surfaces.
3. Create synthetic Source/Target adapters and workflow fixtures.
4. Add focused contract tests for state transitions.

Exit: agents can route work, UI states are reviewable, no live credentials required.

## Phase 2 - snapshot model

1. Extend project storage from one parsed state to immutable snapshots.
2. Preserve existing manual upload behavior.
3. Store original private artifact reference + hash separately from parsed index.
4. Add snapshot listing/current selection.
5. Enforce owner scope for every snapshot/artifact operation.
6. Add synthetic tests for immutability and cross-owner denial.

Exit: repeated source-like imports create S1/S2 without mutating S1.

## Phase 3 - connection abstraction

1. Add Source/Target connection-reference model with no raw credential in project data.
2. Define adapter interface from source-target-connections contract.
3. Implement fake adapter for tests/Storybook.
4. Implement the first real non-production execution path using the safest existing ELMA tooling/bridge available to this repository.
5. Health/capability is read-only.

Exit: designated Source can export one selected solution into a snapshot without exposing credential in repository/project output.

## Phase 4 - source import UI

1. Connections surface.
2. Select Source.
3. Select solution.
4. Load current version.
5. Show exporting/parsing/partial/failure/snapshot-ready states.
6. Open existing project viewer at the new snapshot.
7. Add Source snapshot vs previous snapshot compare entry point.

Exit: an ELMA developer can load DEV into Wiki without understanding archive internals.

## Phase 5 - candidate

Start without editing: allow a snapshot itself to become a candidate. Then integrate supported Developer Workspace changes.

Candidate records exact base snapshot/hash, generated package artifact/hash, checks and target intent.

Exit: candidate is immutable and cannot silently change after review.

## Phase 6 - Target TEST

1. Configure/select explicit TEST Target.
2. Read current target solution/snapshot before deploy.
3. Show candidate vs target structural/exact differences.
4. Block unsupported/incompatible states.
5. Require explicit confirmation.
6. Deploy through adapter/bridge.
7. Record deployed-unverified.

Exit: command success never renders Verified.

## Phase 7 - read-back verification

1. Export/read back affected solution from Target.
2. Store verification snapshot/evidence.
3. Compare expected source/runtime/version for supported widget path plus structural evidence.
4. Mark Verified only on match.
5. Surface mismatch with next action.
6. Record rollback reference where tooling supports it.

Exit: one real non-production E2E has reproducible evidence.

## Phase 8 - Developer Workspace integration

After baseline Source -> Target works:

1. Open supported existing widget/form source.
2. Check/compile using verified contract.
3. Create checkpoint.
4. Make minimal script change.
5. Build generated artifacts without hand-editing runtime/history.
6. Create candidate from workspace.
7. Run the same Target TEST + read-back path.

Exit: the first code-changing E2E is proven.

## Verification strategy

During implementation use focused tests per phase. Before merging runtime work, final diff must have evidence for every crossed boundary.

Required final E2E evidence:
- source identity and solution selected;
- source snapshot hash;
- target identity;
- candidate hash;
- pre-deploy target evidence;
- deploy operation result;
- read-back snapshot hash;
- verification comparison;
- rollback reference/status;
- confirmation that no raw credential entered project/Git/log evidence.

Use synthetic fixtures for repository tests and an explicitly designated non-production Source/Target for live E2E.

## Stop conditions

Stop rather than guessing when:
- no authorized non-production Source/Target access exists for required live evidence;
- available tooling cannot safely export/read back;
- Target identity cannot be proven;
- operation unexpectedly requires PROD;
- completing the flow requires unsupported destructive action.

An unavailable optional UI reviewer is not a blocker to backend implementation.

## Exit condition

One designated solution can travel Source DEV -> Wiki snapshot -> candidate -> Target TEST -> read-back verification with truthful states and preserved evidence, while manual upload still works and no credential is committed/stored in project artifacts.

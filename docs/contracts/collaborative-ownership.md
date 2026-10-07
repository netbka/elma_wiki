# Collaborative ownership for E365 changes

Tracks: #31, within the baseline-first lifecycle in #33/#34.

The workflow below describes ownership semantics. Managed workspaces must start from an explicitly full snapshot; partial packages are Changes within that workspace. Later full snapshots use Reconciliation. This authority supersedes any earlier interpretation that an arbitrary package can become a managed workspace. The first engine checkpoint and its remaining integration gates are documented in [managed-workspace.md](managed-workspace.md).

## Purpose

The portal must support two teams changing one ELMA solution without pretending that a whole process has one permanent owner.

Korus may remain responsible for the baseline process while an internal team owns only its explicitly recorded intervention.

## Domain terms

### Baseline

An immutable E365 revision selected as the reference state before a change. A baseline has an attributed owner label, for example `Korus`.

The owner label is portal metadata. It is not written into the E365 package and is not inferred from ELMA metadata.

### Intervention

A set of element-level differences between a baseline revision and a later revision, attributed to a team/change request.

An intervention can contain:
- added elements;
- modified baseline elements;
- removed baseline elements;
- ambiguous changes where stable element identity cannot be established.

### Baseline element

An element present in the selected baseline. It remains part of the baseline responsibility unless evidence shows that a later intervention modified or removed it.

Adding another element to the same process does not change ownership of untouched baseline elements.

### Boundary crossing

A change that modifies or removes a baseline element rather than only adding an independent element.

A boundary crossing is not forbidden. It is explicit evidence that responsibility cannot be treated as a clean additive intervention and requires review.

### Conflict

A later revision changes an element that belongs to an active intervention by another team, or both teams changed the same baseline element relative to a common baseline.

Conflict is evidence of overlapping changes, not proof of fault.

## Classification

For every stable element identity available from the parser, comparison produces one of:

| Classification | Meaning |
| --- | --- |
| baseline-unchanged | existed in baseline and did not change |
| intervention-added | did not exist in baseline and appears in changed revision |
| baseline-modified | existed in baseline and content changed |
| baseline-removed | existed in baseline and is absent |
| ambiguous | stable identity or comparison evidence is insufficient |

`baseline-modified` and `baseline-removed` are boundary crossings.

The portal must not manufacture element identity from display names when the parser cannot establish a stable identity.

## Responsibility semantics

The portal records evidence. It does not decide contractual liability.

UI wording follows these operational rules:

- a defect in untouched baseline logic points to the baseline owner;
- a defect inside an intervention points to the intervention owner;
- if an intervention violates its recorded input/output boundary and breaks baseline behavior, it points to the intervention owner;
- if root cause is not established, status is `joint localization required`;
- the presence of any intervention never relabels the whole process as intervention-owned.

## Workflow

1. Select an immutable revision as baseline.
2. Attribute the baseline to a team label.
3. Record the task/change request for the intervention.
4. Load the post-change E365 revision.
5. Compare against the exact baseline.
6. Classify changes at the smallest stable element granularity the parser can prove.
7. Group classified changes into the intervention.
8. Surface boundary crossings before detailed file/JSON evidence.
9. Produce a compact responsibility summary.
10. Compare future revisions against both baseline and recorded intervention identities to detect cross-team overlap.

## Primary UI

The project/release experience must lead with:

`Baseline -> Change -> What changed -> Responsibility -> Conflict / no conflict`

First-screen information:
- baseline revision and attributed team;
- interventions since baseline;
- count/list of boundary crossings;
- conflicts requiring localization;
- latest comparison.

Raw JSON, archive paths, Git concepts and parser internals are secondary evidence.

Korus is not required to use GitHub or this portal.

## Acceptance cases

### Additive intervention

Baseline owner Korus owns process A. Internal team adds node X and two new variables. Existing elements are byte/structurally unchanged.

Expected:
- X and variables: intervention-added / internal team;
- old elements: baseline-unchanged / Korus baseline;
- no boundary crossing;
- process A is not relabelled internal-team owned.

### Baseline modification

Internal team changes existing condition Y.

Expected:
- Y: baseline-modified;
- boundary crossing visible before detailed diff;
- review required;
- other untouched process elements remain baseline.

### Later cross-team conflict

A later Korus snapshot modifies X from the recorded internal intervention.

Expected:
- X is identified as overlap with an existing intervention when stable identity permits;
- conflict is surfaced;
- portal does not assign fault automatically.

## Evidence and safety

All original revisions remain immutable.

Ownership, attribution, task references and decisions are stored separately as portal metadata.

When evidence is insufficient, use `ambiguous` / `unknown`. Never turn an archive/file-level guess into a semantic ownership claim.

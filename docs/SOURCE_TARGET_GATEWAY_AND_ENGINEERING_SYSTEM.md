# Source -> Workspace -> Target and engineering-system adoption

Date: 2026-10-07.

## Purpose

Keep the existing ELMA Wiki/project viewer, and add a second major capability: the service becomes a controlled intermediate layer between an ELMA development/source company and a target company.

The intended flow is:

```
ELMA SOURCE / DEV
      |
      | explicit connection + export
      v
immutable source snapshot (.e365)
      |
      v
ELMA Wiki project / workspace
  inspect
  document
  compare
  optionally edit supported code
  compile/check
  preview/review
  Storybook evidence
      |
      | explicit deployment plan
      v
ELMA TARGET / TEST / PROD
      |
      v
read-back export + verification
```

This does not replace the current upload-only mode. A user may still upload a .e365 manually and use the viewer without connecting any ELMA server.

## Product roles

### Source connection

A source is the ELMA company/environment where the current development state is authored.

The user explicitly configures or authorizes a source connection. Credentials are never committed and are not copied into project documentation.

A source action can:

1. identify target/version/capabilities;
2. list/export explicitly selected solution(s);
3. create an immutable snapshot;
4. import that snapshot into a Wiki project;
5. record provenance and source evidence.

The service must not continuously scrape or synchronize a source unless that behavior is separately designed and authorized.

### Workspace

The Wiki project is the review and engineering boundary.

It owns:

- immutable imported snapshot;
- parsed structural index;
- preserved original artifacts;
- developer workspace for supported editable artifacts;
- documentation generated from the snapshot;
- changes/checkpoints;
- compile/lint/validation evidence;
- visual/Storybook evidence where applicable;
- deployment plan;
- deployment/read-back evidence.

A source snapshot is never edited in place.

### Target connection

A target is an explicitly configured ELMA company/environment that may receive a prepared package.

Source and target are separate connection identities. Never infer target from source metadata or from URLs found inside scripts.

The target may be DEV, TEST, staging or production. The product stores the role explicitly.

PROD must remain a separately protected operation.

## Human workflow

Example:

1. Developer finishes a normal change in ELMA Designer on DEV.
2. In Wiki, selects the source connection and solution.
3. Clicks **Load current version**.
4. Wiki exports the selected configuration and creates a new immutable snapshot.
5. Project viewer shows modules, objects, forms/widgets, fields, functions, dependencies and provenance.
6. Developer/reviewer can inspect the snapshot and compare it with the previous snapshot or target snapshot.
7. For a supported code artifact, developer may open Developer Workspace, make a small edit, run TypeScript/ELMA compiler/lint checks and review the diff.
8. UI/visual states that are meaningful for review are represented in the project's Storybook review surface.
9. User chooses target and requests **Prepare deployment**.
10. System checks compatibility, source/target roles, supported round-trip capability and unresolved findings.
11. System builds a deployment candidate without changing target.
12. User reviews exact + semantic diff and evidence.
13. State-changing deployment requires explicit confirmation.
14. Tool deploys to the target through the authorized execution path.
15. Tool reads/re-exports the target state.
16. Tool verifies the intended package/version/source/runtime where supported.
17. Project records deployment evidence and rollback reference.

A successful command/HTTP/import exit code is not deployment proof.

## Connection and credential boundary

There are two valid execution models.

### Direct server connection

Allowed only where the Wiki deployment can securely reach the ELMA endpoint and a dedicated credential-storage design has been accepted.

Do not put tokens in project files, Git, logs or generated documentation.

### Local/private bridge

Preferred for private/on-prem networks.

```
Wiki control plane
      |
authorized job
      |
local bridge / execution agent
      |
ELMA source or target
```

The bridge keeps credentials in protected local storage and returns capabilities and structured evidence, not secrets.

The project stores a connection reference and safe metadata, not raw credentials.

The implementation must support source and target as separate named connection references.

## Snapshot model

Each source load creates a snapshot id.

A project may have many snapshots:

```
Project
  snapshot S1 - source DEV, 09:10
  snapshot S2 - source DEV, 12:45
  workspace W2 - based on S2
  candidate C1 - based on W2
  deployment D1 - target TEST
  verification V1 - read-back from TEST
```

Minimum metadata:

- ownerId;
- projectId;
- snapshotId;
- source connection reference;
- source role;
- ELMA/platform version when proven;
- solution identity/provenance;
- timestamp;
- content hash;
- parser/tool versions;
- original artifact reference;
- parse coverage/unknown/opaque report.

Snapshots are immutable.

## Workspace storage

Recommended logical ownership:

```
projects/<projectId>/
  snapshots/
  workspace/
  generated/
  docs/
  storybook/
  candidates/
  evidence/
```

Physical storage may be object storage + database.

Separate:

1. original immutable archives;
2. parsed/indexed model;
3. editable supported source;
4. generated runtime/types;
5. Storybook/review artifacts;
6. checkpoints;
7. deployment candidates;
8. target verification evidence.

Do not mix these into one mutable JSON blob.

## Compare modes

The product should support three explicit comparisons:

### Source snapshot vs previous source snapshot

"What changed in DEV since the last load?"

### Workspace vs source snapshot

"What did we change after loading from DEV?"

### Candidate/source vs target snapshot

"What will change on TEST/PROD?"

Every comparison has:

- structural/object-level summary;
- supported semantic summary;
- exact file diff where available;
- generated changes separated from hand-edited changes;
- unknown/unparsed differences surfaced rather than discarded.

## Storybook role

Adopt the reusable Dyk Storybook principles, not Dyk product stories.

For ELMA Wiki, Storybook becomes the current review surface for the Wiki's own UI and, where technically possible, for synthetic/derived previews of supported ELMA developer artifacts.

Core principles to port:

1. exactly one current Storybook authority for each current user-visible Wiki surface;
2. one renderer, two data sources: production ViewModel vs synthetic Storybook fixture;
3. Storybook is updated in the same task when visible behavior/state changes;
4. behavior-heavy capabilities have explicit workflow/state contracts;
5. review manifest maps capability -> action -> renderer -> stories -> required states;
6. current design targets are explicitly marked as not yet shipped;
7. screenshots/review are evidence, not a substitute for runtime verification;
8. Storybook never uses real customer configuration or credentials.

Do not copy Dyk Tasks/Chats/Master/Telegram/WhatsApp stories.

Create ELMA-specific groups such as:

- Production/Public;
- Production/Projects;
- Production/ProjectViewer;
- Production/Connections;
- Production/DeveloperWorkspace;
- Production/Deployment;
- Workflows/SourceImport;
- Workflows/WorkspaceChange;
- Workflows/TargetDeployment;
- Workflows/Verification;
- Design/* only for explicitly current unimplemented targets.

## Agent engineering system to port from Dyk

The Dyk repository contains a mature generic engineering/agent layer. Port the pattern and generic templates, then rewrite project-specific authority.

### Port/adapt

- canonical root AGENTS.md operating contract;
- nested AGENTS.md only where a directory needs stricter rules;
- .agent/capabilities.yaml task/context router;
- docs/INDEX.md-style human map;
- docs/STATE.md for verified current operational truth;
- docs/ROADMAP.md for parked/assigned product work, never automatic assignment;
- docs/STORYBOOK.md pattern;
- Storybook review manifest + workflow/state-contract concept;
- agent-doc consistency guard;
- generic templates for decisions, contracts, plans and runbooks;
- outcome-or-blocker closeout;
- proportional verification by changed boundary;
- explicit authority/provenance hierarchy;
- one fact, one home;
- current truth beats history;
- protect concurrent agent work;
- secrets/real customer data stay out of fixtures, screenshots and repository.

### Do not copy as authority

- Dyk PRODUCT_CONSTITUTION content;
- Dyk PRINCIPLES product semantics;
- Dyk Tasks/Chats/Summary/Master model;
- messenger/provider rules;
- Dyk journeys and story ids;
- Dyk deployment/provider specifics;
- Dyk mobile/parent-specific product assumptions.

These are source examples, not ELMA Wiki requirements.

## Proposed ELMA Wiki documentation homes

```
AGENTS.md
.agent/
  capabilities.yaml

docs/
  INDEX.md
  PRODUCT_CONSTITUTION.md       # new ELMA-specific product authority
  PRINCIPLES.md                 # executable ELMA Wiki principles
  STATE.md
  ROADMAP.md

  architecture/
    source-workspace-target.md
    storage.md
    connections.md
    developer-workspace.md

  contracts/
    source-import.md
    snapshot.md
    project-viewer.md
    target-deployment.md
    verification.md
    storybook.md

  workflows/
    source-import.md
    workspace-change.md
    target-deployment.md
    rollback.md

  runbooks/
    local-development.md
    storybook-review.md
    source-connection.md
    target-connection.md

  decisions/
  plans/
```

Existing docs such as E365_FILE_PROJECTS.md are not duplicated blindly. Their current facts move/link into the owning contracts during migration.

## Capability router proposal

Initial ELMA Wiki capabilities:

- public-site;
- auth-account;
- projects;
- e365-parser;
- project-viewer;
- source-connections;
- target-connections;
- developer-workspace;
- compiler-lint;
- storybook-system;
- deployment;
- verification;
- agent-system;
- operations.

Boundaries:

- ui;
- domain;
- storage/data;
- parser;
- connection/provider;
- compiler/tooling;
- security;
- ops;
- docs/content.

The router loads only the current authority for selected boundaries. It must not force every agent to read all ELMA research on every task.

## Product authority migration - separate task

The generic engineering layer can be ported from Dyk, but the product layer must be rewritten for this product.

Open a separate implementation task to define an ELMA Wiki Product Constitution and executable principles around the now-confirmed product model:

- existing .e365 viewer remains useful independently;
- optional source connection creates immutable snapshots;
- workspace is a review/change boundary;
- optional target connection receives explicit deployment candidates;
- target verification is mandatory for a successful deployment claim;
- Developer Workspace is for code, not a replacement visual Designer;
- Git, VS Code and AI remain optional clients/workflows;
- product must be understandable to an ELMA developer unfamiliar with Git;
- unknown/unsupported package content remains visible and preserved;
- credentials and customer data are protected;
- public claims follow shipped capability.

Do not copy Dyk's Product Constitution and rename nouns.

## Migration phases

### Phase 0 - inventory

Map every current ELMA Wiki document/rule to:

- current authority;
- historical evidence;
- implementation note;
- duplicate;
- missing owner.

No deletion before the map exists.

### Phase 1 - generic agent/governance skeleton

Add:

- adapted AGENTS.md;
- capabilities router;
- docs index/state/roadmap;
- templates/guards;
- minimal Storybook governance.

Preserve current product behavior.

### Phase 2 - ELMA-specific product authority

Separate task/PR: create Product Constitution + Principles and reconcile existing docs.

### Phase 3 - Storybook foundation

Create Storybook for the Wiki itself:

- shared renderer/ViewModel rule;
- synthetic fixtures only;
- review manifest;
- initial current surfaces;
- source/target/deployment workflow states.

### Phase 4 - source connection

Implement connection reference, source capability check, explicit export and immutable snapshot ingestion.

### Phase 5 - target candidate/verification

Implement target snapshot, compare, candidate, explicit deployment and read-back verification.

### Phase 6 - developer workspace integration

Connect supported code editing/compiler/lint/checkpoint work to snapshot/candidate model.

## First end-to-end acceptance scenario

Use only a synthetic or explicitly designated non-production ELMA setup.

1. Configure Source DEV connection reference.
2. Configure Target TEST connection reference.
3. Select one known solution on Source.
4. Load current version.
5. Snapshot is immutable and visible as a project revision.
6. Viewer displays parsed modules/objects and coverage.
7. Make one supported widget script change in workspace.
8. Check/compile passes.
9. Storybook/review evidence for affected Wiki UI is current.
10. Prepare target deployment candidate.
11. Show source/workspace/target differences.
12. Confirm deployment.
13. Deploy to TEST.
14. Re-export/read target.
15. Verify expected changed source/runtime/version.
16. Record evidence and rollback reference.
17. Original source snapshot remains byte-identical.
18. No raw source/target credential is stored in project files or Git.

## Non-goals of the first implementation

- automatic PROD deployment;
- bidirectional continuous sync;
- replacing ELMA Designer;
- editing every .e365 entity type;
- hiding unknown package content;
- using real customer configuration in Storybook;
- copying Dyk product semantics;
- allowing an agent to deploy merely because it can access the repository.

## Definition of done for this architecture task

This document is accepted as the target architecture only after:

- source and target are modeled separately;
- storage ownership is explicit;
- snapshot/candidate/evidence lifecycle is explicit;
- Dyk engineering artifacts are inventoried as port/adapt/do-not-copy;
- Storybook role is explicit;
- product-authority rewrite is tracked separately;
- no text claims the source-target runtime exists before implementation evidence.

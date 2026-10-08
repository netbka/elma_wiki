# Source and Target connections contract

Own explicit ELMA endpoint identities and safe execution routing.

## Invariants
- Source and Target are separate named connection references.
- Source is where an explicit snapshot export originates.
- Target is where an explicit candidate may be deployed.
- Never infer Target from Source metadata or script URLs.
- Raw credentials never enter Git/project files/generated docs/logs.
- For private/on-prem endpoints prefer a local bridge that keeps credentials locally.
- Connection tests are read-only.
- PROD is protected and outside the first E2E.

## Initial adapter shape
- capabilities()
- exportSolution(solutionRef)
- inspectSolution(solutionRef)
- deployCandidate(candidateRef) - Target only and gated
- readBack(solutionRef)
- health()

A failed Source load creates no successful snapshot. A failed Target operation never marks a candidate verified.

The read-only configuration adapter is implemented in config-source.mjs.
Its Docker export service, trusted server configuration, inspection-bundle
format and authenticated acquisition routes are defined in
[configuration acquisition API](config-source-api.md). It feeds the existing
Solution full/partial review engine and grants no Target execution capability.

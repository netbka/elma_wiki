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

## Predefined Target configurations: DEV and DEV2

`lib/target-presets.mjs` reads exactly two named Target configurations from
non-secret configuration variables (listed with placeholders in `.env.example`).
Each carries a display name, environment role, base URL/host, bridge target name
and allowed operations. PROD has no predefined configuration and stays refused.
Credentials never enter Wiki configuration; they stay on the operator-bridge
machine.

| Wiki Target | Role | Bridge `--target` (netbka/elma365 `elma-development/commands/bridge.mjs`) | Allowed operations | Variables |
|---|---|---|---|---|
| DEV | `shared-business`: shared business environment used with the partner company, which promotes that work to PROD | `main-dev` | `health`, `inspect`, `export`; deploy always refused in code | `WIKI_TARGET_DEV_NAME`, `WIKI_TARGET_DEV_URL`, `WIKI_TARGET_DEV_BRIDGE_TARGET`, `WIKI_TARGET_DEV_OPERATIONS` |
| DEV2 | `technical`: the owner's technical environment | `dev2` | `health`, `inspect`, `export`, `readBack`, `deploy`; deploy only for an owner-designated candidate | `WIKI_TARGET_DEV2_NAME`, `WIKI_TARGET_DEV2_URL`, `WIKI_TARGET_DEV2_BRIDGE_TARGET`, `WIKI_TARGET_DEV2_OPERATIONS`, `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` |
| PROD | — | not accepted by the bridge | none | none |

**Legacy name.** The bridge target `dev` historically resolved to dev2. It is
ambiguous: the bridge now accepts only `main-dev`, `dev2` and `test`, and Wiki
refuses `dev` as a bridge target for either preset. A worker label ending
`→ dev` never matches a predefined Target.

Rules enforced in code:

- `*_URL` is required. Missing, non-URL or credential-bearing values leave that
  Target listed but unavailable with a reason; no host is guessed. `*_NAME`
  defaults to `DEV`/`DEV2`; `*_BRIDGE_TARGET` defaults to the mapping above and
  any other value makes the Target unavailable. `*_OPERATIONS` defaults to the
  role maximum and may only narrow it; deploy also requires `health`, `inspect`
  and `readBack`.
- DEV2 whose host equals DEV's host, or either host listed in
  `PROTECTED_TARGET_HOSTS` (for example PROD), is unavailable.
- Deploy to DEV is refused (403) at `prepare` and `confirm` and in the adapter.
  Deploy to DEV2 requires the exact candidate SHA-256 to be listed in
  `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES`; the list is empty by default. It may
  contain only candidates the owner designated, today only the PLAN-01 P8
  Contracts candidate under the
  [dev2 acceptance designation](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers).
  `confirm` re-reads the configuration, so a withdrawn designation refuses a
  prepared attempt. All other delivery guards still apply, including typed
  confirmation and the composed-candidate native eligibility gate.
- The predefined connections (`preset-dev`, `preset-dev2`) appear in every
  actor's `/api/connections` list, cannot be removed and are not stored. Each
  actor executes through their own operator bridge: the online bridge whose
  worker runs the mapped `--target` and reports the configured host. Only the
  actor's own probe result is stored. A probed or delivery identity whose host
  differs from the configured host is refused (409).

A failed Source load creates no successful snapshot. A failed Target operation never marks a candidate verified.

The read-only configuration adapter is implemented in config-source.mjs.
Its Docker export service, trusted server configuration, inspection-bundle
format and authenticated acquisition routes are defined in
[configuration acquisition API](config-source-api.md). It feeds the existing
Solution full/partial review engine and grants no Target execution capability.

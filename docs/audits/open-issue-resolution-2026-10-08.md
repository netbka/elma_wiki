# Open issue resolution pass — 2026-10-08

Base: `8e20fd4b20af8b9a21bdb24de7ab317fa170bc62`. Assignment: resolve the
repository's open issues, without deployment or runtime changes. Current
Solution-first authority and all 14 open issues were reviewed. There were no
open PRs at the start; existing worktrees and unrelated parent edits were
preserved. This record distinguishes implementation from unmet acceptance.

## Implemented gap: physical accepted export association

#34 / #11 had no direct check connecting accepted Solution state to a physical
archive. `managedWorkspaceStore.acceptedExport` and the authenticated shared
Solution read/download routes now prove the bounded case where the current
accepted full export matches accepted component state. They preserve original
bytes and the complete inventory, including package/manifest metadata, and do
not create a candidate or invoke any deployment adapter.

Pending reviews, open findings, archive state, missing/stale revisions, corrupt
bytes, later accepted partial artifacts (even component no-ops) and retained
local reconciliation content are refused. A later matching, reviewed full
export establishes physical association again. Scope and stored acceptance
actors remain separate from native authors. See
[shared Solution contract](../contracts/shared-solutions.md#exact-accepted-export-association--34--11).

Evidence actually run locally against this change:

- 232 application tests passed on Windows, including four new store/API cases.
- Repository verification passed: 27 universal articles, empty public index,
  no internal information in that index.
- Final affected store/API pass: 19 tests passed after adding open-finding and
  private-ID regressions and checking acceptance actor evidence.
- Whitespace check passed. Current remote main was refreshed and remained the
  base above.

There is no visible UI change, so no new renderer or Storybook state is needed.
These tests use synthetic archives and real local HTTP authentication/storage;
they do not prove live ELMA import, native history or user acceptance. No service
rollout, live data migration or runtime configuration change occurred.

## Remaining gates by owning issue

| Issues | Current evidence / implemented scope | Concrete remaining requirement |
| --- | --- | --- |
| #34, #11 | Existing engine, releases and bridge; this pass adds exact accepted-full-export association | Bind the association to the existing frozen release/candidate workflow, prove dependencies/native import semantics, and perform separately authorized TEST delivery/read-back. Mixed virtual states still cannot be rebuilt into packages. |
| #55 | Shared catalog, stable actors, attribution and legacy isolation are implemented and tested | Identify/classify particular legacy private records and obtain their explicit admission decision before copying; this task provides neither a designated private runtime store nor per-record decisions. No migration occurred. |
| #47 | Offline comparison and truthful unknown authorship are implemented; native-history investigation has prior documentation evidence | Approved exports/history correspondence for the requested object types and controlled two-user publication/revert evidence. This task does not authorize those runtime changes. |
| #19 | Existing durable orchestrator/worker/CI repair foundations and synthetic evidence | Configured provider/runner connections and a bounded authorized live pilot, including Dev2 delivery and version-bound screenshot/business acceptance. No live credentials, designated pilot or runtime-change authorization was provided. |
| #59 | Synthetic/browser developer paths exist | Two real uncoached participants: one ELMA-familiar technical user and one technically literate user who has not read repository docs. Record their actual behavior and fix observed defects. |
| #41 | Prior direct developer visual pass and fixes are recorded at the base | Independent integrated visual review, coordinated with the participants above; automated checks do not supply independent human evidence. |
| #37, #35, #56, #30 | Integrated lifecycle, shell/next action and contextual Learn/code/review implementation already have developer evidence | Their explicit independent first-use/visual requirements remain #59/#41; do not start a second navigation or review engine. |
| #38, #52, #33 | One canonical product contract, contradiction register and integrated implementation | Owner walkthrough and explicit final acceptance after the independent gates; reserve this decision for the owner. |

All 14 issues remain open for those unmet requirements. This pass does not claim
final acceptance, migration, a deployable mixed package or live Verified state.

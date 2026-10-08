# Open issue resolution pass — 8 October 2026

Starting main: `8e20fd4b20af8b9a21bdb24de7ab317fa170bc62` (#74).
Current authority remains Solution -> Change -> Review -> Done. This pass
inspected all 14 open issues and current merged work before changing code.
The primary checkout and its private ignored artifacts were retained; changes
use an isolated worktree. No deployment or native ELMA operation is authorized.

## Finding and correction (#41)

Goal: continue a review with a blocking finding. On the real review page,
the primary Add correction link and Upload another version link touched,
obscuring their different consequences. A browser regression failed on the
original renderer. The production renderer now uses its existing action group
to separate these links and reflow them at narrow widths. The current
ReviewFindings Storybook description explains the action hierarchy.

Interaction cost remains one action and one navigation to correct the same
Change, versus choosing a separate full-version update. No new destination,
input or loss of Solution/Change context was introduced. Regression evidence
checks separation in real browser geometry at 1440px and 390px, then exercises
the complete acceptance/correction/reconciliation/archive/recovery journey.

Fresh desktop/mobile overview, blocking-finding, conflict, stale-anchor,
load-error and captured-process screenshots were visually inspected. Findings
block acceptance, corrections remain primary, stale anchors retain their
source, recovery offers retry, and narrow review retains context. This is
another developer/agent pass; it is not the independent human review required
by EXPERIENCE_REVIEW.md, uncoached participant evidence or owner acceptance.

## Human acceptance (#59 / #38)

The owner reports that both required participant types are available. Added
`tools/usability-session.mjs`: loopback-only, new synthetic storage, full/change/
later-full inputs and two distinct signed synthetic identities. It uses the
actual product/API and existing editor; no customer export, real message
transport, credentials or Target is used. Its observation file begins with
unperformed tasks and null outcomes. Existing storage is never reused.

[Uncoached tasks and observer procedure](../workflows/uncoached-usability.md)
keep participant tasks separate from click guidance. Only actual results can
complete #59. Independent integrated visual review is recorded separately;
then the owner records accepted/deferred gaps in #38.

## Legacy classification (#55)

`tools/legacy-inventory.mjs` inventories a selected existing local directory
without reading exports, credentials or the shared root. It records metadata
fingerprints, opaque ownership/upload/snapshot provenance and unknown
classification; malformed records remain explicit. It writes a new private
report, never admits data or alters originals. Unavailable storage fails rather
than producing a false empty inventory.

The selected primary checkout's local storage contained **0 legacy records**.
This is a local directory result, not the deployed service inventory. Owner
retention/migration decisions and any separately authorized deployed migration
remain unobserved. New shared Solutions retain their existing explicit admission
boundary and legacy records stay private.

## Native history (#47)

The old missing-second-user/historical-body blocker is superseded for one
controlled dev2 widget by published parent-repository evidence. This pass
read those records; it did not repeat native tests.

| Question | Recorded evidence / limit |
| --- | --- |
| Two unchanged exports | All 13 entity/script/resource contents matched |
| Published change and draft boundary | One intended widget changed; 12 others stayed equal; unpublished draft absent from tested CLI export |
| Two native publishers | Distinct authors on controlled versions 36/37 |
| Historical body | Native row ID, widget ID, numeric version and author matched; descriptor/runtime matched corresponding fresh exports for versions 35–38 |
| Edit/revert | Both events retained despite eventual zero content difference |
| Old/general export association | Unproven; export manifest markers differ from native row IDs; equal content is not a unique version identity |
| Processes/applications | Separate freshness/history correspondence unknown |
| Native stale-write/version lock | Unverified; portal revision guards do not prove native lock behavior |

Published records: [one-widget export/draft/pagination investigation](https://github.com/netbka/elma365/blob/aa280a1f13c8487d71a99da19c7bbe0003090baa/docs/dev2-history-verification-2026-10-07.json),
[two publishers and historical bodies](https://github.com/netbka/elma365/blob/aa280a1f13c8487d71a99da19c7bbe0003090baa/docs/dev2-two-author-history-verification-2026-10-08.json).
Merged [MCP #2](https://github.com/netbka/elma365-mcp/pull/2) and
[MCP #3](https://github.com/netbka/elma365-mcp/pull/3) provide bounded readers.
Do not infer field authors or build another history/merge engine.

## Remaining issues

| Issue | What still prevents closure |
| --- | --- |
| #59 | Actual uncoached observations from both available participant types |
| #41 | Independent integrated human visual review; the touching-action defect is fixed in this pass |
| #38 | Owner walkthrough and explicit accepted/deferred decisions after #59/#41 |
| #30, #35, #56 | Their implemented first-use/navigation work retains the same human acceptance dependencies; no second navigation rebuild |
| #37 | Human integrated acceptance alongside the separately passing synthetic E2E |
| #52, #33 | Coordination/final product acceptance, plus the separately tracked migration/native/delivery gates |
| #55 | Inventory/classification of actual deployed legacy storage and owner retention/admission decisions; no automatic exposure |
| #47 | General Source/object/native-version association, process/application cases and native stale-write evidence |
| #34 | Exact physical candidate handoff through #11; virtual mixed state remains non-deployable |
| #11 | Explicit physical accepted candidate, usable non-production Target and authorized native import/read-back under the exact inventory policy |
| #19 | Private bot/provider/repository bindings and an authorized live execution/repair pilot; synthetic worker contracts do not supply them |

## Verification

Before changes: **228/228** local unit/contract tests passed. After the two new
tool contracts: **230/230**, no failures or skips. Public-data verification,
108-story catalog validation, editor/static Learn and Storybook builds passed.
Actual local Chrome passed the complete Solution journey and 30 Storybook
states, captured process/form reconstruction/simulation and exact private
source/static learning journeys. The action-separation regression failed before
the fix and passed afterward at desktop/mobile widths. QA screenshots/JSON
and session/inventory reports remain ignored. These results are local evidence,
not a claim about a new GitHub CI run, human acceptance or a serving release.

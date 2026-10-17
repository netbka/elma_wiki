# UX-10: review clarity fixes from the UX-09 agent pass

Owner direction 2026-10-17: plan the fixes for the open findings of
[ux-09-agent-pass-2026-10-17.md](../audits/ux-09-agent-pass-2026-10-17.md);
the Solution UI is desktop only, so no mobile work is planned. Blockers 1, 3
and 4 of the pass are already on main (#160 via #163). This plan covers the
rest. Authority and vocabulary rules: [intuitive-solution-ui-2026-10-15.md](intuitive-solution-ui-2026-10-15.md)
sections 7 and 12; every new string goes through `web/managed/labels.js` and
`tools/ui-strings.mjs`.

## Scope

| Item | Pass blocker | Outcome | Owners | Size |
| --- | --- | --- | --- | --- |
| UX-10a | 2 | The header no longer says "Принято" over a page that asks for a review. When a review is open, the badge is `statuses.awaitingReview` or `statuses.conflict` (projected from the pending review, not from the accepted version) and the headline adds "Рассматривается: версия от …". The accepted version stays on the second line as "Текущая: версия от …". Stepper: "Рассмотрение" is `сейчас`, not `готово`, while a review is pending | `web/managed/model.js` (`solutionStatus`, `lifecycleSteps`), `web/managed/render.js` header, `storybook/stories/ManagedWorkspace.stories.js`, `test/managed-workspace-view.test.mjs` | 1 day |
| UX-10b | 5 | The generated "Для чего" draft opens with the business process derived from process and screen names ("Заявка на командировку и её утверждение") and puts the module list second; the limits sentence stays last. When no process or screen name is found, the empty state with "Написать" is primary and generation is the secondary button, per the plan's `ifWrong` for `about-generated` | `lib/solution-about.mjs`, `web/managed/labels.js` (`about.purposeIntro`), `web/managed/fixtures.js`, `test/solution-about.test.mjs` | 1 day |
| UX-10c | 6 | One word per concept on a change card: "Просмотрено" is the personal mark; the acceptance checkbox and the gate reason use the same phrase "Подтверждаю изменение" / "Подтвердите каждое изменение". The dialog's disabled-accept reason quotes the checkbox label | `web/managed/labels.js`, `web/managed/render.js`, `web/managed/model.js` (`reviewGate`), tests | half a day |
| UX-10d | 8 | The dependency chip is shown only when the version has changes, links to the "Зависимости решения" section, and reads "Зависимостей требует проверки: N". The stepper reason ("нет сборщика") loses bold | `web/managed/render.js`, `web/managed/styles.css`, `web/managed/labels.js` | half a day |
| UX-10e | 9, 10 | On "О решении" the primary button is the next action from the stepper (as the build story already does); "Открыть решение" becomes a secondary link named for what it opens, "Открыть просмотр объектов". The module card's "Объяснение" box gets one hint line, "Короткое объяснение модуля простыми словами", above "Объяснить" | `web/managed/render.js`, `web/managed/labels.js`, stories `about-*` | half a day |
| UX-10f | 11 | Plurals through one helper ("1 экран", "3 экрана", "5 экранов"); the comment submit button becomes "Отправить комментарий"; the author line shows the display name when known and otherwise the login without an initial avatar | `web/managed/model.js`, `web/managed/render.js`, `web/managed/labels.js` | half a day |
| UX-10g | 7 | Business module names. Investigate first: whether the `.e365` workspace package carries a display name (`workspaces/<code>` in `lib/e365.mjs`). If yes, parse it into `namespaces[code].name` and show it as the module heading with the code muted. If no, keep the code and close the item with that evidence; no name is invented. **Delivered 2026-10-17:** ELMA exports each section as a `pages` record in the `global` namespace (`type: NAMESPACE`, `code` = section code, `name` = display name); the existing parser already keeps that name on the component. `moduleNames`/`moduleLabel` in `web/managed/model.js` name module cards, headings and request targets from it with the code muted; the section page is grouped into its own module as a system object instead of a `global` module. Modules without a section page keep the code | `lib/e365.mjs`, `lib/project-parser.mjs`, `web/managed/model.js` (`objectModule`), synthetic fixture | investigation half a day, then 1 day if names exist |

Not planned: pass item 12 (phone width). Owner decision 2026-10-17: desktop
only. The 390 px checks in the #41 checklist and the PR rules of section 12 of
the intuitive-UI plan stop applying to the Solution UI; the checklist row is
removed in UX-10a's PR.

## Delivery status 2026-10-17

UX-10a to UX-10f are delivered together on one branch, stacked on UX-10g:

- a: while a review is open the headline reads "Рассматривается: версия от …" (or "Рассматривается новая версия" without a snapshot date) with "Текущая: версия от …" on the second line; the badge and stepper projection were already in place. The 390 px checklist step now applies to public pages only.
- c: the change-card checkbox is "Подтверждаю изменение" and the gate reason quotes it (`gates.confirmChange`, `gates.confirmEachChange`).
- d: the dependency chip reads "Зависимостей требует проверки: N", appears only when the version changes something and links to `#solution-dependencies`; the stepper reason is no longer bold.
- e: after acceptance the primary action is "Обновить" (a new version); "Открыть просмотр объектов" is a secondary link on О решении; module cards carry "Короткое объяснение модуля простыми словами" above Объяснить.
- f: `plural` in `labels.js` gives "1 экран / 3 экрана / 5 экранов" for module counts, search results and pending reviews; an e-mail login is shown as is without invented initials; a known name keeps its initials. "Отправить комментарий" was already the decision-dialog label.
- b: the "Для чего" draft opens with the declared process and screen names, modules second, limits last; without such names "Написать" opens an empty editor and "Составить черновик по экспорту" is the secondary choice.

## Order and dependencies

UX-10a -> UX-10c (both touch the review header and gate) -> UX-10d. UX-10b,
UX-10e and UX-10f are independent and can go in any order after UX-10a.
UX-10g starts with the investigation and does not block the others. One PR
per item, stacked on the previous verified head; merge up, never rebase.

## Verification per item

- `node --test test/managed-workspace-view.test.mjs test/ui-labels.test.mjs`
  plus the item's own test file; `npm run check:storybook`.
- `node tools/managed-workspace-browser-check.mjs` after
  `npm run build:storybook` (the real synthetic flow and all shared stories).
- Before/after screenshots at 1920 px in the PR description; the 390 px
  capture is dropped.
- The six `design-validation` five-second stories are re-read by the agent
  the way the pass did it; the expected `correct` strings in
  `web/flows/design-validation.js` are updated when a label changes, and the
  label deck keeps covering every section 7 label.

## Done when

The six five-second stories read correctly on a cold agent pass, the label
deck has no card whose rendered text differs from its vocabulary entry, and
the human UX-09 sessions can start on the final labels. The integrated
revision for the #41/#59 readiness (plan section 10.1, item 3) is tagged
after UX-10 lands.

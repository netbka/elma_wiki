# Intuitive Solution UI: one fixed path, understanding first, plain-language change requests

Status: proposed plan, not implemented behavior. Written 2026-10-15 from an
uncoached walkthrough of the deployed Wiki (Solution "DEV — Контрагенты.
Управление договорами", review artifact `59fe926d…`), a survey of comparable
products, and the owner's direction of the same day (section 2). Authority
stays with [SOLUTION_FIRST_PRODUCT_PLAN.md](../SOLUTION_FIRST_PRODUCT_PLAN.md).
This plan removes optional paths from the user-facing product and changes
presentation, wording and information architecture inside the existing
Solution -> Changes -> Compare and resolve -> Review -> Build -> Verify -> Release model.
It does not add a role model, a second renderer, a second engine or any live
ELMA write.

Coordinates: #56 (Solution shell and one next action), #59 / #41 (uncoached
usability and independent visual review, deferred by the owner), #38 (final
owner acceptance), #94 MR-06 (composer screen, open PR #123), #85
(contextual bug reports), config-source acquisition API (owner-assigned
2026-10-08). Capabilities: `managed-workspace-ui`, `solution-visual`,
`solution-explanations`, `bug-reports`, `source-connections`,
`storybook-system`. Boundaries: ui, content, tooling, connection (read-only
Source export through the existing acquisition API); domain and storage only as
additive read-only projections plus one small record type (change requests).

## 1. Why: what a non-technical user sees today

Walkthrough date 2026-10-15, production Wiki, signed-in analyst, no coaching.
Observed facts:

| # | Observation | Effect on the user |
| --- | --- | --- |
| W1 | The review page renders every object of the Solution as a card. The reviewed export has 398 objects and 0 changes; the page is ~400 cards reading "Без изменений · Ответственность: P · Было и стало" (~196 000 characters of text). | The one fact that matters ("nothing changed") is never stated. The user scrolls for minutes and cannot answer "what changed?". |
| W2 | Objects are labeled by internal keys: `_sep_1f40a8cc-…`, `form_01a11b42-…`, `019f3cd7-…`, `additional_docs@__directory`, 32 rows named `__default`. The parsed model already carries business names (`entity.name`); the process preview uses them ("Согласование", "Проверка контрагента"). | The user cannot connect a row to anything they know from ELMA. |
| W3 | Responsibility is a single letter "P" on every row and in the header. | Person, team or placeholder? No name, no link. |
| W4 | Disclaimers are legal/engineering sentences repeated per card ("Заявленная командой ответственность. Авторы публикаций ELMA и договорная ответственность не установлены", "Неизвестная база не даёт права на автоматическое объединение или сборку", "Переход не поддерживается: 453d4cc3-…"). A raw JSON block sits one click from the main flow. | Read as "the system is broken" rather than as a status. |
| W5 | The dependency section repeats "Зависимость не найдена в полученных данных" ~40 times for a handful of targets. | Noise hides the decision input. |
| W6 | The Solution tab is a flat 398-row table (Объект / Ответственность / Состояние / Просмотр) without grouping, search or filter. | No way to find "the contract approval process". |
| W7 | The Changes tab shows one card with two links; no list with author, date, status, comments; no activity feed anywhere. | A team cannot see who did what or what waits on whom. |
| W8 | The lifecycle is invisible. PR #123 adds a "Сборка" tab and new next actions, still without a map of where the user is. | The user does not know what follows acceptance or that build and release exist. |
| W9 | The decision is a checkbox "Принимаю версию и выбранные решения; установка в ELMA не выполняется" plus "Принять версию", after the 400 cards and the dependency list. | The decision is far from the summary that justifies it. |
| W10 | Add solution / Add change ask the user to declare full vs partial scope, same Source, responsibility, an optional declared base and an optional component scope. The reviewed change has `baseDeclaration.status: unknown` because nobody filled it in. | Questions the user cannot answer produce "unknown" states that then block everything downstream. |
| W11 | What works: Solutions list and Overview follow "status, attention, one green action"; the process preview with named steps and a diagram was the one screen a business user understood; "Объяснить решение / этот процесс / этот шаг" exists and reads well. | Keep these; extend their shape to the rest. |

The gap is not the engine or the evidence model. It is the number of optional
paths offered to the user and the presentation layer in `web/managed/render.js`,
`web/managed/model.js`, `web/managed/acquisition.js` and `web/visual/render.js`.

## 2. Owner direction (2026-10-15) and what it removes

The owner's instruction, recorded here as the assignment for this plan:
flexibility may be removed. Work always starts by selecting the source server
and the solution and pulling the entire solution. After that the person must
understand what the solution is about and what problems its modules solve
(for example, agreements), learn the flows, the screens and the functionality,
review what changed, and write their own requests for changes to layout, flow
or data structure, without understanding ELMA mechanics.

Consequences adopted by this plan (each is an "if" removed from the product):

| Removed option | Replacement | Engine impact |
| --- | --- | --- |
| Manual `.e365` upload as the primary way to add a Solution or a change | One entry: choose server, choose solution, "Загрузить решение". Manual upload remains only under "Прежние загрузки" (legacy compatibility, as the product plan already states). | None; the acquisition API already supports "load one/all solutions from DEV/dev2". |
| Full vs partial scope question | Every pull is a full snapshot of one solution from a named Source. There is no partial path in the primary UI. | The engine keeps partial support internally; the UI never asks. |
| "Same Solution / same Source" confirmation | Implied by the selected server and solution; shown as a fact, not asked. | Same-Source assertion filled by the server from the connection reference. |
| Declared base and component scope | The base is always the previous pull of the same solution from the same server. Provenance is never "unknown" on this path. | `baseDeclaration` filled by the server (`method: source-sequence`); existing reducer and digests unchanged. |
| Responsibility declaration at upload | Dropped from the entry form. Responsibility is shown from the record of who pulled and who decided; team responsibility is set, when needed, from the change review by a person who knows. | Field stays optional in the API. |
| "Принимаю версию…" checkbox plus three buttons | One decision dialog with three verbs (section 6). | None. |
| Four preview chips and per-card disclaimers | Two chips and one "Подробнее" per page. | None; the distinctions stay in the data and in the disclosure. |

Owner decisions recorded 2026-10-15 (chat, after PR #126 was opened):

- Servers offered by the fixed entry: DEV (main) and dev2, read-only export
  through the existing acquisition API. Confirmed by the owner. No other server
  is listed without a new owner decision (`live-selection-and-release`).
- This direction is recorded in the contradiction register in this PR
  (`product-authority-change`); see section 11.
- Human five-second and label tests (R3, UX-09): the owner delegated the
  classification. Decision: they are design validation, not #59/#41 work, as
  long as they use Storybook stories with synthetic fixtures, ask single
  comprehension questions rather than the ten-task protocol, and write nothing
  into a `#59` observation record. #59/#41 stay deferred and their evidence
  stays separate.

## 3. Goal and non-goals

Goal: a person who knows ELMA as a user, has never read Wiki documentation and
receives only a link can, within one screen each, answer: what is this
Solution for, how does it work, which screens does it have, what data does it
keep, what changed since last time and who changed it, what needs my decision,
what happens next, and how do I ask for a change. Every screen has one obvious
primary action, secondary actions only when they apply, and no engineering
vocabulary.

Non-goals: no role/permission editor, no removal of truth labels (unknown stays
unknown where the data is unknown), no external AI, no change to the reducer,
storage identity, evidence binding or delivery coordinator, no Git/Storybook/
parser words in the product UI, no second request system beside the existing
bug-report and request-bot transports.

## 4. Design principles (hypotheses with a validation step in section 9)

1. **One path.** There is exactly one way to start and one way to update.
   Anything else is legacy under a disclosure.
2. **Understanding before inventory.** A Solution opens with what it is for,
   who uses it and how it works, in words and a diagram, before any table.
3. **Summary before detail.** Every page opens with the answer and the
   recommended action above the fold; evidence follows.
4. **Changed first, unchanged hidden.** Unchanged content is one collapsed
   line with a count (GitHub, GitLab, Gearset, Terraform all do this).
5. **Business name first, technical key second.** The key is muted text or a
   tooltip, never the only label.
6. **One primary button per page.** Everything else is a link or lives behind
   one disclosure. At most two disclosure levels (NN/g).
7. **Status as chips, not sentences.** One chip per fact, one full explanation
   per page, never per row.
8. **People are people.** A name with initials, never a bare letter or an
   e-mail-only string.
9. **Show the map.** The lifecycle stepper is on every Solution page; steps
   that are not implemented are visible, disabled, with a two-word reason
   (law 7: never expose unimplemented capability as working).
10. **A request is written where the problem is seen.** From a screen, a step
    or a field, in plain language, with the object attached automatically.
11. **Same words everywhere.** One vocabulary (section 6) is the only source
    of labels.

## 5. Step 0: research of comparable products

Performed 2026-10-15 from public documentation and blogs (sources in section
12). Products chosen because they solve the same job: pull a configuration
built by several people from one environment, understand it, compare versions
and move it on.

| Product | Pattern worth borrowing | Decision for Wiki |
| --- | --- | --- |
| Gearset (Salesforce compare and deploy) | Comparison starts by picking source and target orgs from a list; then a ribbon of status buttons with counts: "Changed items", "New items", "Deleted items", "All items", "Selected items"; stacked column filters (type, changed by); row expands to sub-components and dependencies; unchanged items grayed; side-by-side diff below with switchable views. | Adopt pick-from-list entry, status ribbon with counts, stacked filters, row expansion, "unchanged = grayed, not listed". |
| Salesforce DevOps Center | A work item is one change with its own change list (name, type, operation, last modified by/date); one button moves it to "In Review"; pipeline stages shown as a row. | Adopt "one Change = one work item" rows with author/date/status and the stage row. |
| Microsoft Power Platform pipelines | Stage cards in fixed order ("Deploy to Test" -> "Deploy to Production"), one button per stage ("Deploy here"), preflight checks before confirmation, deployment notes, run history with status. Stages cannot be skipped. | Adopt the fixed stage row with one action per stage and preflight summary before confirmation (maps to Build -> Verify -> Release). |
| GitHub pull request review | "Viewed" checkbox collapses a file; header shows progress; "Changed since last view" badge when a file changes after review; one review dialog with Approve / Request changes / Comment. | Adopt per-object "Просмотрено" with progress and stale badge; adopt the single review dialog. |
| GitLab merge request | Large and generated diffs collapsed by default; before/after screenshots required for UI changes. | Adopt collapsing of system-generated objects; require before/after screenshots in every UX PR. |
| Figma branch review | Changes grouped by page, collapsible; side-by-side or overlay before/after; one "Add your review" entry with "Approve / Suggest changes"; status badge beside the branch name. | Adopt grouping by application/process, the single entry point and the header badge. |
| Terraform Cloud run | One summary line ("N to add, N to change, N to destroy"); "Confirm & Apply" / "Discard" after reading the plan; no-op resources hidden. | Adopt the one-line summary as the first element of the review page. |
| ServiceNow update sets | Collision list with explicit "Accept remote / Skip remote / Compare with local". | Adopt explicit per-conflict verbs over the existing whole-object resolution engine. |
| Notion / Confluence style product docs (owner's "what problems the module solves") | A space opens with an overview page: purpose, audience, key flows, then the detail pages. | Adopt the "О решении" overview as the first tab, generated from captured data and edited by people (existing explanations capability). |
| ELMA365 itself | Native nouns: "Решение", "Приложение", "Процесс", "Форма", "Справочник", "Модуль", "Экспорт/Импорт", "Версия"; no built-in configuration diff; export of a solution is one action. | Use ELMA's nouns for object kinds; "Загрузить решение" mirrors ELMA's one-action export. |
| NN/g progressive disclosure | At most two levels; label the control with what the user will find; show only core features first. | Hard rule for this plan. |

Research still to perform before UX-02 (implementing agent, no owner decision):

- R1 (partly done 2026-10-15 from ELMA365 help, recorded in `web/managed/labels.js`: ELMA uses "Раздел" for the workspace level, "Приложение", "Бизнес-процесс", "Страница", "Форма", "Справочник"; the owner's "Модуль" and the user word "Экран" are kept). Still to do: capture the exact Russian labels ELMA365 Designer uses for application,
  process, form, directory, module, permissions and localization from DEV
  screenshots already in private evidence, so Wiki object-kind labels match
  what users see in ELMA.
- R2. Measure on synthetic fixtures how many objects fall into each kind to
  decide default grouping and the "system objects" set.
- R3. Five-second test of the proposed "О решении" page and the review summary
  with three colleagues on static Storybook stories: can they say what the
  solution is for, what changed and what the next step is? Recorded in the
  Storybook review panel; not #59 evidence (section 10).

## 6. Information architecture

### 6.1 Entry: Solutions home (`/solutions`)

- Primary button: **Загрузить решение**. It opens one dialog: *Сервер*
  (list from `GET /api/config-source/servers`, two entries today), *Решение*
  (list from `/servers/:server/solutions`, with business name and code), one
  button **Загрузить**. No other fields. Progress states reuse the acquisition
  renderer: `Выгружаем с сервера…`, `Разбираем…`, `Готово`, `Не удалось ·
  Повторить`. Paid or failed members are listed as facts with the same chips
  used elsewhere.
- Each Solution card shows: name, server, status badge (`В работе`,
  `Ожидает рассмотрения`, `Конфликт`, `Принято`, `В архиве`), last actor with
  initials and relative time, and the one recommended action as its only
  button.
- Left rail: `Решения`, `Архив`, and `Прежние загрузки` (legacy manual
  upload, unchanged behavior).

### 6.2 Solution header and lifecycle stepper (every Solution page)

```
Договоры и контрагенты · DEV                  [Ожидает рассмотрения]   Версия от 15 окт., 11:27
О решении · Как работает · Экраны и данные · Изменения · Запросы · Сборка (PR #123, contextual)
Загрузка ✓ ── Сравнение ● ── Рассмотрение ○ ── Сборка (нет сборщика) ── Проверка ○ ── Выпуск ○
                                                                [ Рассмотреть изменения ]
```

- The stepper is a read-only projection of `solutionNextAction` and the
  composer state from PR #123; it adds no state. Unavailable steps are grey
  with a two-word reason.
- The header has one primary button: the recommended next action.
- **Обновить** (pull again from the same server) is a link in the header; it
  is the only way to create a new version on the primary path.

### 6.3 О решении (replaces Обзор as the first tab)

Generated from captured data by the existing explanation engine
(`declared-source-v1`) and edited in place by people, with author and history:

1. **Для чего** — one paragraph: what the solution does, for whom, which
   business objects it manages (from applications, directories, process names
   and localization). Editable; empty state says "Опишите, для чего это
   решение" with one button **Написать**.
2. **Модули** — one card per application (`Договоры`, `Контрагенты`,
   `Дополнительные документы`…): purpose sentence, counts of processes,
   screens and directories, link **Открыть**.
3. **Что требует внимания** — the existing attention block and the
   recommended action.
4. **Последние события** — activity list from existing attributed records:
   loaded, commented, requested changes, resolved, accepted, archived; actor
   initials and relative time.
5. Disclosures: `Версии и история`, `Зависимости`, `В архив`.

### 6.4 Как работает (processes)

The existing process preview promoted to a tab. Left: list of processes grouped
by module, with business names and a one-line generated purpose ("Согласование
договора: проверка контрагента, маршрут согласования, подписание"). Right: the
diagram, the step list in plain words, and for the selected step: who does it
(lane), what they fill in (fields), where it goes next (transitions), and the
saved explanation. Two chips only: `Схема: из экспорта` and `Поведение в ELMA:
не проверено`. Unsupported transitions and bindings in one collapsed list with
a count. On every process and step: **Запросить изменение** (section 6.7).

### 6.5 Экраны и данные (forms and data structure)

Per module: **Экраны** (forms by business name, each with the reconstructed
preview and its fields), **Данные** (applications and directories as tables of
fields: name, type, required, where it is used). Search by name and key. System
objects (`__default`, permission rows, localization) collapsed under
`Служебные объекты · n`. On every screen and field: **Запросить изменение**.

### 6.6 Изменения (versions and review)

A list, not a card: Версия · Загрузил · Дата · Состояние · Замечания · Действие,
sorted needs-decision first, then in review, then accepted history. Opening a
version shows the review page in this order:

1. **Summary line.** "Изменено 3 · Добавлено 1 · Удалено 0 · Конфликтов 0 ·
   Без изменений 394". With no changes: "Эта версия не отличается от текущей"
   and the actions **Закрыть без изменений** / **Обновить ещё раз**.
2. **Facts as chips.** `Основа: версия от 8 окт.` · `Сервер: DEV` ·
   `Загрузил: Пётр М., 15 окт.` One **Подробнее** opens the full explanation
   and the existing evidence JSON.
3. **Decision.** One button **Решение по версии** opening a dialog with
   `Принять`, `Запросить доработку`, `Только комментарий`, a comment field and
   the confirmation text; disabled with a reason while a gate is closed
   ("Сначала выберите версию для 2 конфликтов").
4. **Status ribbon with counts**: `Изменено (n)` `Добавлено (n)` `Удалено (n)`
   `Конфликт (n)` `Все (n)` `Просмотрено (k из n)`; default hides unchanged.
5. **Changed objects**, grouped by module, then kind (Процессы, Экраны,
   Данные, Права, Прочее). Row: business name, kind icon, muted key, change
   chip, actor initials, **Просмотрено**. Expanding shows parts (steps,
   transitions, fields) with chips and the before/after for that object only.
   A changed process row offers **Открыть схему** showing changed steps
   highlighted on the diagram.
6. `Без изменений · n · показать` and `Служебные объекты · n · показать`.
7. **Dependencies** grouped by target with counts and one sentence per page.
8. **Комментарии и замечания**, unchanged, with initials and relative time.

### 6.7 Запросы (change requests in plain language)

A person asks for a change without knowing ELMA mechanics:

- Entry points: **Запросить изменение** on a process, a step, a screen, a
  field, or the tab's own **Новый запрос**.
- Form: *Что изменить* (three large choices: `Экран`, `Процесс`, `Данные`),
  *Где* (filled automatically from the entry point: module, object, step or
  field, with business name; editable by picking from the tree), *Что
  должно быть* (free text), *Зачем* (free text, optional), *Срочность*
  (`Обычная`, `Срочная`). Screenshot and pencil marks reuse the existing
  bug-report capture. One button **Отправить**.
- Storage: a `change-request` record in the Solution's private store with
  actor, time, anchors (object identity and digest, as findings already do),
  status (`Новый`, `В работе`, `Выполнен`, `Отклонён`) and comments.
  Publication to the configured GitHub repository reuses the bug-report
  transport (same consent step, same states); the request-bot ingress may pick
  it up later. No new external system.
- The tab lists requests with status, author, where, and the linked version
  that fulfilled them (set by a person on acceptance). A request anchored to
  an object shows on that object's row as a chip `Запрос · 1`.

## 7. Vocabulary and labels

Rules: Russian, verb-first buttons, nouns for tabs and chips, no abbreviations,
no parentheses, no sentences on buttons, one word for one thing on every page.
Rejected alternatives are recorded so choices are not re-litigated silently.

| Concept | Label | Rejected | Why |
| --- | --- | --- | --- |
| Solution | Решение | Проект, Конфигурация, Workspace | ELMA's own term; Workspace is an internal object by contract |
| Source server | Сервер | Источник, Source, Подключение | What the user calls it; "источник" is the contract word, not the user's |
| Pull the solution | Загрузить решение | Добавить решение, Импорт, Экспорт, Снимок | One action, one verb; "экспорт/импорт" are ELMA directions, confusing in Wiki |
| Pull again | Обновить | Обновить версию, Новый снимок | Short; the result is a new version |
| Version | Версия от 15 окт. | Снимок, Артефакт, Baseline | Users think in versions by date |
| Module | Модуль | Приложение, Раздел | Owner's word; ELMA "приложение" is kept in the Данные tab for the data object kind |
| Overview tab | О решении | Обзор | Says what it contains |
| Process tab | Как работает | Процессы, Схемы | Business framing of flows |
| Forms and data tab | Экраны и данные | Формы, Объекты, Структура данных | Users say "экран"; "данные" covers applications and directories |
| Versions tab | Изменения | История, Версии | Already used; "что изменилось" is the question |
| Requests tab | Запросы | Задачи, Замечания, Баги | Neutral; "замечание" stays for review findings |
| Change request | Запрос на изменение | Задача, Тикет, Фича | Plain Russian |
| Request kinds | Экран / Процесс / Данные | Форма / Бизнес-процесс / Структура | Match the tabs |
| Review | Рассмотрение | Ревью, Проверка | "Проверка" is reserved for Verify |
| Accept | Принять | Утвердить, Одобрить, Согласовать | "Согласовать" collides with ELMA approval processes |
| Request changes | Запросить доработку | Нужны изменения, Отклонить | Tells the author what to do |
| Comment only | Только комментарий | Комментарий | Explicit that it is not a decision |
| Change kinds | Изменён / Добавлен / Удалён / Без изменений / Конфликт | Модифицирован, Новый, Удаление заявлено явно | Short, parallel, one word |
| Conflict | Конфликт · выберите версию | Нужен выбор версии | Noun chip plus imperative |
| Base | Основа: версия от 8 окт. | База, Происхождение | "База" reads as database; on the fixed path it is always known |
| Viewed | Просмотрено | Проверено | "Проверено" would claim verification |
| Build / Verify / Release | Сборка / Проверка / Выпуск | Компиляция, Верификация, Релиз, Деплой | Russian; PR #123 uses Сборка |
| Before/after | Было / Стало | Diff, Сравнение | Understood in the walkthrough |
| Explanation | Объяснить | Описание, AI | Keep; it tested well |
| Technical details | Подробнее | Доказательства, JSON | One per page |
| System objects | Служебные объекты | Системные, Прочее | "Системные" collides with ELMA system workspaces |
| Legacy upload | Прежние загрузки | Файлы, Импорт файла | Already used |

Buttons allowed per page (anything else is a link inside a disclosure):

| Page | Primary | Secondary |
| --- | --- | --- |
| Решения | Загрузить решение | per-card recommended action |
| О решении | recommended action | Написать (empty purpose), Обновить (link) |
| Как работает | Запросить изменение (on selection) | Объяснить этот процесс / шаг |
| Экраны и данные | Запросить изменение (on selection) | — |
| Изменения (list) | recommended action of the first row | — |
| Изменения (review) | Решение по версии | Скачать отчёт, Обновить ещё раз (links) |
| Запросы | Новый запрос | per-row status change |
| Сборка (PR #123) | Собрать конфигурацию (disabled with reason) | — |

## 8. Work packages

Each package is one PR with Storybook states, focused tests and before/after
screenshots. Order follows the user's path.

| ID | Outcome | Files (owners from capabilities.yaml) | Acceptance |
| --- | --- | --- | --- |
| UX-00 | Vocabulary module and lint: one exported label map (`web/managed/labels.js`) holding every string of section 7 plus the existing classification wording; `tools/ui-strings.mjs` scans the managed, visual, feedback and explanation renderers and fails on any Cyrillic literal that is neither in the map nor in the committed legacy baseline (`test/fixtures/ui-strings-baseline.json`). The baseline may only shrink: each later package moves the strings it touches into the map and regenerates it with `--update`. `isTechnicalKey`/`displayLabel` give renderers the rule "business name first, key muted". Object-kind labels are provisional until R1. | `web/managed/labels.js`, `web/managed/model.js`, `tools/ui-strings.mjs`, `test/ui-labels.test.mjs`, `test/fixtures/ui-strings-baseline.json`, `package.json` (`check:ui-strings`) | Every label in section 7 exists once; `npm run check:ui-strings` passes; no new inline Russian string can be added to a renderer |
| UX-01 | Fixed entry: "Загрузить решение" dialog over the existing acquisition routes; server and solution lists; full pull only; same-Source and base filled by the server (`baseDeclaration.method: source-sequence`); "Обновить" in the header; manual upload moved under "Прежние загрузки". | `web/managed/acquisition.js`, `web/managed/render.js`, `web/managed/model.js`, `lib/managed-workspace.mjs` and `server.mjs` (fill scope/base/source from the connection reference; additive), `storybook/stories/ConfigAcquisition.stories.js` | Add-solution and update flows have no scope, base, Source or responsibility questions; a pulled version never shows `Основа: не указана`; legacy upload unchanged and tested |
| UX-02 | Business names first: `componentName` returns `{name, key, kind, module}` from captured entity metadata; kind labels per R1; keys muted; grouping by module and kind available to all tabs. | `web/managed/model.js`, `lib/managed-workspace.mjs` (additive exposure of `entity.name`, kind, module), `web/visual/render.js` | No GUID or `__default` as a primary label in any story; keys searchable |
| UX-03 | Delivered in two parts. UX-03a (PR after #131): summary line, chips, one "Подробнее", status ribbon, changed-first grouping, collapsed unchanged, grouped dependencies. UX-03b (next): the decision dialog ("Решение по версии" with Принять / Запросить доработку / Только комментарий), a server operation to close a no-change version ("Закрыть без изменений") and "Открыть схему" with highlighted steps, which touches the visual renderer. Original scope: Review page: summary line, chips, decision dialog, status ribbon, changed-first grouping, collapsed unchanged and system objects, grouped dependencies, "Открыть схему" with highlighted steps. | `web/managed/render.js`, `web/managed/model.js`, `web/managed/dependencies.js`, `web/visual/render.js`, `storybook/stories/ManagedWorkspace.stories.js`, `tools/managed-workspace-browser-check.mjs` | `review-no-changes` story shows one sentence and two actions; counts equal row classifications; 398-object fixture renders under 300 DOM rows initially |
| UX-04 | Header stepper and badge from `solutionNextAction` plus PR #123 composer state; tabs renamed and reordered; "Сборка" stays contextual. Stacked on #123. | `web/managed/render.js`, `web/managed/model.js`, `web/managed/page.js`, stories | One stepper state per row of the product plan's next-action map; unavailable steps disabled with reason |
| UX-05 | "О решении": generated purpose and module cards from the explanation engine, editable with history; activity list from existing attributed records; actor initials component. | `lib/solution-explanations.mjs` (new scope `solution-purpose`, `module`), `web/explanations/`, `web/managed/render.js`, `lib/actors.mjs` (display-name projection) | Empty, generated, edited and stale states in Storybook; two-actor fixture shows distinct names |
| UX-06 | "Как работает" and "Экраны и данные" tabs: process list with generated one-liners, step detail in plain words, forms and field tables, search, system objects collapsed. | `web/visual/render.js`, `web/visual/model.js`, `web/managed/render.js`, `lib/solution-visual.mjs` (field tables, additive) | Keyboard order, 390 px reflow, search by name and key |
| UX-07 | Change requests: entry points, form, private record, list tab, object chips, publication through the bug-report transport with consent. | `lib/bug-reports.mjs` (request kind), new `lib/change-requests.mjs`, `lib/managed-workspace-store.mjs` (record type), `server.mjs` routes, `web/feedback/`, `web/managed/render.js`, `storybook/stories/BugReports.stories.js` | Request from a step carries the step anchor; status changes attributed; unconfigured GitHub saves with `unconfigured` as bug reports do |
| UX-08 | "Просмотрено" per object with progress and stale badge bound to the review revision. | `web/managed/render.js`, `web/managed/model.js`, `lib/managed-workspace-store.mjs` (per-actor viewed marks) | Mark cleared when the object's digest changes; progress in header |
| UX-09 | Validation: R3 five-second tests, label card sort on section 7, Storybook review-panel records; then the owner decides on #59 resumption. | `storybook/`, `docs/EXPERIENCE_REVIEW.md` addendum | Any label with under 2 of 3 correct readings is replaced before UX-09 closes |

Dependencies: UX-00 -> UX-01 -> UX-02 -> UX-03 -> UX-04 (after PR #123 merges)
-> UX-05, UX-06, UX-07 in any order -> UX-08 -> UX-09. Rough size: UX-00 to
UX-03 about one week of one agent; UX-04 to UX-07 about two weeks; UX-08 two
days; UX-09 depends on people.

Prerequisite outside this plan: the live export service behind the acquisition
API (netbka/elma365) must answer for the named servers. Until it does, UX-01
is proven against the synthetic acquisition fixtures and the dialog shows
`Сервер недоступен · Повторить`; this is a B4 external-evidence stop, not a
reason to keep the manual upload primary.

## 9. What is not taken for granted

| Hypothesis | Validation | If wrong |
| --- | --- | --- |
| One fixed entry (server + solution) covers every real start | UX-01 against the two named servers; legacy counter on "Прежние загрузки" usage | Add a third server to the list; never add a question to the dialog |
| "Модуль" is what users call an ELMA application in this company | R1 and UX-09 card sort | Rename in UX-00 map only |
| A generated purpose paragraph is good enough to start from | R3: can three colleagues say what the solution is for? | Empty state with "Написать" becomes the default and generation is a secondary button |
| Collapsing unchanged objects hides nothing reviewers need | R3 and UX-09; the collapsed row always shows the count | Expand unchanged objects of changed modules |
| Business names are unique inside a module | R2 measurement; duplicates render with the key visible | Show the key for duplicates only |
| Three-verb decision dialog beats checkbox plus three buttons | R3 on the Storybook story | Keep the dialog, add the explicit confirmation line |
| Three request kinds (Экран / Процесс / Данные) are enough | UX-07 pilot on one Solution | Add `Права` as a fourth |
| Users write requests where they see the problem, not from a list | Entry-point usage in UX-07 pilot | Promote "Новый запрос" |
| A stepper with disabled steps does not read as broken | R3 question "what can you do next?" | Hide steps beyond the first unavailable one |
| Initials are enough identity | Task 10 of the usability protocol | Full name on every row |

## 10. Owner items and classification

| Item | Class | Note |
| --- | --- | --- |
| Servers offered in "Загрузить решение" (DEV main, dev2) | resolved 2026-10-15 | Owner confirmed. Read-only export only; no Target action |
| Recording the fixed-path direction in product authority | resolved 2026-10-15 | Register row added in PR #126 (section 11) |
| Human five-second and label tests (R3, UX-09) | resolved 2026-10-15 | Owner delegated; classified as design validation under the limits in section 2. Not #59/#41 evidence |
| Merge of each UX PR | `merge-to-main` | Owner merges |

## 11. Contradiction-register row

Added to [SOLUTION_FIRST_CONTRADICTIONS.md](../SOLUTION_FIRST_CONTRADICTIONS.md)
in PR #126 on the owner's 2026-10-15 confirmation:

| Contradiction | Decision | Source |
| --- | --- | --- |
| The journey in `workflows/solutions.md` asks the user to declare full/partial scope, same Source, responsibility and an optional base; the owner's 2026-10-15 direction removes these choices from the primary path | Primary path is pull-from-named-server only: full snapshot, same Source and base derived by the server. The engine keeps partial/declared-base support for legacy uploads under "Прежние загрузки". No partial path in the primary UI | Owner direction 2026-10-15; this plan |

## 12. Rules for every PR in this plan

- Before/after screenshots at 1920 and 390 px in the PR description, from the
  production renderer in Storybook, synthetic fixtures only.
- Every visible state in `storybook/review-manifest.json`; `check:storybook`,
  `test:managed:browser` and affected `solution-visual` / `bug-reports` checks
  run and recorded against the head.
- No new Russian string outside the label map (UX-00 test).
- No engine, storage identity, evidence binding, delivery or Target change
  beyond the additive items listed in section 8.
- Truth labels stay: reconstructed, simulated and native-observed remain
  distinguishable; shortening a sentence into a chip never drops the
  distinction.
- `docs/workflows/solutions.md`, `docs/contracts/*` for touched capabilities
  and `STATE.md` updated in the same PR when the visible flow changes.

## 13. Sources

Competitor and guideline material read on 2026-10-15:

- Gearset, "Understanding your Salesforce org comparison" — https://gearset.com/blog/understanding-your-org-comparison/
- Gearset app fundamentals — https://docs.gearset.com/en/articles/3720210-gearset-app-fundamentals
- Salesforce DevOps Center, work items and change tracking — https://developer.salesforce.com/docs/atlas.en-us.devops_center_dev.meta/devops_center_dev/devops_center_dev_workitem.htm
- Microsoft Power Platform, "Run pipelines" — https://learn.microsoft.com/en-us/power-platform/alm/run-pipeline and pipelines overview — https://learn.microsoft.com/en-us/power-platform/alm/pipelines
- GitHub, "Mark files as viewed" — https://github.blog/news-insights/product-news/mark-files-as-viewed
- GitLab, changes in merge requests — https://archives.docs.gitlab.com/17.2/ee/user/project/merge_requests/changes.html and design review rules — https://docs.gitlab.com/development/contributing/design
- Figma, "Review branch changes" — https://help.figma.com/hc/en-us/articles/5693123873687
- HashiCorp, Terraform Cloud run UI — https://developer.hashicorp.com/terraform/cloud-docs/run/ui and "New Apply User Interface" — https://www.hashicorp.com/blog/new-apply-user-interface-for-terraform-cloud
- ServiceNow, compare local update sets — https://docs.servicenow.com/bundle/washingtondc-application-development/page/build/system-update-sets/task/t_CompareLocalUpdateSets.html
- ELMA365 help: export and update configuration — https://elma365.com/en/help/configuration.html; import a solution — https://elma365.com/en/help/import_solution.html; CI/CD utility — https://elma365.com/en/help/lowcode-devops-pm.html
- Nielsen Norman Group, "Progressive disclosure" — https://www.nngroup.com/articles/progressive-disclosure/
- UX Movement, "5 rules for choosing the right words on button labels" — https://uxmovement.com/buttons/5-rules-for-choosing-the-right-words-on-button-labels/

Internal evidence: walkthrough of 2026-10-15 (section 1); `web/managed/model.js`
label map; `docs/contracts/config-source-api.md`; `docs/contracts/bug-reports.md`;
`docs/contracts/solution-explanations.md`; `docs/workflows/uncoached-usability.md`;
`docs/EXPERIENCE_REVIEW.md`; PR #123 description.

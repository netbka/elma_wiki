# Independent visual audit checklist (#41)

Owning issues: #41 (independent visual review), #59 (uncoached usability),
#38 (owner acceptance). This checklist is the reviewer's instrument for the
information architecture of the
[intuitive Solution UI plan](../plans/intuitive-solution-ui-2026-10-15.md),
section 6. The earlier checklist of the `usability-20261008-lane-a-88` packet
existed only in the local review packet and covered the former overview, change
and finding pages; it is history and is not carried forward as passed.

The reviewer must meet the independence requirement of #41: not the author of
the renderers under review, and not coached by them. Results go into the
`independentVisualReview` record of the session's `observations.local.json`
(`performed`, `independent`, `outcome`, `sourceRevision`, `materialFindings`),
never into this file. Automated checks (`test:managed:browser`,
`check:storybook`) and developer screenshots are preparation, not #41 evidence.

## How to run the pass

1. Use the clean, separate checkout of the tagged revision named in #41, with
   passing Windows/Linux CI. Record its revision as `sourceRevision`.
2. Build the editor and Storybook, start the synthetic session
   (`node tools/usability-session.mjs`) and open the Storybook build. The final
   pass of every section must use the integrated working product; the stories
   are for states the synthetic session cannot reach (errors, stale anchors,
   conflicts, GitHub states).
3. Review each section below at 1920 px, 800 px and 390 px width and at 200 %
   zoom, with a keyboard only and with a mouse. Record every material finding
   with the section number, the state (story id or session step), the width or
   zoom, the actual behavior, the expected behavior and the revision.
4. A material finding is fixed in the shared renderer, its story is updated and
   a new revision gets a new pass. Do not edit the frozen checkout.

## Rules applied to every screen

- One obvious primary action; secondary actions only when they apply.
- The answer before the detail: the first line of a page or section states what
  it is or what changed, counts match the rows, nothing contradicts a chip.
- Business names first, keys muted; no GUID, `__default`, Git, Storybook or
  parser words in product text. Unknown stays unknown where the data is
  unknown (`не проверено`, `не указана`).
- Attribution: every person-made record shows initials and relative time;
  the viewer's own identity is distinguishable from another actor's.
- Keyboard: tab order follows reading order, focus is visible, dialogs trap
  focus and close with Escape, every control reachable without a mouse.
- Reflow: no horizontal page scroll at 390 px or 200 %, tables wrap or scroll
  inside their own box, chips stay readable, nothing overlaps.
- States: empty, loading, error with retry, stale with the way to the current
  page, archived read-only, each saying what happened in plain words.

## 6.1 Entry: Solutions home

States: `managed-workspace--empty`, `--list`, `--create`, `--pull-exporting`,
`--pull-ready`, `--pull-failed`, `--pull-unavailable`, `--create-legacy`.

- [ ] **Загрузить решение** is the one primary button; the dialog asks only
      for the server and the solution and has one **Загрузить**.
- [ ] Progress reads `Выгружаем с сервера…` / `Разбираем…` / `Готово` /
      `Не удалось · Повторить`; a failed pull offers retry without losing the
      choice.
- [ ] Without a configured server the dialog says `Сервер недоступен` and
      **Загрузить** is disabled; the manual file path under **Прежние
      загрузки** still works unchanged.
- [ ] Each card shows name, server, status badge, last actor with initials and
      relative time, and exactly one recommended action.
- [ ] Left rail: Решения · Архив · Прежние загрузки; the archive lists
      archived Solutions read-only.

## 6.2 Solution header and lifecycle stepper

States: `managed-workspace--overview`, `--pending`, `--stale`, `--archived`,
`--lifecycle-build`, `--lifecycle-verified`, `--no-source`.

- [ ] Header: name · server, status badge, "Версия от …", one primary button
      naming the next action, **Обновить** as a link.
- [ ] Stepper Загрузка · Сравнение · Рассмотрение · Сборка · Проверка ·
      Выпуск shows exactly one current step; unavailable steps are grey with a
      two-word reason (`нет сборщика`, `ещё не доступно`) and do not read as
      broken.
- [ ] Tabs О решении · Как работает · Экраны и данные · Изменения · Запросы;
      Сборка and Передача appear only when they apply.
- [ ] No stepper on an error or stale page; the stale page leads to the
      current one.

## 6.3 О решении

States: `managed-workspace--about-empty`, `--about-generated`,
`--about-saved`, `--about-stale`, `--about-error`,
`solution-explanation--solution-reading-guide`.

- [ ] **Для чего** opens the tab: a generated paragraph with its author line,
      or the empty state "Опишите, для чего это решение" with **Написать**.
- [ ] Editing in place keeps author and history; a stale text says what
      changed and offers regeneration without deleting the saved text.
- [ ] **Модули**: one card per module with counts and **Открыть**; a module
      without a business name shows its code muted, never a GUID.
- [ ] **Что требует внимания** and **Последние события** (actor initials,
      relative time) read as answers, not logs.
- [ ] Disclosures Версии и история / В архив are secondary and closed.

## 6.4 Как работает

States: `managed-workspace--flows`, `--flows-error`, `--flows-unknown`,
`solution-visual--source`, `--happy`, `--return`, `--missing-comment`,
`--duplicate`, `--unknown`, `--empty`, `--loading`, `--error`,
`solution-explanation--process-reading-guide`.

- [ ] Processes grouped by module with business name, code muted,
      responsibility and a one-line reading; search by name or code narrows
      the list.
- [ ] The selected process shows the diagram and, for the selected step: who
      does it, the form and fields, where it goes next, the saved explanation.
- [ ] Only two chips: `Схема: из экспорта` and `Поведение в ELMA: не
      проверено`; unsupported items are one collapsed group with a count.
- [ ] **Запросить изменение** on the process card and on the selected step.
- [ ] Diagram keyboard operation: step selection, panel focus, no trapped
      focus; at 390 px the panel stacks under the diagram.

## 6.5 Экраны и данные

States: `managed-workspace--screens`, `--solution`.

- [ ] Screens and data objects per module, business names first, field tables
      with name, type and required; search by name or key.
- [ ] System objects collapsed under `Служебные объекты · n`.
- [ ] **Запросить изменение** on every card and every field row; the field
      button names the field.
- [ ] Open field tables do not widen the page at 390 px.

## 6.6 Изменения

States: `managed-workspace--changes`, `--change`, `--review`,
`--summary-mixed`, `--summary-no-changes`, `--summary-closed`, `--decision`,
`--review-comment`, `--review-findings`, `--review-resolved`,
`--review-accepted`, `--review-stale-anchor`, `--review-removed-anchor`,
`--review-ambiguous-anchor`, `--viewed-marked`, `--viewed-changed`,
`--viewed-second-actor`, `--conflict`, `--overlap`, `--ambiguous`,
`--pending-conflict`, `--needs-fixes`, `--elements-added`,
`--elements-boundary`, `--elements-conflict`, `--elements-unknown`,
`--change-base`, `--change-draft`, `--change-rejected`, `--base-declared`,
`--base-unknown`, `--merge-required`, `--merge-resolved`, `--merge-stale`,
`--merge-blocked`, `--merge-parts`, `--merge-parts-blocked`.

- [ ] The list: Версия · Загрузил · Дата · Состояние · Замечания · Действие,
      needs-decision first.
- [ ] Review opens with the summary line; a version with no difference says
      so and offers **Закрыть без изменений** / **Обновить ещё раз**.
- [ ] Facts as chips (base, server, who loaded); **Подробнее** holds the
      evidence; a pulled version shows its base as Wiki-derived, never as
      verified ancestry and never as `Основа: не указана`.
- [ ] One **Решение по версии**; the dialog offers Принять · Запросить
      доработку · Только комментарий; while a gate is closed acceptance is
      disabled with its reason and requesting fixes stays possible.
- [ ] Ribbon counts equal the row classifications; unchanged objects
      collapsed with a count; changed objects first, grouped by module.
- [ ] **Просмотрено** per changed card; "Просмотрено · k из n" in the summary;
      a corrected object reads "Изменилось после просмотра"; another actor's
      marks are not shown; marks never disable or enable the decision.
- [ ] **Открыть схему** highlights the changed steps.
- [ ] Conflicts: each conflict names the two versions and one choice; the
      merge page keeps a part-level resolution readable at 390 px.
- [ ] Stale, removed and ambiguous anchors say what happened to the object,
      not an internal code.
- [ ] Comments and findings carry initials and relative time; the viewer's
      own records are distinguishable.

## 6.7 Запросы

States: `managed-workspace--requests`, `--requests-empty`,
`--requests-object`, `--requests-error`, `--request-form`,
`--request-form-field`, `--request-record`, `--request-published`,
`bug-reports--ready`, `--attachments`, `--limit`, `--capture-error`,
`--published`, `--unknown`, `--failed`, `--unconfigured`, `--reject`,
`--rejected`, `--blocked`, `--attachment-failed`.

- [ ] Entry points open the same dialog with Что изменить preselected and
      Где filled from the place (module · name, step or field).
- [ ] The form: Что изменить · Где · Кратко · Что должно быть · Зачем
      (optional) · Срочность · one **Отправить**; Отмена discards.
- [ ] After sending: "Запрос сохранён в Wiki", **Открыть запрос** and the
      publication block with consent naming the repository; without GitHub
      the state reads "Сохранён в Wiki. Отправка в GitHub не настроена".
- [ ] The tab lists newest first with status chip, author, where (with the
      anchor warning when the object changed, was removed, is ambiguous or is
      in a version still under review), created, fulfilling version.
- [ ] The record: history, comment form, status form; Выполнен asks for the
      accepted version; archived Solutions are read-only.
- [ ] `Запрос · n` chips on process, screen, data cards and field rows lead to
      the filtered tab; "показать все" clears the filter.
- [ ] Dialog at 390 px: no horizontal scroll, fields stacked, focus trapped,
      Escape closes without sending.

## Record

For each section record `pass`, `fail` or `blocked`, the states actually
opened, the widths and zoom covered, and each material finding. The pass is
complete when every section was reviewed on the integrated product and the
stories listed above, at every width and zoom, with keyboard and mouse. A
finding does not fail the pass by itself; an unfixed material finding does.

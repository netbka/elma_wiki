# UX-09 agent pass, 2026-10-17

Owner request 2026-10-17: run the UX-09 materials without colleagues, acting as
the participants, and record what helps and what blocks understanding.

What this is: a developer design pass over the six `design-validation`
five-second stories, the label deck and the card sort, done by an agent on
Storybook synthetic fixtures at 1920 and 390 px. What it is not: the UX-09
readings of the plan (section 10.1, item 1 still waits for three people), and
not #41/#59 evidence. Nothing was written into the Storybook review panel or a
#59 record. The 2-of-3 rule does not apply to one reader; each item below is
marked as read correctly, read partly or missed on a cold first look.

Stories: `managed-workspace--about-saved`, `--about-generated`,
`--summary-mixed`, `--summary-no-changes`, `--decision`, `--lifecycle-build`.

## 1. Five-second tests

| Screen | Question | Cold reading | Verdict |
| --- | --- | --- | --- |
| about-saved | For what and for whom | Title "Командировки и расходы", then the purpose paragraph. "Who uses it" is the last clause of the paragraph and is the first thing lost. | partly |
| about-generated | For what | The generated text opens with "Решение объединяет модули «synthetic»", which says nothing about purpose. "Командировки" comes only from the page title and screen names. | missed |
| summary-mixed | What changed, what next | The counter line "Изменено 1 · Добавлено 1 · Удалено 1 · Конфликтов 1 · Без изменений 3" reads at once. What to do next does not: the conflict chooser and the "Решение по версии" button are both below the fold at 1920×1080, and the only visible button is "Скачать отчёт об ответственности". | partly |
| summary-no-changes | Did anything change | "Эта версия не отличается от текущей" in the yellow strip with "Закрыть без изменений" and "Обновить ещё раз" beside it. Immediate. | correct |
| decision | Which decisions | Nothing. The dialog is rendered open but without a backdrop, at its place in the page flow below the fold, overlapping the comments form. Above the fold there is a checkbox "Изменение принятого объекта проверено" and a strip "Подтвердите каждое изменение объекта исходной базы", which read as the decision. | missed |
| lifecycle-build | What next | "Сборка сейчас" in the stepper and the green "Собрать конфигурацию" button directly under it; "Выпуск ещё не доступно" is read as not yet, not as broken. | correct |

## 2. What helps

- The counter line on the review page answers "what changed" in one glance.
- The no-change version is one sentence with its two actions next to it.
- The stepper's "готово · сейчас · далее" words read as progress, and the
  current step and the primary button say the same verb.
- The decision dialog explains each option in one line, and the disabled
  "Принять" carries its reason.
- Tabs are five nouns and the names match the content behind them.
- "Было / Стало", "Изменён / Добавлен / Удалён / Без изменений / Конфликт"
  need no explanation.

## 3. What blocks understanding

Ordered by how often it would cost a participant the answer.

1. **"Решение" means two things on one page.** The product noun is the
   Solution, but the conflict row's select reads "Выберите решение" and the
   primary button is "Решение по версии". On the mixed screen a reader asked
   "what next" sees "выберите решение" and thinks "pick a Solution". The deck's
   expected reading for the conflict card is "выберите версию", which is the
   vocabulary's `actions.chooseVersion`, but the rendered select says
   "Выберите решение". Replace the select placeholder with "Выберите версию"
   and consider "Что делать с версией" or "Принять или вернуть" for the button.
2. **Header says accepted while the page asks for a review.** Every review
   story shows the badge "Принято", "Рассмотрение готово" in the stepper and
   the heading "Рассмотреть обновление версии" at the same time. The header
   describes the current accepted version, the body the pending one, but
   nothing says so. Readers of the mixed and decision screens cannot tell
   whether anything is still open. The pending version needs its own badge
   ("Ожидает рассмотрения") or the header needs the line "Рассматривается:
   версия от 15 окт.".
3. **The next action is the last thing on the review page.** The conflict
   chooser, the yellow "Выберите версию для каждого конфликта" and "Решение по
   версии" come after the object cards and the dependency list. On a phone the
   button is after four screens of scrolling. Pin the decision strip under the
   counter line, or repeat it there.
4. **The decision dialog is not modal.** `decisionOpen` renders the dialog
   inline without a backdrop and without focus, so it is just another box at
   the bottom. With `showModal()` the five-second test of this screen is
   trivially correct; without it the screen fails.
5. **Generated purpose text starts with structure, not purpose.** "Решение
   объединяет модули «synthetic»" is not an answer to "для чего". The
   `ifWrong` fallback in the plan (empty state with "Написать" primary,
   generation secondary) applies. If generation stays, the first sentence
   should name the business process from screen names ("Заявка на
   командировку и её утверждение"), and the module list goes second.
6. **"Просмотрено" and "проверено" sit on the same card with different
   meanings.** The header counts "Просмотрено · 0 из 1" (personal reading
   mark), the card has a checkbox "Изменение принятого объекта проверено"
   (gate for acceptance), and the dialog's reason says "Подтвердите каждое
   изменение". Three words for two concepts. Use "Просмотрено" for the mark
   and one phrase, "Подтверждаю изменение", for both the checkbox and the
   reason.
7. **Technical names and codes in the first line of every card.** Module
   headings are "Модуль travel_expenses" and "Модуль synthetic"; each object
   card shows `travel_expenses.trips · trip_approval · template`, "Изменение из
   полного снимка", "Удаление заявлено явно", "Идентичность и доказательства
   сравнения". The sentence lines should be the deck's words ("Изменён",
   "Добавлен", "Удалён", "Конфликт · выберите версию") and the codes belong
   under "Подробнее". The fixtures should also give modules business names,
   otherwise the label test for "Модуль" runs against a code.
8. **Alarming chips without a next step.** "Зависимостей с вопросами: 14" in
   yellow appears even on the no-change version and on the About page the
   stepper says "Сборка нет сборщика" in bold. A reader asked "what next"
   stops here. Either link the chip to its list or move it under "Подробнее";
   the stepper reason should not be bold.
9. **"Открыть решение" as the primary button on the Solution's own page.**
   On about-saved the only green button is "Открыть решение", while the
   reader is already inside the Solution. It opens the legacy viewer. Rename
   to what it opens ("Открыть просмотр объектов") or demote it.
10. **"Объяснение" box with an "Объяснить" button inside a module card.**
    Nothing says who explains or what the result is. One line of hint
    ("Короткое объяснение модуля простыми словами") or a verb that names the
    result.
11. **Small grammar and noun-button items.** "1 экранов", "3 экранов"; the
    comment submit button is "Комментарий" (noun, against the verb-first
    rule); "Сохранил U Uploader · 3 ч назад" shows an initial and a login.
12. **Phone width.** The stepper stacks into six lines and, with the tabs,
    takes the whole first screen; the chip row wraps into five lines. The
    counter line is the first content after one and a half screens.

## 4. Label deck, cold reading

Read correctly on first sight: Сервер, Версия от 15 окт., Прежние загрузки,
О решении, Как работает, Экраны и данные, Изменения, Рассмотрение, Принять,
Запросить доработку, Только комментарий, Изменён, Добавлен, Удалён, Без
изменений, Конфликт, Конфликт · выберите версию, Было / Стало, Подробнее,
Служебные объекты, Запрос на изменение, Экран / Процесс / Данные, Выпуск.

Read partly or missed:

| Label | Read as | Expected | Note |
| --- | --- | --- | --- |
| Решение | a decision | the Solution | see blocker 1; the word is fine as a tab heading but not next to decision controls |
| Загрузить решение | upload a file from my computer | pull the whole Solution from a server | "Выгрузить с сервера" or "Получить с сервера" says the direction |
| Обновить | reload the page | pull a new version from the same server | "Получить новую версию" |
| Модуль | plausible, but ELMA calls it "Раздел" | a part of the Solution | keep until a real card sort; the fixture module names must be business names first |
| Запросы | queries, or requests to whom | people's change requests | "Запросы на изменение" as the tab name removes the doubt |
| Основа: версия от 8 окт. | unclear what "основа" is | the version this one is compared against | "Сравнение с версией от 8 окт." |
| Просмотрено | "checked", because of the neighbouring checkbox | personal "I looked at it" | see blocker 6 |
| Сборка | assembly of what, by whom | build an installable configuration | acceptable with the button under it; alone it is vague |
| Проверка | check of what | verify the build on a server | "Проверка на сервере" |
| Объяснить | unclear who explains | plain-language explanation | see blocker 10 |

## 5. Card sort

Ten of eleven cards went where the plan expects. The exception: "Кто и когда
последним загрузил решение" went to "Изменения", because versions and their
uploaders feel like history. The plan puts it under "О решении" (recent
events). Not a rename, but "О решении" should show the last upload with a date
in its first screen so the association forms.

Module question: a reader who knows ELMA answers "раздел"; a business reader
answers "модуль" or "блок". Keep "Модуль" until three real answers.

## 6. Proposed order of fixes

Fix before running the human sessions, because they would otherwise fail on
mechanics rather than on wording: blocker 4 (modal dialog), blocker 1 (select
placeholder "Выберите версию"), blocker 3 (decision strip under the counter
line), blocker 7 (business module names in fixtures). Everything else is a
wording decision that the human sessions should test as is.

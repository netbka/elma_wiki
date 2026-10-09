# ELMA Wiki: аудит с исправленной целью рабочего выпуска

Дата: 8 октября 2026. Аудит и план, обновленные после прямого уточнения владельца. Код и live-среды этим документом не меняются.

## Исправление моего предыдущего вывода

Предыдущая версия аудита ошибочно ограничивала полный продукт инженерным просмотром и приемкой, считая рабочую native-передачу лишь поздним дополнением. Владелец уточнил: **сравнение полных/частичных версий, слияние изменений коллег, разрешение конфликтов и выпуск рабочей конфигурации являются основной целью продукта**. Требуемый выход охватывает часть приложения, приложение, Solution и всю конфигурацию сервера; зависимости, включая платные, должны быть разрешены.

Точный первоначальный аудит, все десять подробных findings, сравнение Dyk и одиннадцать EW-планов сохранены в [неизменяемой версии c7cce48](https://github.com/netbka/elma_wiki/blob/c7cce488fd8bb699d64bf5212148019a8e25d750/docs/audits/github-enterprise-audit-2026-10-08.md). Его review-only трактовка конечного результата больше не действует. Это ссылка на историю исследования, не конкурирующая продуктовая инструкция.

Текущая authority: [Solution-first product plan](../SOLUTION_FIRST_PRODUCT_PLAN.md). Техническое продолжение: [merge/build/release](../plans/working-configuration-release.md), Wiki #94 и [elma365#60](https://github.com/netbka/elma365/issues/60), существующий delivery #11. Координация #52/#91.

## Что проверено

GitHub-only: Wiki main `9f8f17c9729acf5193f79f38a51f7aa104e97717`; Dyk `1562aa38b6cbc8149af67d1bb60702ada470f8ca`; дополнительно native ELMA tooling `c0a494b25b08b9f9c76f496d7355329498f6df43`.

Прочитаны действующие контракты, выбранный source/test code, PR metadata и сохраненные CI/native evidence. У старого #88 отдельно наблюден успешный CI 37803975028 для fba2ddc: Linux/Windows pass, browser stages на Linux. Это не прогон текущего документа, не live ELMA и не human acceptance.

В уточняющем проходе прочитаны native AGENTS, config-workspace GUIDE и enterprise acceptance. Они уже требуют рабочий родительский процесс, совпадение опубликованного runtime с кандидатом, реальные кнопки/документные результаты и проверку после установки. Эти требования ближе к цели владельца, чем прежняя трактовка аудита.

Локальные команды, приложение, браузер, ELMA, конфигурации, лицензии, provider и deployment не запускались. Не проверялись текущая эксплуатация, branch protection, нагрузка и backups. Новые MR tests пока не выполнены. Никаких real exports, private hosts, credentials или Dyk document dumps в PR нет.

## Какой продукт строим

**Полная база + изменения участников -> сравнение -> конфликты и решения -> принятый объединенный результат -> физическая сборка -> native-проверка -> рабочий выпуск -> контролируемая установка на следующий сервер.**

Solutions остается главным контекстом, а код, preview, обсуждения, build и delivery - его возможностями. Wiki не исполняет документооборот вместо ELMA, но отвечает за получение конфигурации, на которой он работает. Разделение runtime и engineering не освобождает продукт от результата.

## Подтвержденная основа и реальные разрывы

| Область | Основа | Что требуется завершить |
| --- | --- | --- |
| Версии | Immutable full/partial, checksums, текущая трехсторонняя сверка | Явные базы независимых изменений, finer merge и durable resolutions |
| Принятое состояние | Revision/digest-bound review, история и ответственность | Материализация смешанного принятого состояния в физические native artifacts |
| Код/формы | Контекстные working copies и поддержанный widget compiler в native tools | Включение reviewed working copy в build, соответствующие adapters для процессов/других типов |
| Пакет | Exact original full-export handoff | Composed candidate, полный scope/closure, приложение/часть/server config |
| Delivery | Existing prepare/confirm/verify, bridge и reservations | Shared handoff integration #11 и фактическая совместная проверка результата |
| Платные модули | Сохранение opaque bytes/refs и зафиксированные ограничения CLI | Licensed prerequisites или официальный intact import, compatibility/entitlement и native acceptance |
| Review/UX | Shared renderer, комментарии, preview, deterministic explanations | B2 поведения, новые merge/build состояния и независимая приемка |
| Эксплуатация | Ограниченный single-service storage и предусмотренный updater | Измеренный профиль, recovery/restore и допустимая topology |

Полное описание текущих технических свидетельств остается в исходном аудите и owning contracts; ограничения кода не превращаются в постоянные non-goals.

## Dyk: сохраняем выводы, адаптируем предметную область

| Механизм | Применение в Wiki |
| --- | --- |
| Конституция/принципы с Detect | Принятый исход - рабочая конфигурация; проверки ищут нарушения этого результата, а не соответствие ошибочно узкому макету |
| Фаза и выбранные границы | Сохранить прогрессивный контекст и root-cause routing |
| Один renderer и один поведенческий владелец | Не копировать Storybook или merge/compiler/delivery engines |
| T2 - полное committed состояние | Обновлять merge conflicts, history, candidate eligibility и next action вместе |
| Focused tests, реальные внутренние границы | Тестировать reducer/storage и fake/native adapter contract; fake не является native proof |
| Blind intent -> contract -> B2 -> visual | B2 нужен для compare/resolve/build/install/retry/return; screenshot его не заменяет |
| Независимость и evidence по уровню | Разработчик не принимает собственный результат там, где требуется независимость; review не заменяет runtime acceptance |
| Одна тема - один нормативный источник | Устранить конкурирующие действующие документы |
| Phone-first/privacy/локальные deployment правила Dyk | Не переносить в enterprise Wiki; shared identity и desktop context сохраняются |
| Retention | Не удалять originals/историю по чужому сроку |

Dyk B2 index на прочитанном срезе был report-only/unreviewed; аудит не объявляет там полностью введенную автоматическую независимую приемку. Платформенные правила и стоящие разрешения Dyk не дают полномочий на ELMA PROD.

## Реестр выводов после уточнения

| ID | Вывод и обновленное действие |
| --- | --- |
| G01 | Действующие документы противоречат друг другу. В этом продолжении исправляются главный endpoint и связанный порядок работ; оставшиеся stale private/Storybook/runtime-checkpoint формулировки требуют согласования owning docs, не изменений реальных прав |
| G02 | Добавить отдельный B2 и проверки всех dependent consumers; не начинать весь visual audit при каждой behavior-правке |
| G03 | #59/#41 human task остается DEFERRED; доступность людей не PASS; #38 сохраняет owner gate |
| G04 | Shared handoff не подключен к существующему delivery. Сохранить правильную cross-root защиту и подключить composer к одному coordinator, #11/MR-06 |
| G05 | Native identity/history/stale-write evidence ограничены. Это concrete engineering gaps #47, а не причина отказаться от merge; immutable Wiki base не требует выдуманного native автора |
| G06 | Exact candidate/read-back и native business acceptance обязательны для полного продукта, не необязательное приложение к viewer; MR-03..08 |
| G07 | #88 дает deterministic source explanation, не LLM understanding. AI остается вспомогательным и не блокирует merge/build |
| G08 | Operational enterprise readiness проверяется отдельно, но до заявленного production profile; не считать Docker/JSON backup достаточным |
| G09 | #89 prepared-disabled pilot не доказывает рабочую автономную разработку; его окончание не prerequisite для ручного выпуска |
| G10 | Readiness необходимо разделять по доказательствам, не по отказу от результата: reviewed, built, tested, released. Технические/пользовательские/операционные условия вместе обеспечивают рабочий выпуск |

Новый центральный разрыв: отсутствует доказанный общий путь от двух частичных изменений к физической рабочей конфигурации. Он зафиксирован в #94, с native-частью #60. Нельзя закрыть его еще одним отчетом о различиях.

## Сохраненные EW-задачи и новая приоритетность

| Ранее | Теперь |
| --- | --- |
| EW-01 authority | Исправленная product authority + targeted reconciliation оставшихся активных документов |
| EW-02 B2/current state | Проверки тех MR операций, которые реализуются |
| EW-03 PR evidence | Exact source/merged/build/Target identity и независимость на соответствующем уровне |
| EW-04 shared API | Часть MR-06, существующий #11 |
| EW-05 delivery UI | Тот же Solution-контекст, новые состояния только вместе с backend |
| EW-06 native slice | Обязательный MR-07 с двумя объединенными изменениями, не просто старым архивом |
| EW-07 deployed Wiki | Существующий #55, не путать с ELMA release |
| EW-08 human acceptance | Остается отложенной, не возобновляется этим PR |
| EW-09 operations | Восстановление и target-ready эксплуатация, включая partial multi-package failure |
| EW-10 knowledge/AI | После/параллельно ядру; не замена merge/build |
| EW-11 agent pilot | Отдельная вторичная возможность #19/#89 |

Приоритетный план MR-01..08 с владельцами, зависимостями, negative cases и критериями - в [execution plan](../SOLUTION_FIRST_EXECUTION.md) и [техническом плане](../plans/working-configuration-release.md). В нем есть offline native build и альтернативная изолированная native-сборка; оба обязаны закончиться проверяемым физическим результатом.

## Проверка этого изменения и границы результата

Изменяются документы в существующем PR #92, не runtime. Сверка по GitHub устанавливает содержание, ссылки и сохранение предшествующей истории; исполнение тестов и независимый review должны быть записаны отдельно на фактическом head. Прежний CI не переносится на новый commit.

Созданные issues - долговременные задания, не запущенные workers. Публикация плана не означает, что merge/composer уже работает или что выпущен новый native package. Конкретное live PROD действие не разрешается общей продуктовой целью; текущая работа остается GitHub-only.

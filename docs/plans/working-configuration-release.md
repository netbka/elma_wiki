# Рабочая конфигурация: сравнение, слияние, сборка и выпуск

Дата: 8 октября 2026. Продуктовая цель подтверждена прямым уточнением владельца; архитектура ниже является планом реализации, не утверждением о готовом merge/composer.
Authority: [действующий продуктовый контракт](../SOLUTION_FIRST_PRODUCT_PLAN.md). Владельцы: Wiki #94, delivery #11, native identity #47, координация #91; native-сборка [elma365#60](https://github.com/netbka/elma365/issues/60).

## 1. Обязательный результат

Wiki получает полную исходную конфигурацию и последующие полные/частичные изменения, сравнивает версии, помогает разрешить конфликты и выпускает рабочую конфигурацию для следующего сервера. Поддерживаемые выходы должны охватить часть приложения, приложение, решение и полную конфигурацию сервера. Это суть продукта, а не необязательное продолжение просмотра.

Промежуточные результаты полезны, но различаются: сравнение, принятое объединение, собранный пакет, проверенный на профиле среды выпуск, фактическая установка на конкретный сервер. Нельзя назвать выпуском отчет, принятый виртуальный state или ZIP без работающего native-пути.

## 2. Исходники и то, что уже есть

Проверка выполнена через GitHub, без local/live execution. Wiki main: `9f8f17c9729acf5193f79f38a51f7aa104e97717`; native tools: `c0a494b25b08b9f9c76f496d7355329498f6df43`.

- [Wiki managed engine](../contracts/managed-workspace.md): полный baseline, partial overlays, трехсторонняя сверка, устойчивые identity, исходные bytes, responsibility и revision-bound решения. Current limitation: whole-file conflict choice, а не general fine-grained merge/materialization.
- [Solution handoff](../../lib/solutions.mjs): физический оригинальный full-export и привязка к актуальному review; composed candidate пока отсутствует.
- [Lane B](../audits/lane-b-elma-evidence-2026-10-08.md): существующий delivery нужно подключить к shared handoff без потери guards; legacy 404 нельзя просто отменить.
- [Native GUIDE](https://github.com/netbka/elma365/blob/c0a494b25b08b9f9c76f496d7355329498f6df43/tools/config-workspace/GUIDE.md): workspace build/stage, полный native layout, widget compiler, package check/pack и dependency planner. Документ запрещает считать произвольное наложение экспортов merge и директорию модуля готовым пакетом. Эти ограничения остаются до доказанного нового пути.
- [Native acceptance](https://github.com/netbka/elma365/blob/c0a494b25b08b9f9c76f496d7355329498f6df43/docs/enterprise-development/acceptance.md): полная затронутая родительская бизнес-цепочка, фактические формы/действия, исходный и исполняемый код, документные результаты, версии и восстановление. Использовать этот стандарт, а не придумывать более слабую приемку Wiki.

## 3. Пример двух изменений в Договорах

B - полный исходный снимок. A - изменение первого участника. C - изменение коллеги. Пользователь видит базы, состав и результат сравнения, не Git-команды.

Сначала установить реальное происхождение каждого изменения. При выгрузках с общего DEV C может уже включать A. Порядок загрузки, имя файла или имя загрузчика не доказывает независимую ветку и личный вклад. Хранить base artifact/revision, source reference, declared scope и способ установления базы. При неизвестной базе нельзя автоматически объявлять различия личными правками; получить проверенный baseline или согласованное сопоставление. Полезный read-only diff при этом остается доступен.

Частичный снимок дополняет B только внутри явно известного scope. Отсутствие объекта снаружи scope не удаляет его. Удаление требует явной поддержанной операции или доказанной полной области. Для измененного целого объекта отдельно доказать полноту его внутренних коллекций, прежде чем считать пропавший узел удаленным.

### Правило трехстороннего объединения

| Состояние относительно B | Решение |
| --- | --- |
| Меняется только A | Взять изменение A |
| Меняется только C | Взять изменение C |
| A и C внесли одно доказанно одинаковое изменение | Одно изменение с двумя источниками, без дублирования |
| Разные устойчиво идентифицированные части | Кандидат на автоматическое объединение, затем общая проверка связей и поведения |
| Одно поле/узел изменено по-разному | Явный конфликт, выбор A/C/нового результата |
| Один удалил, другой изменил или ссылается | Конфликт удаления/использования |
| Независимые добавления с одинаковым ID/code | Конфликт identity; не выбирать первый объект |
| Неизвестная база, дубликаты, неоднозначный rename | Неопределенность, не ложное отсутствие конфликта |
| Текст не пересекается, но изменились тип/права/условия/зависимости | Отдельная проверка семантической совместимости и бизнес-результата |

Идентификация: solution/provider context + service/namespace/code, затем доказанный native ID/code части. Не сопоставлять по отображаемому названию или позиции массива. Порядок массивов сохранять там, где он имеет значение. Для TypeScript/JavaScript использовать поддержанный parser/merge и обязательную компиляцию; обычное слияние строк не является доказательством корректности. Для процессов совместно проверять узлы, переходы, условия, lanes, context, формы и права.

Пример: A добавляет поле Категория договора, C меняет согласование суммы. Оба изменения должны попасть в итог. Но если новый маршрут использует измененный тип/обязательность поля или другую роль, требуется совместная проверка. Пример конфликта: A делает Лимит равным 100000, C - 200000; решение сохраняется отдельно, ни одна версия не выигрывает из-за более поздней загрузки.

Решение конфликта хранит B/A/C hashes, object/part reference, выбранный или новый результат, автора, причину и версии review. Исходные снимки не меняются. Новая правка зависимого входа делает затронутые решения и проверки stale. AI может предложить решение, но не принять его и не создать ложную native-историю.

## 4. Архитектура без второго движка

Переиспользовать существующий reducer, storage, review и delivery. Расширить их явной моделью merge plan и build inputs, а не собирать архив из очищенного search index.

Поток артефактов:

`immutable originals + explicit bases -> semantic changes -> conflict/resolution record -> reviewed merged revision -> materialization request -> native artifacts -> isolated verification -> frozen release -> target attempt/read-back`.

Proposed internal records, not yet implemented:

| Record | Содержание |
| --- | --- |
| Change base | Source/scope, base artifact/revision, ancestry evidence, полные исходные checksums |
| Merge plan | Входы, классификация частей, конфликты, неизвестные, dependency/behavior impact |
| Resolved revision | Выбранные правки, resolutions, actor/review digest, graph of immutable parents |
| Build request/result | Exact inputs, native adapter/compiler versions, target profile, dependency lock, generated bytes and logs/evidence refs |
| Release manifest | Scope/coverage, native install units, order, target prerequisites/bindings, checksums, tests and recovery policy |
| Deployment attempt | Concrete Target/baseline, confirmation, durable per-unit receipts, read-back and business evidence |

Wiki calls native tooling through a versioned HTTP/artifact contract. Native worker retains local credentials and compiler/server access. No nested checkout, copying a second compiler into Wiki, client-chosen storage roots or arbitrary customer-code execution in hosted Wiki. Build workers run in isolated approved execution with bounded network, resources and secrets.

## 5. Как получить настоящий пакет

### Путь A: поддержанная offline-сборка

Начать с полного неизменяемого baseline, восстановить полную native структуру и применить только reviewed changes по mapping. Сохранить manifests, resources, history/provenance, неизвестные поля и неизмененные bytes. Пересобрать связанные descriptor/runtime через правильный compiler. Widget compiler не доказывает поддержку process runtime; каждому типу нужен свой проверенный adapter.

Сначала доказать no-edit round trip, затем одно изменение, затем совместное изменение двух участников. Проверять отсутствие потери неизвестных и нетронутых объектов. ZIP timestamps могут отличаться; детерминированность определяется заранее заданным содержимым, а исходный и итоговый checksum сохраняются отдельно. Никакого общего игнорирования metadata.

### Путь B: изолированная native-сборка

Когда offline serializer/runtime generator для типа не доказан, использовать ELMA как native assembler: подготовить отдельную подходящую тестовую среду/копию с baseline и зависимостями, применить уже разрешенные изменения поддержанными native операциями, скомпилировать/опубликовать там и выгрузить native результат.

Это альтернативный технический путь к тому же выпуску, а не предложение пользователю вручную повторить все правки. Его доступность и очистка должны быть доказаны в native #60. Не импортировать A и C последовательно поверх общей среды и называть последнее состояние слиянием: сначала нужны разрешенные изменения и сохранение обоих вкладов.

Любой полученный кандидат установить из его финальных bytes на чистый или контролируемо сброшенный matching target и повторить проверки. Рабочая среда сборщика не должна скрывать отсутствующую в пакете зависимость. Если ни один путь для обязательного типа не готов, задача остается незавершенной, с конкретной работой по adapter, а не с новым определением продукта.

## 6. Scope и зависимости

Для части приложения вычислить замыкание зависимостей: поля/типы, формы, процессы, scripts, resources, permissions и внешние provider packages. Выбрать минимальную native import unit, которая действительно сохраняет ссылки. Если ELMA требует более крупный пакет, показать расширение и доказать, что соседние объекты не перезаписываются неконтролируемо. Для patch на непустой Target требуется точная поддержанная base/version precondition.

Для нескольких решений сохранить native package boundaries, устранить неоднозначных providers и определить порядок по полному графу. Цикл требует проверенной совместной установки или отдельного разрешения, не произвольной сортировки. Зафиксировать mutable prerequisite/preinstalled providers и их версии. Dynamic script references не считать полностью найденными по manifests; покрыть известные bindings и бизнес-тесты, явно учитывать обязательные неопределенности.

Полная конфигурация сервера требует coverage inventory по Solutions и глобальным параметрам, доступам/группам/связям, расписаниям, интеграционным bindings и прочим существующим конфигурационным доменам. Для каждого - included, externally provisioned-and-verified или unresolved с причиной и adapter. Нельзя назвать каталог решений полной конфигурацией. Установка должна исполнять каждое требуемое действие, а не выдавать только список ручных неизвестных.

Секреты - отдельные защищенные references и привязки, не копия Source tokens в артефакт. Адреса внешних систем, identities и лицензии связываются с целевым профилем. Перенос бизнес-данных/вложений и инфраструктуры имеет отдельный scope; необходимое конфигурационное/reference data учитывается явно.

## 7. Платные и закрытые модули

В прочитанном native GUIDE зафиксирован отказ установленного CLI `paid packages are not supported`; all-solutions container остается inspection, а не готовым full-server release. Это наблюдение конкретного инструментария, не доказательство невозможности любого vendor-supported переноса.

Спроектировать dependency resolver с двумя нормальными путями: совместимый лицензированный модуль уже установлен на Target либо официальный неизмененный дистрибутив доступен и может быть установлен разрешенным механизмом. Проверять package identity/version, совместимость platform/API, entitlement на целевой среде, необходимые настройки и фактическую работу нашей зависимости. Не смешивать opaque package с невозможностью использовать его публичный контракт.

Если на Target модуля нет, подготовить конкретное требование установки/лицензии и путь разрешенного provisioning. Закупка, выдача credentials и право распространения остаются owner-reserved. Наличие файла или похожего namespace не доказывает entitlement. Не снимать paid/isAuthor flags, не расшифровывать модуль и не подменять его заглушкой ради успешной проверки.

Неизменяемый vendor artifact можно хранить/передавать только при разрешенном праве и поддержанном формате. Иначе release references locked licensed preinstallation. В обоих случаях итог проверяется с настоящей зависимостью; отсутствие обязательного модуля означает неготовый выпуск, а не тихое исключение из конфигурации. Изолированный тестовый профиль тоже требует корректно предоставленных зависимостей; не предполагать доступную лицензию.

## 8. Что означает гарантия рабочего результата

Гарантия формулируется для указанного release scope, финальных artifacts и explicit target compatibility profile, а не неизвестного произвольного сервера. Она обеспечивается обязательными воротами выпуска, а не дисклеймером, заменяющим работу.

1. Все обязательные конфликты и coverage requirements разрешены; review относится к конкретному merged revision.
2. Физическая сборка содержит полный нужный состав; исходный и исполняемый код согласованы.
3. Профиль platform/compiler/modules/licenses/bindings зафиксирован; тестовый Target действительно ему соответствует.
4. Финальный пакет установлен из своих bytes на изолированный matching target. Проверены native source/runtime, manifests, permissions, references и ожидаемые изменения.
5. Пройден полный затронутый родительский бизнес-маршрут: обычное завершение, пустые/пропущенные назначения, возврат/повторная подача, отмена, затронутые files/users, ошибки/дубли/восстановление. Проверяются документы, задачи и финальные outputs, а не только завершение дочернего процесса.
6. На следующем сервере выполнены свежий preflight, проверка baseline/drift, dependencies/licenses и полномочий, затем read-back и обязательная приемка примененной версии. PROD требует конкретного разрешения и защищенного execution path.
7. Для сбоя есть наблюдаемый и проверенный план остановки/восстановления. Прежний package сам по себе не откатывает уже созданные документы, миграции или внешние действия.

Evidence packet различает intended artifact, published artifact и executed instance/form versions. Хранить merge/review digest, candidate SHA, compiler/dependency lock, Target fingerprint, snapshot/preconditions, native versions, test outcomes, actor/approval и recovery evidence. Missing/failed/stale mandatory evidence не превращается в PASS.

Сравнение read-back использует заранее установленную versioned expected-outcome policy. Legitimate native ID/version remaps и serialization различия допустимы только при явно определенном scope и отрицательных тестах. Unknown fields, bindings, permissions и executable bytes нельзя исключить, чтобы получить Verified. Не ослаблять текущую exact policy без отдельной реализации и проверки замены.

## 9. Поведение пользователя и сбои

В Solution показать B/A/C и предлагаемый итог; решения доступны у объекта. Сохранять выбор, комментарии, draft и initiating context. После committed mutation согласованно обновлять diff, counts, history, build eligibility и next action. Обновление одного chip не доказательство согласованности.

Build/install могут быть долговременными: durable job/operation ID, честные стадии и per-unit receipts, запрет дублей, возвращение после reload. Cancel показывать только там, где реально можно остановить действие. При timeout сначала выяснить результат, не повторять import вслепую. Idempotency конкретного native импорта нужно доказать; не обещать ее по наличию client operation ID.

Для многопакетного выпуска без native transaction не обещать атомарность всего сервера. Сохранять этапы и фактический partial outcome, reservation, recovery/forward-fix plan. Не ставить общий Done после успеха только первого пакета. Rollback configuration и rollback business data - разные операции.

## 10. Поэтапная реализация и приемка

| Slice | Владелец | Минимальное доказательство |
| --- | --- | --- |
| MR-01: bases/scope | Wiki existing domain/store | full+two partial, sequential/shared-source contamination, unknown base, absent-not-delete, immutable restart |
| MR-02: semantic merge/resolutions | Wiki reducer/review | independent/identical/same-value/delete-edit/rename/duplicate-ID/schema-dependency cases; stale resolution and unchanged-content preservation |
| MR-03: native materialization | elma365#60; Wiki adapter | no-edit, one-edit, two-edit round trips; resources/manifests/source/runtime preserved; no edited search-index packaging |
| MR-04: release scope/coverage | Wiki + native planner | part expansion, nonempty-target preconditions, dependency diamond/cycle, missing/global domain, multi-package completeness |
| MR-05: paid/profile resolver | native connections/provider boundary | preinstalled compatible/incompatible/missing entitlement, official opaque artifact, missing binding; no silent exclusion |
| MR-06: candidate/delivery wiring | #11 existing owners | shared+legacy reservations, same UUID roots, actor/connection denial, paused async stale checks, restart/cancel/unknown outcome |
| MR-07: Contracts native vertical slice | native acceptance + Wiki evidence | both independent changes function; real conflict resolved; actual parent outputs and source/runtime read-back; no-op import and mismatch fail |
| MR-08: promotion/recovery | existing operations | matching/new Target drift, partial install, lost response, preservation of concurrent drafts, rehearsal of safe recovery and target-specific acceptance |

MR-04/MR-05 design can run alongside MR-01/02; their requirements must be satisfied before release eligibility. All tests above are required work, not claims of runs in this GitHub-only task. Start with synthetic fixtures and the existing focused tests; native tests follow actual permitted execution. Keep freeze/review, test installation, business acceptance and PROD authorization distinct.

Completion of one vertical slice establishes that slice, not all types/scopes. Expand by explicit compatibility contracts and evidence until every required product scope is delivered. Human #59/#41 remains deferred and is not silently restarted or replaced by technical testing.

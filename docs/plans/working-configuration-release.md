# Рабочая конфигурация: сравнение, слияние, сборка и выпуск

Дата: 8 октября 2026. Продуктовая цель подтверждена прямым уточнением владельца; архитектура ниже является планом реализации, не утверждением о готовом merge/composer.
Статус на main `64af8d1` (16 октября 2026): PLAN-01 P1-P7, MR-08 (логика), принятие native-контрактов coverage/receipt, manifest policy v2 и UX-00..UX-06 слиты; UX-07 слит только как backend; P8 открыт. См. [статус реализации](#implementation-status-2026-10-16). Это синтетические доказательства, а не развертывание или native-приемка.
Authority: [действующий продуктовый контракт](../SOLUTION_FIRST_PRODUCT_PLAN.md). Владельцы: Wiki #94, delivery #11, native identity #47, координация #91; native-сборка [elma365#60](https://github.com/netbka/elma365/issues/60).

## 1. Обязательный результат

Wiki получает полную исходную конфигурацию и последующие полные/частичные изменения, сравнивает версии, помогает разрешить конфликты и выпускает рабочую конфигурацию для следующего сервера. Поддерживаемые выходы должны охватить часть приложения, приложение, решение и полную конфигурацию сервера. Это суть продукта, а не необязательное продолжение просмотра.

Промежуточные результаты полезны, но различаются: сравнение, принятое объединение, собранный пакет, проверенный на профиле среды выпуск, фактическая установка на конкретный сервер. Нельзя назвать выпуском отчет, принятый виртуальный state или ZIP без работающего native-пути.

## 2. Исходники и то, что уже есть

Проверка выполнена через GitHub, без local/live execution. Wiki main: `9f8f17c9729acf5193f79f38a51f7aa104e97717`; native tools: `c0a494b25b08b9f9c76f496d7355329498f6df43`.

- [Wiki managed engine](../contracts/managed-workspace.md): полный baseline, partial overlays, трехсторонняя сверка, устойчивые identity, исходные bytes, responsibility и revision-bound решения. Current limitation: whole-file conflict choice, а не general fine-grained merge/materialization.
- [Solution handoff](../../lib/solutions.mjs): физический оригинальный full-export и привязка к актуальному review; composed candidate пока отсутствует (на 8 октября; с PR #117 существует синтетический composed candidate, см. статус ниже).
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

Internal records (proposed on 8 October; on main `64af8d1` change base, merge plan, resolved revision, build request/manifest, composed candidate and per-attempt evidence packet exist with synthetic evidence; a native build result and release-level business evidence do not):

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

Если на Target модуля нет, подготовить конкретное требование установки/лицензии и путь разрешенного provisioning. Закупка, выдача credentials и право распространения остаются owner-reserved ([`licences-accounts-providers`](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers)). Наличие файла или похожего namespace не доказывает entitlement. Не снимать paid/isAuthor flags, не расшифровывать модуль и не подменять его заглушкой ради успешной проверки.

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

## MR-04 pure planner implementation

The bounded pure scope/dependency planner and its native-metadata gaps are specified in [release-scope-planner.md](../contracts/release-scope-planner.md). Planning does not enable materialization, release eligibility or provider execution; unknown native units and global coverage remain blockers.

The Wiki-side consumer of pinned native unit/coverage declarations (PLAN-01 P4) is specified in [native-coverage-adapter.md](../contracts/native-coverage-adapter.md). Since #133 it pins the published `elma365-native-coverage@1` and `elma365-dependency-receipt@1` contracts (schema revision 1.1, elma365 PR #103), and #135 re-pins the capability catalog to elma365 PR #109. Real input still fails closed: no elma365 worker implements the read-only `targetProfile` observation, and no native import receipt or installation observation exists. Global handlers remain a separate P8 prerequisite.

The thin Wiki materialization adapter (PLAN-01 P6, MR-03) is specified in [native-materialization.md](../contracts/native-materialization.md). It binds the current P3 resolution, P4 units, P5 locks, compiler lock and exact originals into a request and verifies native output. It pins elma365 E1 (`elma365-native-materialization@1`, now schema revision 1.3 at elma365 `3d819be`, PRs #89/#99/#104; Wiki #122, #135) after schema review, and #127 adds an opt-in bridge `materialize` transport. elma365 PR #101 added an offline E1 executor, but no Wiki route calls materialization and no worker run has been observed, so it returns `unavailable`; physical Contracts output and native validation remain evidence-unavailable, recorded as an open P8 gate that depends on an approved netbka/elma365#60 worker.

Composed candidate and guarded delivery integration (PLAN-01 P7, MR-06) extends the single #11 coordinator with a `composed` reference namespace. See [target-deployment.md](../contracts/target-deployment.md), composed candidates. A frozen candidate binds the exact P6 build, P4 units and order, P5 locks, Target profile and review events. Stale inputs block the final guarded write, reservations span all roots, and per-unit receipts are truthful, including `partial-outcome`. An unknown outcome is never redispatched. All evidence is synthetic. Composed candidates stay non-native and reach only a synthetic training Target until P8 pins native materialization and validation.

Promotion and recovery (MR-08) extend the same coordinator; see [target-deployment.md](../contracts/target-deployment.md#promotion-recovery-and-evidence-packets-mr-08). A verified non-production attempt promotes the exact candidate only to a destination on the same platform version whose fresh state equals the verified baseline; drift, a stale candidate or invalidated source evidence blocks before dispatch. Every observed read-back records a reconciliation (`applied`, `not-applied`, `diverged`); a retry exists only after reconciliation, is idempotent per key, needs a new typed confirmation, and a partial install is forward-recovered only with a declared idempotent re-import. Each attempt yields a digest-bound per-destination evidence packet. PROD needs a trusted owner grant and a separate typed confirmation; the service wires no grant, so PROD stays refused. Evidence is synthetic only. Still open: preservation of concurrent drafts on the destination beyond the drift block, restore rehearsal, live target-specific acceptance (MR-07/P8 and `live-selection-and-release`) and UI for these actions.

## Implementation status (2026-10-16)

Reconciled against main `64af8d1` by reading merged PRs, code, tests and contracts. Every merged item has synthetic evidence only. Nothing here is a hosted rollout, a live ELMA operation, native acceptance or business acceptance, and merged is not deployed.

### MR slices

| Slice | Status on main | PRs | Remaining owner |
| --- | --- | --- | --- |
| MR-01 | Declared base, bounded component scope, evidence-bound deletion, base/scope UI. The fixed pull entry (UX-01) fills a `source-sequence` base; ancestry stays `ancestryVerified: false` | #95, #103, #110 (P1), #130 | B2 (pull order never becomes verified ancestry) |
| MR-02 | Whole-component three-way plan, durable chained resolutions, review UI. No part/field merge, rename or duplicate-ID detection; automatic merge, acceptance and build stay disabled | #107 (P2), #111 (P3) | B2 |
| MR-03 | Wiki request/output verification adapter. E1 `elma365-native-materialization@1` pinned at schema revision 1.3 (elma365 `3d819be`) with a drift guard; manifest policy 2 is selected per request for profile-2 identities, whose edits stay catalog-`unsupported`. Bridge `materialize` transport and production E1 adapter, opt-in through `WIKI_NATIVE_MATERIALIZATION_*` and unconfigured by default. No route or UI calls it and no native materialization has run, so the result stays `unavailable` | #113 (P6), #122, #127, #135 | C2, then P8 |
| MR-04 | Pure planner and native-coverage adapter pinning `elma365-native-coverage@1` rev 1.1 (elma365 PR #103), catalog re-pinned to elma365 PR #109. C1 feeds it into composer build eligibility (`lib/composed-build-eligibility.mjs`, `GET /api/solutions/:id/composed-eligibility`, the «Условия сборки» list); the service has no declaration source yet, so coverage stays blocked and real declarations still fail closed without a native Target observation | #104, #109 (P4), #133, #135, C1 | P8 (declaration source); the observation worker is elma365#60 (B4) |
| MR-05 | Pure dependency/Target-profile resolver pinning `elma365-dependency-receipt@1` rev 1.1, fed by C1 into composer build eligibility together with the Target-profile gate (a stale or unobserved profile blocks). Receipts are admitted only from a read-only bridge `targetProfile` observation that no elma365 worker implements, so real dependencies stay `unknown` and block | #108 (P5), #133, C1 | the worker is elma365#60 (B4) |
| MR-06 | Frozen composed candidates through the single #11 coordinator (`/api/solutions/:id/composed`, per-unit receipts, `partial-outcome`) and the Solution "Сборка" view with Compare/Resolve/Build/Verify next actions. Build is always shown blocked (`composedBuild.available: false` in `server.mjs`) and freezing has no HTTP route. Synthetic build and Target only | #117 (P7), #123 | C2 (build route), B1 (freeze route) |
| MR-07 | Open. dev2 is designated; presets and `import-normalized-v1` read-back are wired. No live materialization, install, read-back or business check has run | #118 (N1), #119 (T1), #120 (W1) | P8 |
| MR-08 | Coordinator logic only: `promote` to a same-platform, baseline-equal destination; read-back reconciliation (`applied`, `not-applied`, `diverged`); `retry`/forward recovery after reconciliation; `delivery-evidence-packet-v1`. PROD needs a trusted owner grant the service never constructs, so PROD stays refused. No UI, no restore rehearsal, no preservation of concurrent destination drafts beyond the drift block, no live use | #124 | A1 (UI); live use under P8 and the gates below |

### PLAN-01 packages

| Package | Status on main | PRs |
| --- | --- | --- |
| P1-P5 | Merged (MR-01, MR-02, MR-04, MR-05 above) | #110, #107, #111, #109, #108 |
| P6 | Merged; owner-accepted with native validation deferred to P8 | #113 |
| P7 | Merged (MR-06) | #117 |
| G1, N1, T1, W1 | Merged: governance alignment, dev2 designation and `import-normalized-v1`, DEV/DEV2 presets, dev2 read-back wiring | #116, #118, #119, #120 |
| P8 | Open: actual native and business acceptance of the Contracts candidate on dev2 | this campaign's P8 |

### Analyst release (AR)

| Slice | Status on main | PRs / record |
| --- | --- | --- |
| AR-00..AR-02, AR-03 unchanged-original handoff | Offline analyst releases, implemented before this plan ([analyst-releases.md](../contracts/analyst-releases.md)); shared contextual handoff delivery through the #11 coordinator | contract record; #102, #105 (shared handoff) |
| AR-04 | The shared delivery path is the single coordinator above; no live Target delivery is observed | #102, #105, #117 |
| AR-05 | Supported widget-script edits are review-only: an edited candidate is `deployable: false`, `materialization: unavailable`, and gets no handoff or delivery | #125 |
| AR-06 | Promotion/recovery logic as MR-08; PROD refused; no restore rehearsal | #124 |

### Intuitive Solution UI (UX)

Plan: [intuitive-solution-ui-2026-10-15.md](intuitive-solution-ui-2026-10-15.md) (#126).

| Package | Status on main | PRs | Remaining owner |
| --- | --- | --- | --- |
| UX-00 | Shared label map and inline-string lint | #128 | — |
| UX-01 | One fixed entry: choose server and solution, pull the whole solution; DEV and dev2 are read-only export only; manual upload under "Прежние загрузки" | #130 | — |
| UX-02 | Business names first, grouping by module and kind | #131, #138 | — |
| UX-03 | Review summary, chips, status ribbon (UX-03a); decision dialog, closing a no-change version, highlighted diagram (UX-03b) | #132, #134 | — |
| UX-04 | Lifecycle stepper and status badge; tabs reordered | #136 | — |
| UX-05 | "О решении": purpose, modules, recent attributed events | #137 | — |
| UX-06 | "Как работает" and "Экраны и данные" tabs; "where it is used" for fields stays open (not in the export projection) | #140, #142 | — |
| UX-07 | Backend only: durable contextual change requests, anchors, attributed status, opt-in publication through the bug-report transport. No form, list tab, chips or field anchors | #141 | A2 |
| UX-08 | Not started | — | A3 |
| UX-09 | Not started; design validation only, not #59/#41 work. Readiness criteria for a later #41/#59 owner decision are proposed in open PR #143 (docs only, `intuitive-solution-ui-2026-10-15.md`) | — | A4 |

### Remaining work: this campaign's tasks

Each task owns its row; none is claimed as done here.

| Task | Outcome | Depends on |
| --- | --- | --- |
| C1 | Feed the release-scope planner, P4 coverage adapter, P5 dependency resolver and the bridge Target-profile observation into the composer's build eligibility gate; show each blocking reason | — |
| C2 | Derive `composedBuild.available` from `WIKI_NATIVE_MATERIALIZATION_*` plus bridge health; a POST build route sends the E1 request through the bridge and verifies the validation receipt; unconfigured stays unavailable with a reason | C1 |
| B1 | Server route that freezes a composed candidate only from a current validated C2 build; a request body never supplies the bound values | C2 |
| B2 | Part/field-level three-way merge for kinds with stable part IDs (process elements first), rename and duplicate-ID detection, dependency/behaviour findings; unknown ancestry still blocks | — |
| A1 | MR-08 states and reconcile/retry actions in the shared delivery renderer for the designated non-production Target; PROD shown refused | B1 |
| A2 | UX-07 user interface on #141 | — |
| A3 | UX-08 per-actor reviewed marks | A2 |
| A4 | UX-09 Storybook and label/card-sort/five-second materials; no #59/#41 work | A3 |
| P8 | Native and business acceptance of the Contracts candidate on dev2 through the operator bridge | C2, B1 |

### Owner and environment gates

Recorded decisions only; this section adds no new owner dependency. Triggers are defined in [Owner-reserved matters and blockers](../SOLUTION_FIRST_PRODUCT_PLAN.md#owner-reserved-matters-and-blockers).

| Gate | Recorded decision or state | Effect |
| --- | --- | --- |
| dev2 acceptance Target | Owner designation 2026-10-14 (#37, recorded by #118): install/import of the Contracts candidate, read-back under `import-normalized-v1`, affected business checks and reset/recovery on dev2 through the operator bridge only. Shared business DEV and PROD are excluded | The Target choice is not an owner stop for P8 |
| dev2 bridge with `--materialize` | Environment step: the dev2 bridge worker must run merged elma365 main with `--materialize` (elma365 PR #102, merged 2026-10-15); the Wiki service needs `WIKI_NATIVE_MATERIALIZATION_*`; read-back is repeated with that worker (it returns `metadataFiles` since elma365 PR #100); the candidate SHA-256 must be listed in `WIKI_TARGET_DEV2_DEPLOY_CANDIDATES` | Blocks P8 live evidence until observed |
| Contracts section ownership | elma365 PR #92 (E3, merged 2026-10-14): a native platform rule; the planner reports 5 `sectionOwnershipConflicts` between Contracts and `spark_integration`/`system_directories`. The supported fix is a composition change through ELMA solution management and a new export, never stripping members or force-importing. Recorded on main as needing an owner/composition decision | Blocks a combined Contracts candidate from validating |
| Native evidence from elma365#60 | No worker implements the read-only `targetProfile` observation; no process-runtime compiler is published; profile-2 edits are catalog-`unsupported` | B4 external evidence; dependent evidence stays `unknown` and blocking |
| Real dev2 exports | The Contracts baseline and changes from dev2 are not yet captured as Wiki inputs (read-only export through UX-01) | P8 input |
| #59/#41 human review, #38 final acceptance | Deferred by the owner (recorded on #91, coordinator checkpoint 2026-10-08; `paused-work-resumption`). UX-09 tests are design validation (owner, 2026-10-15). #38 follows #59/#41 and the integrated walkthrough | Not restarted; no synthetic substitute |
| #19 provider execution | Disabled (the same 2026-10-08 deferral; `paused-work-resumption`) | Not re-enabled |
| PROD | Refused: `live-selection-and-release`; MR-08 constructs no owner grant (#124); agents never change anything on PROD (elma365 PR #105, merged 2026-10-16) | No PROD write by any task |
| Merge to main | `merge-to-main`: the owner merges; an open PR awaiting merge is not a blocker (owner, 2026-10-13) | Dependent tasks stack on verified heads |

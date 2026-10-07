# Offline compiler и SDK

Browser workspace работает без подключения к ELMA. Без SDK выполняется ограниченная TypeScript-проверка. С операторским профилем Check использует портированный compiler и полный предоставленный context SDK; UI показывает host, platform/TypeScript versions и статус **offline**. Это не проверка текущего сервера и не разрешение импорта.

## Происхождение compiler

Перенесён generic `widget-compiler.mjs` из [netbka/elma365, revision 539bae0](https://github.com/netbka/elma365/blob/539bae085d2645a4a75f5044bfc5acf39b86908a/elma-development/lib/widget-compiler.mjs). Исходный [runbook](https://github.com/netbka/elma365/blob/539bae085d2645a4a75f5044bfc5acf39b86908a/elma-development/docs/file-based-widget-dev.md) фиксирует server cross-check и границы версий. Wiki не копирует credentials, live cache или customer exports из этого репозитория.

Контракт `widget-worker-ts-5.9.3-v1`: TypeScript **5.9.3** закреплён точно; ES2018, noImplicitAny/strictNullChecks, platform client wrapper и quirks function declarations сохранены. Доступ к диску compiler ограничен собственными `lib.*.d.ts` TypeScript. Uploaded code не исполняется, compiled runtime не публикуется и не записывается в snapshot.

Поддержанная compatibility list: **2025.4.55**, **2026.7.23**. Другие версии требуют отдельного исследования и compiler evidence. Профиль не выбирается по URL из загруженного файла.

## Получение SDK

Оператор получает полный widget context DTS в отдельно разрешённом workflow для явно выбранного host/version. Generic sidecar `.client.d.ts/.server.d.ts` из export обычно не содержит полного Context и не является достаточным SDK. Wiki не логинится на сервер, не читает parent credentials и не делает сетевые запросы за DTS.

Request строится `buildDtsRequest` из `lib/widget-context.mjs`: bound app/process fields образуют Context, descriptor fields — ViewContext; hidden/EVENT fields фильтруются по стороне, script options учитываются, client RPC names берутся из server source. Для bound entity нужен ровно один matching provider в этом snapshot. Не подставляйте fields из другого проекта.

`sdkRequestHash(profile, body)` вычисляет SHA-256 canonical JSON от explicit host, platform/TS versions, compiler contract и точного request. Он отличается от старого host/body SHA-1 cache инструмента elma-dev: при переносе одобренного SDK создайте новую mapping, не переименовывайте произвольный cache как будто он совпадает.

## Установка профиля

Файлы размещает оператор в приватном хранилище **конкретного проекта**:

```text
.local/projects/<projectId>/compiler/
  profile.json
  <requestHash-client>.d.ts
  <requestHash-server>.d.ts
  <dependencyContentHash>.d.ts     # опционально
```

Пример schema (все значения синтетические/placeholder):

```json
{
  "host": "https://target.example",
  "platformVersion": "2026.7.23",
  "typescriptVersion": "5.9.3",
  "compilerContract": "widget-worker-ts-5.9.3-v1",
  "sourceChecksum": "<SHA-256 исходного .e365 этого проекта>",
  "evidence": {
    "verifiedAt": "2026-10-07T00:00:00Z",
    "reference": "<приватная ссылка/идентификатор проверки compiler>"
  },
  "entries": {
    "<requestHash>": {
      "sha256": "<SHA-256 соответствующего UTF-8 DTS>",
      "additionalDts": "<optional content SHA-256>",
      "serverDependencyDts": "<optional content SHA-256>"
    }
  }
}
```

Host — HTTPS origin без credentials, query, path и завершающего slash. `sourceChecksum` — checksum metadata проекта. В `entries` включайте только exact requests этого snapshot. DTS обязаны содержать Context, client DTS — Server, bound form DTS — ViewContext. Optional dependency-файлы называются их content SHA-256 + `.d.ts`. Evidence записывает оператор: сервис проверяет schema и integrity, но не удостоверяет provenance vendor подписью.

Лимиты: profile.json 64 КБ, каждый DTS 2 МБ. Symlinks и произвольные filenames запрещены. Профиль читается только после owner/project authorization. API установки профиля отсутствует: обычный пользователь не может повысить inferred types до platform SDK через upload.

SDK может содержать customer namespaces и типы; храните его с теми же правами и backup/privacy правилами, что и original. Не помещайте токены в profile, DTS, evidence или logs. Не коммитьте `.local`, реальные SDK и их requests.

## Проверка и invalidation

1. Перезагрузите editor: кнопка показывает **Проверить ELMA (offline)** и выбранные host/versions.
2. Получите completion для полей и API, которые разрешены этим SDK.
3. Introduce type error: Check возвращает editable filename/line и ничего не публикует.
4. Correct source: compiler PASS относится к этой workspace revision, source hash и profile hash.
5. При изменении source снимается Check. Изменение RPC names требует нового exact client DTS request.
6. При изменении/повреждении профиля, DTS или snapshot SDK выключается и прежний platform Check не отображается как действующий.

Недостающий/неподдержанный profile даёт явный reason и ограниченную TypeScript-проверку. TypeScript PASS не заменяет platform compiler PASS. Связанное приложение отсутствует/неоднозначно — exact SDK недоступен; inferred Context имеет unknown fields, а не fields чужого приложения.

Локальные unit/API/browser tests используют только synthetic SDK. Они доказывают adapter gates, editor completion, errors и invalidation, но не server equivalence нового deployment. Slice B, package build, live cross-check и deployment требуют отдельной задачи и разрешённой среды.

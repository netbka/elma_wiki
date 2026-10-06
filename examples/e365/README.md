# Синтетический пример

Это учебные фрагменты, а не экспорт и не пакет для импорта. Здесь намеренно
нет package.json, manifest/history и скомпилированного runtime.

Из корня репозитория:

```sh
node tools/workbench.mjs check examples/e365
mkdir -p .local
node tools/workbench.mjs add-field examples/e365/appViews/entities/example_module/requests.json examples/e365/widgets/entities/example_module.requests/edit_form title integration_note "Комментарий интеграции" .local/candidate
```

Выходная папка должна отсутствовать. Исходники сохраняются. Результат — два
JSON-кандидата и отчёт; их нельзя импортировать без согласования history,
компиляции затронутых скриптов, испытания на стенде и повторного экспорта.

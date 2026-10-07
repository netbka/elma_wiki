# Текущее состояние

Проверено по коду ветки интеграции PR #7–#9, 2026-10-07.

- Самостоятельный Node.js-сервис принимает ручную загрузку .e365 в отдельный приватный проект владельца.
- Оригинал сохраняется неизменным; viewer, preview, отчёт, повторный разбор и удаление проверяют владельца.
- GitHub используется для OAuth-входа, а не импорта репозиториев.
- Viewer доступен для чтения. Экспериментальный browser workspace для распознанного WIDGET поддерживает Monaco, descriptor-derived types и RPC completion, TypeScript diagnostics, lint, отдельную рабочую копию, autosave, diff, checkpoints/restore и конфликты вкладок. Оригинал не изменяется.
- Типы SDK и внешних dependencies не разрешаются. Platform compiler adapter, build, подключения к ELMA, deployment candidates и read-back verification не реализованы. TypeScript PASS не означает ELMA compiler PASS.
- Storybook и заимствованный engineering skeleton остаются предложениями.

Синтетические unit/API и browser checks проверяют границы сервиса и editor workflow. Полная Slice A остаётся незавершённой из-за отсутствующего verified platform compiler и полного object-specific SDK; Slice B не начата. Эти проверки не доказывают живой OAuth, ELMA compiler или серверный round trip.

Текущая authority: AGENTS.md, README.md и реализованный код. Целевые контракты доступны через [INDEX.md](INDEX.md). Расширение сети и runtime требует отдельной реализации и явно разрешённой среды.

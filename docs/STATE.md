# Текущее состояние

Проверено по коду реализации PR #8, 2026-10-07. Эта ветка основана на #8 и включённом им #7; архитектура #9 не входит в изменение.

- Самостоятельный Node.js-сервис принимает ручную загрузку .e365 в отдельный приватный проект владельца.
- Оригинал сохраняется неизменным; viewer, preview, отчёт, повторный разбор и удаление проверяют владельца.
- GitHub используется для OAuth-входа, а не импорта репозиториев.
- Viewer доступен для чтения. Экспериментальный browser workspace для распознанного WIDGET поддерживает Monaco, inferred context types/RPC completion, diagnostics, lint, отдельную рабочую копию, autosave, diff, checkpoints/restore и конфликты вкладок. Оригинал не изменяется.
- Per-project offline compiler profile включает предоставленный full context SDK и dependency typings. Check использует researched platform compiler, TypeScript 5.9.3 и explicit host/version; profile/request/content hashes снимают stale evidence. SDK устанавливает оператор отдельно, он не загружается из сети приложением.
- Без profile внешний SDK не разрешается; TypeScript PASS не означает ELMA compiler PASS. Build, подключения к ELMA, deployment candidates и read-back verification не реализованы.

Синтетические unit/API/browser checks покрывают editor workflow, compiler/profile gates, SDK completion и invalidation. Live SDK/host profile для customer-конфигурации в этой задаче не устанавливался. Реальное platform equivalence проверяется отдельно для выбранного host/version; Slice B не начата. Эти проверки не доказывают живой OAuth, server cross-check или round trip.

Текущая authority: AGENTS.md, README.md и реализованный код. Целевой #8 contract и offline profile — в [INDEX.md](INDEX.md). Расширение сети и runtime требует отдельной реализации и явно разрешённой среды.

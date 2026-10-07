# Следующие этапы

Это перечень предложений, не автоматическое назначение работ и не разрешение deployment.

| Этап | Результат | Приёмка |
|---|---|---|
| Документация и task-first UX (#7) | Tutorial и понятный маршрут от задачи к объекту и проверке | Пользователь без Git находит место изменения и понимает границы workflow |
| Browser workspace Slice A (#8), частично реализован | Monaco, limited typings/RPC, TypeScript diagnostics, lint, autosave, diff и restore работают; verified ELMA compiler и полный SDK требуют adapter/version evidence | Все 12 проверок Slice A после compiler integration; owner isolation, stale-save conflict и invalidation check уже проверяются синтетически |
| Engineering inventory (#9, phase 0) | Карта authority/evidence/duplicates для текущих документов | Нет удаления до карты; текущие факты имеют явного владельца |
| Generic skeleton и ELMA-specific authority (#9, phases 1–2) | Router, шаблоны/guard; отдельный Product Constitution + Principles | Согласованы с текущими правилами и возможностями, без Dyk product semantics |
| Storybook foundation (#9, phase 3) | Общий renderer, synthetic fixtures, review manifest | Реальные UI states представлены без customer data |
| Source/Target bridge и Slice B (#8/#9) | Explicit host/capabilities, immutable snapshot/candidate, authorized deploy, read-back evidence | Проверки Slice B только в явно разрешённой non-production среде; PROD отдельно защищён |
| Slice C (#8) | Refactoring, replay, optional Git/VS Code integration | Отдельные contracts и evidence для каждой добавленной возможности |

Порядок между независимыми направлениями выбирается при назначении задачи. Slice A не требует deployment; Source/Target runtime не считается готовым по наличию документации.

// A documentation fixture, not an export, parser, editor, or ELMA runtime.
// Both the static public build and Storybook use this model and renderer.
export const FIELD_GUIDE_PATH = '/learn/find-field/';
export const FIELD_GUIDE_TITLE = 'Найти поле: от задачи к источнику';
const query = Object.freeze({
  service: 'appViews', namespace: 'example_module', code: 'requests', field: 'title'
});

export function fieldGuideFixture() {
  return [
    {
      service: 'appViews', namespace: 'example_module', code: 'requests',
      name: 'Обращения',
      sourcePath: 'appViews/entities/example_module/requests.json',
      document: { fields: [
        { code: 'title', view: { name: 'Тема обращения' }, type: 'STRING' },
        { code: 'description', view: { name: 'Описание' }, type: 'TEXT' }
      ] }
    },
    {
      service: 'appViews', namespace: 'example_module', code: 'categories',
      name: 'Категории',
      sourcePath: 'appViews/entities/example_module/categories.json',
      document: { fields: [
        { code: 'title', view: { name: 'Название категории' }, type: 'STRING' }
      ] }
    }
  ];
}

const unavailable = reason => ({ state: 'unavailable', reason });
/**
 * Resolve one field in the bounded teaching fixture. No global name matching:
 * identical field codes in another application are not the same field.
 * Unknown or ambiguous evidence must not produce the successful result.
 */
export function createFieldGuideModel(records = fieldGuideFixture()) {
  if (!Array.isArray(records)) return unavailable('Учебные данные недоступны.');
  const owners = records.filter(record => record &&
    record.service === query.service && record.namespace === query.namespace &&
    record.code === query.code);
  if (owners.length > 1) return { state: 'ambiguous', reason: 'Найдено несколько описаний приложения.' };
  const owner = owners[0];
  if (!owner || !Array.isArray(owner.document?.fields)) {
    return unavailable('Описание приложения или список полей не распознаны.');
  }
  const matches = owner.document.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field?.code === query.field);
  if (matches.length > 1) return { state: 'ambiguous', reason: 'Код title повторяется в одном приложении.' };
  if (!matches.length) return unavailable('Поле title не найдено в этом учебном описании.');
  const { field, index } = matches[0];
  if (typeof field.type !== 'string' || !field.type.trim() ||
      typeof owner.sourcePath !== 'string' || !owner.sourcePath.trim()) {
    return unavailable('Для поля не подтверждены тип или путь источника.');
  }
  return {
    state: 'ready',
    owner: { namespace: owner.namespace, code: owner.code, name: owner.name || owner.code },
    field: { code: field.code, name: field.view?.name || field.code, type: field.type },
    sourcePath: owner.sourcePath,
    pointer: `/fields/${index}`,
    // Show only the selected public fixture field, never a whole project.
    snippet: JSON.stringify(field, null, 2)
  };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const nextSteps = `<section id="field-next" class="section">
  <h2>Следующий шаг</h2>
  <p>Продолжайте в привычном Designer: найдите то же приложение и поле по коду.
  Перед изменением проверьте привязку формы, обработчики и права на тестовом стенде.</p>
  <div class="actions">
    <a href="/articles/relationship-recipe/">Проверить привязки и использования</a>
    <a href="/articles/package-map/">Разобраться в устройстве пакета</a>
    <a href="/guide/">Работать со своей конфигурацией</a>
  </div>
</section>`;

/** Pure HTML: native links/details work without JavaScript or backend calls. */
export function renderFieldGuide(model = createFieldGuideModel()) {
  const state = ['ready', 'unavailable', 'ambiguous'].includes(model?.state)
    ? model.state : 'unavailable';
  const header = `<article class="article field-guide" data-field-guide="${state}">
    <a href="/examples/">← Все учебные примеры</a>
    <div class="eyebrow">Первый результат без установки</div>
    <h1>${FIELD_GUIDE_TITLE}</h1>
    <p class="lead">Задача: определить, где описана «Тема обращения», не создавая новое поле.</p>
    <p class="badge">Синтетический пример · Только чтение</p>
    <p>Регистрация, свой .e365, Git, терминал и AI не нужны.
    Это отдельный учебный фрагмент, не пакет для импорта и не работающий Designer.
    Здесь ничего не меняется в вашей ELMA.</p>`;
  if (state !== 'ready') {
    const title = state === 'ambiguous' ? 'Источник неоднозначен' : 'Недостаточно данных для вывода';
    return `${header}<section id="field-unavailable" class="card section">
      <h2>${title}</h2><p>${escape(model?.reason || 'Учебные данные не распознаны.')}</p>
      <p>Не найдено в индексе не означает, что поля нет в ELMA.
      Проверьте отчёт разбора, исходный файл и нужное приложение в Designer.
      Не создавайте новое поле только из-за неполного результата поиска.</p>
      <a href="${FIELD_GUIDE_PATH}">Вернуться к полному учебному примеру</a>
      </section>${nextSteps}</article>`;
  }
  return `${header}
    <nav aria-label="Шаги поиска поля" class="section">
      <ol>
        <li><a href="#field-owner">Выбрать приложение</a></li>
        <li><a href="#field-source">Найти описание поля</a></li>
        <li><a href="#field-check">Проверить границы результата</a></li>
        <li><a href="#field-result">Проверить себя и продолжить</a></li>
      </ol>
    </nav>
    <section id="field-owner" class="section">
      <h2>1. Начните с приложения, а не с совпадения имени</h2>
      <p>В задаче речь об обращении. Выберите приложение <strong>${escape(model.owner.name)}</strong>:
      <code>${escape(model.owner.namespace)} / ${escape(model.owner.code)}</code>.</p>
      <p>В учебных «Категориях» тоже есть код <code>title</code>.
      Это другое поле. Учитывайте сервис, пространство имён и код приложения.</p>
      <p><strong>Ожидаемый результат:</strong> вы исследуете <code>appViews / ${escape(model.owner.namespace)} / ${escape(model.owner.code)}</code>,
      а не первое совпадение <code>title</code>.</p>
      <a href="#field-source">Дальше: описание поля →</a>
    </section>
    <section id="field-source" class="section">
      <h2>2. Сверьте код, тип и источник</h2>
      <div class="scroll"><table>
        <thead><tr><th scope="col">Код</th><th scope="col">Название</th><th scope="col">Тип</th><th scope="col">Контекст</th></tr></thead>
        <tbody><tr><td><code>${escape(model.field.code)}</code></td><td>${escape(model.field.name)}</td>
        <td><code>${escape(model.field.type)}</code></td><td>Данные приложения «${escape(model.owner.name)}»</td></tr></tbody>
      </table></div>
      <p>Источник в учебном фрагменте:
        <code>${escape(model.sourcePath)}#${escape(model.pointer)}</code>.</p>
      <details>
        <summary>Посмотреть JSON выбранного поля</summary>
        <pre><code>${escape(model.snippet)}</code></pre>
        <p>Это фрагмент описания одного поля, не полный экспорт.
        Читать JSON для прохождения примера необязательно.</p>
      </details>
      <p><strong>Ожидаемый результат:</strong> вы знаете владельца поля и место его описания.
      Это ещё не доказательство того, где поле показано или проверяется.</p>
      <a href="#field-check">Дальше: что ещё проверить →</a>
    </section>
    <section id="field-check" class="section">
      <h2>3. Отделите найденное поле от поведения формы</h2>
      <p>Поле приложения и состояние формы — разные вещи.
      В привязанной форме обращение <code>Context.data.title</code> нужно сверить с контекстом приложения.
      Наличие похожего имени в <code>ViewContext</code> само по себе эту связь не доказывает.</p>
      <p>Этот пример подтверждает только описание поля в синтетических данных.
      Привязка элемента формы, событие обработчика, права и поведение на сервере здесь не проверены.
      Текстовое совпадение в скрипте не равно доказанной связи.</p>
      <p>При неполном индексе проверьте отчёт и исходник. Сначала исследуйте,
      затем выбирайте поддержанный способ изменения.</p>
      <a href="#field-result">Дальше: проверить себя →</a>
    </section>
    <section id="field-result" class="card section" data-field-guide-result="ready">
      <h2>4. Вы нашли место описания поля</h2>
      <p>Назовите приложение, код поля, тип и источник.
      Объясните, почему это ещё не подтверждает поведение формы.</p>
      <details>
        <summary>Проверить ответ</summary>
        <p><strong>${escape(model.owner.name)}</strong>,
        <code>${escape(model.field.code)}</code>, <code>${escape(model.field.type)}</code>,
        <code>${escape(model.sourcePath)}#${escape(model.pointer)}</code>.
        Привязки, обработчики и права требуют отдельной проверки.</p>
      </details>
      <p>Результат — найденное описание и понятный следующий шаг, а не выполненное изменение или готовность к импорту.</p>
    </section>
    ${nextSteps}
  </article>`;
}

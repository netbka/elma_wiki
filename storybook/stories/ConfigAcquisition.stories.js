import { mountAcquisition } from '../../web/managed/acquisition.js';
const project = { id: 'synthetic-project', filename: 'synthetic.e365' };
const record = { id: 'synthetic-acquisition', state: 'ready', solutions: [{ code: 'synthetic', project }], exclusions: [{ code: 'paid_example', status: 'excluded-paid' }] };
const explain = async () => { throw Error('Учебный пример: соединение с ELMA не выполняется.'); };
function story(model) {
  return mountAcquisition({ upload: explain, catalog: explain, start: explain, get: explain }, () => {}, model);
}
export default { id: 'config-acquisition', title: 'Решение/Загрузка из ELMA и архива', parameters: { layout: 'padded' } };
export const Ready = { render: () => story({ acquisition: record }) };
export const Empty = { render: () => story({}) };
export const Failed = { render: () => story({ acquisition: { ...record, state: 'failed', solutions: [], error: 'Экспорт не завершён. Начните новую загрузку.' } }) };
export const ConnectionError = { render: () => story({ error: 'Источник недоступен. Проверьте соединение.' }) };
export const Exporting = { render: () => story({ acquisition: { ...record, state: 'exporting', solutions: [], progress: { completed: 2, total: 5 } } }) };

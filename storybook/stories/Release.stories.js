import { mountRelease } from '../../web/releases/render.js';
import { releaseView } from '../../web/releases/model.js';
const metadata = required => ({ projectId: '10000000-0000-4000-8000-000000000001', snapshotId: required ? '10000000-0000-4000-8000-000000000002' : '10000000-0000-4000-8000-000000000001', source: null, checksum: (required ? 'a' : 'b').repeat(64), filename: required ? 'new-dev.e365' : 'previous-dev.e365', importedAt: required ? '2026-10-07T09:00:00Z' : '2026-10-06T09:00:00Z', parserVersion: '2.0.0', code: 'example_solution', coverage: 'structural', inventory: [{ path: 'widgets/form.json', sha256: (required ? 'a' : 'b').repeat(64), size: 180 }], report: { status: 'structural', diagnostics: [] }, entities: [{ archivePath: 'widgets/form.json', name: 'Учебная форма договора', fields: [{ code: 'title', required, type: 'STRING' }] }] });
function example(state = 'review') {
  const record = { id: 'synthetic-release', synthetic: true, title: 'Уточнение формы договора', intent: 'Заголовок должен быть заполнен перед отправкой.', targetIntent: 'Учебный оператор TEST', createdAt: '2026-10-07T09:00:00Z', source: metadata(true), baseline: metadata(false), revision: 1, reviews: {}, history: [], limitations: '', notes: '', candidate: null, approval: null };
  if (state === 'missing') record.baseline = null;
  if (state === 'blocked') { record.source.report.diagnostics = [{ path: 'widgets/missing', status: 'missing', reason: 'Объявленный файл отсутствует' }]; record.source.coverage = 'partial'; }
  if (state === 'impact-review') {
    record.title = 'Рецензия необязательного поля и прав';
    record.intent = 'Добавить необязательное примечание и проверить изменение прав доступа.';
    record.source.entities[0].fields = [{ code: 'title', required: false, type: 'STRING' }, { code: 'note', required: false, type: 'STRING' }];
    record.source.inventory.push({ path: 'permissionsSettings/roles.json', sha256: 'c'.repeat(64), size: 24 });
    record.baseline.inventory.push({ path: 'permissionsSettings/roles.json', sha256: 'd'.repeat(64), size: 24 });
    const diagnostic = { path: 'permissionsSettings/manifest.json', status: 'unknown', reason: 'Неизвестный сервис: доступна только общая структура manifest' };
    for (const snapshot of [record.source, record.baseline]) { snapshot.report.diagnostics = [diagnostic]; snapshot.coverage = 'partial'; }
  }
  if (['candidate','prepared','handed-off'].includes(state)) {
    record.reviews['widgets/form.json'] = { decision: 'accepted', reason: 'Проверено обязательное поле', actor: 'Учебный аналитик' };
    record.candidate = { id: 'synthetic-candidate', sha256: record.source.checksum, deployable: false };
  }
  if (['prepared','handed-off'].includes(state)) record.approval = { revision: 1, actor: 'Учебный аналитик', reason: 'Только локальная передача' };
  if (state === 'handed-off') record.handoffAt = '2026-10-07T10:00:00Z';
  return record;
}
function story(state) {
  let record = example(state);
  return mountRelease({ release: releaseView(record), change: async (_id, input) => {
    if (input.action === 'review') record.reviews[input.path] = { decision: input.decision, reason: input.reason };
    else if (input.action === 'details') Object.assign(record, { title: input.title, intent: input.intent, targetIntent: input.targetIntent, limitations: input.limitations, notes: input.notes });
    else if (input.action === 'freeze') record.candidate = { id: 'synthetic-candidate', sha256: record.source.checksum, deployable: false };
    else if (input.action === 'approve') record.approval = { revision: record.revision + 1, reason: input.reason, actor: 'Учебный аналитик' };
    if (!['freeze','approve'].includes(input.action)) record.candidate = null;
    if (input.action !== 'approve') record.approval = null;
    record.revision++; return releaseView(record);
  }, preview: async (_id, archivePath, side) => ({ text: JSON.stringify(archivePath.startsWith('permissionsSettings/') ? { roles: [side === 'source' ? 'writer' : 'reader'] } : { fields: record[side].entities[0].fields }, null, 2), truncated: false }), download: async () => { throw Error('Здесь только синтетический пример; настоящий пакет доступен в приватном сервисе.'); }, open: async () => { throw Error('Синтетический сценарий: выберите другую story в меню.'); } });
}
export default { id: 'release', title: 'Аналитик/Релиз', parameters: { layout: 'fullscreen' } };
export const Review = { render: () => story('review') };
export const ImpactReview = { render: () => story('impact-review') };
export const MissingBaseline = { render: () => story('missing') };
export const Blocked = { render: () => story('blocked') };
export const Candidate = { render: () => story('candidate') };
export const Prepared = { render: () => story('prepared') };
export const HandedOff = { render: () => story('handed-off') };

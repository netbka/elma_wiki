import { managedFixture } from './fixtures.js';
import { releaseView } from '../releases/model.js';

export function solutionHandoffFixture(mode = 'create') {
  const model = managedFixture(), state = model.workspace;
  state.artifacts[0].components = structuredClone(state.current);
  state.changes = []; state.history = [{ type: 'created' }];
  model.view = 'handoff'; model.exportEvidence = { policy: 'accepted-full-export-v1', sha256: 'a'.repeat(64) };
  model.handoffs = [];
  if (mode === 'loading') model.loading = true;
  if (mode === 'load-error') model.error = 'Не удалось получить сохранённые передачи. Повторите загрузку.';
  if (mode === 'blocked') { model.exportEvidence = null; model.handoffReason = 'Примите полный экспорт, содержащий все принятые изменения.'; }
  if (['create', 'blocked', 'loading', 'load-error'].includes(mode)) return model;
  const actor = { id: 'synthetic-reviewer', login: 'reviewer@example.org', provider: 'vk-teams' };
  const inventory = ['package.json', 'widgets/manifest.json', 'widgets/form.json'].map(path => ({ path, sha256: 'a'.repeat(64), size: 160 }));
  const record = { id: 'synthetic-handoff', synthetic: true, title: 'Передача договоров', intent: 'Рассмотреть принятый экспорт', targetIntent: 'Учебный оператор', revision: 1,
    source: { projectId: 'synthetic-project', snapshotId: 'synthetic-snapshot', checksum: 'a'.repeat(64), filename: 'accepted-solution.e365',
      code: 'synthetic_solution', importedAt: '2026-10-08T12:00:00Z', coverage: 'structural', inventory, report: { diagnostics: [] }, entities: [] },
    baseline: null, limitations: 'Прежний пакет не сравнивался; доставка и поведение ELMA не проверялись.', notes: '', reviews: {}, history: [],
    sourceAssociation: { solutionId: state.id, revision: state.revision, artifactId: state.baselineId }, associationStatus: mode === 'stale' ? 'stale' : 'current', candidate: null, approval: null };
  if (mode !== 'review') for (const row of inventory) record.reviews[row.path] = { decision: 'accepted', reason: 'Состав рассмотрен', actor };
  if (['candidate', 'prepared', 'stale', 'lost-response'].includes(mode)) record.candidate = { id: 'synthetic-candidate', sha256: record.source.checksum, deployable: false };
  if (['prepared', 'stale'].includes(mode)) record.approval = { revision: 1, actor, reason: 'Только локальная передача' };
  model.handoff = releaseView(record);
  return model;
}

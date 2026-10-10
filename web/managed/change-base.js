// Pure ViewModel for MR-01 explicit change bases and named component scope.
// The server (#95/#103) stays authoritative: these helpers only project accepted
// state, build the explicit request fields and describe recorded evidence. They
// never infer a base, ancestry or membership from names, uploader or order.
import { componentName } from './model.js';

const short = checksum => typeof checksum === 'string' ? checksum.slice(0, 12) : 'не зафиксирована';

// The same acceptance rule as the store: an explicitly full captured artifact
// whose checksum matches its snapshot and whose acceptance revision is recorded
// (initial full = 0). Pending, partial or unrecorded artifacts are not offered.
export function acceptedFullBases(state) {
  if (!state?.artifacts || !state.history) return [];
  const rows = [];
  for (const artifact of state.artifacts) {
    if (artifact.scope !== 'full' || artifact.scopeDeclaration?.scope !== 'full' || !artifact.checksum || artifact.snapshot?.checksum !== artifact.checksum) continue;
    const revision = state.history.some(row => row.type === 'created' && row.baselineId === artifact.id) ? 0
      : state.history.find(row => row.type === 'baseline-accepted' && row.id === artifact.id)?.revision;
    if (!Number.isSafeInteger(revision)) continue;
    rows.push({ artifactId: artifact.id, revision, checksum: artifact.checksum, current: artifact.id === state.baselineId,
      createdAt: artifact.snapshot.createdAt || null, components: (artifact.components || []).map(row => row.key) });
  }
  return rows.sort((a, b) => b.revision - a.revision);
}

export function baseOptionLabel(base) {
  return `Ревизия ${base.revision}${base.revision === 0 ? ' · исходная версия' : ' · принятое обновление'}${base.current ? ' · текущая' : ' · прежняя'} · SHA-256 ${short(base.checksum)}…`;
}

// Declared evidence is an assertion bound to exact bytes, never verified ancestry.
export function baseEvidence(declaration) {
  if (declaration?.status === 'declared') return { status: 'declared', ancestry: declaration.ancestryVerified === true ? 'verified' : 'declared',
    title: `База заявлена: ревизия ${declaration.revision} · SHA-256 ${short(declaration.checksum)}…`,
    detail: declaration.ancestryVerified === true ? 'Происхождение подтверждено.' : 'Это заявление команды. Происхождение экспорта в ELMA не проверено; автоматическое объединение и сборка не разрешены.' };
  return { status: 'unknown', ancestry: 'unknown',
    title: declaration?.method === 'not-declared' ? 'База не указана — происхождение неизвестно' : 'База не зафиксирована (прежняя загрузка) — происхождение неизвестно',
    detail: 'Сравнение идёт с текущей версией. Неизвестная база не даёт права на автоматическое объединение или сборку.' };
}

export function scopeEvidence(declaration) {
  if (declaration?.status === 'declared') return { status: 'declared', title: `Состав изменения «${declaration.name}»: ${declaration.members.length} объектов`,
    members: declaration.members.map(row => ({ key: row.key, name: componentName(row.key), inBase: !!row.baseDigest, inChange: !!row.incomingDigest })),
    deletions: declaration.deletions || [],
    detail: 'Заявленный состав по точным ключам объектов. Объект состава, отсутствующий в экспорте, остаётся без изменений.' };
  return { status: 'unknown', title: declaration?.method === 'not-declared' ? 'Состав не указан' : 'Состав не зафиксирован (прежняя загрузка)', members: [], deletions: [],
    detail: 'Изменение охватывает объекты загруженного экспорта; отсутствие объекта не означает удаления.' };
}

// Exact component keys are JSON arrays of strings (service, namespace, ...code).
export const exactKey = value => {
  try { const parts = JSON.parse(value); return Array.isArray(parts) && parts.length >= 2 && parts.every(part => typeof part === 'string') && JSON.stringify(parts) === value; }
  catch { return false; }
};

// Candidate members are exact captured keys from the selected base and, when
// replacing a prepared change, from that previous capture. Never from labels.
export function scopeCandidates(base, previousReview) {
  const rows = new Map();
  for (const key of base?.components || []) rows.set(key, { key, name: componentName(key), inBase: true, inPrevious: false });
  for (const row of previousReview?.rows || []) if (row.classification !== 'component-deleted' && exactKey(row.key))
    rows.set(row.key, { ...(rows.get(row.key) || { key: row.key, name: componentName(row.key), inBase: false }), inPrevious: true });
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

// Builds the explicit request fields. Errors are user-facing and leave drafts intact.
export function preparationFields({ partial, bases = [], baseId = '', baseConfirmed = false, scopeEnabled = false, scopeName = '', selected = [], extra = '' }) {
  if (!baseId) return scopeEnabled ? { error: 'Состав изменения требует явно выбранной базы.' } : { fields: {} };
  const base = bases.find(row => row.artifactId === baseId);
  if (!base) return { error: 'Выбранная база больше не входит в принятые полные версии. Обновите состояние и выберите снова.' };
  if (!baseConfirmed) return { error: 'Подтвердите, что экспорт подготовлен от выбранной версии.' };
  const fields = { base: { artifactId: base.artifactId, revision: base.revision, confirmed: true } };
  if (!partial || !scopeEnabled) return { fields };
  const name = scopeName.trim();
  if (!name || name.length > 160) return { error: 'Назовите состав изменения (до 160 символов).' };
  const lines = extra.split('\n').map(line => line.trim()).filter(Boolean), members = [...selected];
  for (const key of lines) {
    if (!exactKey(key)) return { error: `Ключ «${key}» не является точным ключом объекта. Скопируйте его из технических данных.` };
    if (members.includes(key)) return { error: `Ключ ${key} указан дважды. Каждый объект входит в состав один раз.` };
    members.push(key);
  }
  if (!members.length) return { error: 'Выберите хотя бы один объект состава.' };
  // Deletions stay empty here: absence never deletes, and no removal control is offered.
  return { fields: { ...fields, changeScope: { name, members, deletions: [], confirmed: true } } };
}

export const draftKey = (api, id, view, artifact) => ['solution-change-draft', api, id, view, artifact || ''].join(':');

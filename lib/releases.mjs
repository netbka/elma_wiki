import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yazl from 'yazl';
import { readArchive } from './e365.mjs';
import { compareSnapshots } from '../web/releases/comparison.js';
import { releaseView } from '../web/releases/model.js';
export { releaseView } from '../web/releases/model.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const text = (value, label, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Заполните ${label} (до ${max} символов)`); return value.trim(); };
const snapshot = capture => {
  const selected = capture.metadata.snapshots?.find(row => row.id === capture.metadata.currentSnapshotId);
  return { projectId: capture.metadata.id, snapshotId: selected?.id || capture.metadata.id, checksum: capture.metadata.checksum, filename: capture.metadata.filename,
    importedAt: selected?.createdAt || capture.metadata.createdAt, source: selected?.source || null,
    parserRevision: capture.metadata.activeRevision, parserVersion: capture.metadata.parserVersion, code: capture.data.solution?.code, coverage: capture.report.status,
    inventory: capture.inventory, report: capture.report, entities: capture.data.entities.map(({ archivePath, name, code, fields, kind }) => ({ archivePath, name, code, fields, kind })) };
};
export function releaseStore(directory, projects, { now = () => new Date().toISOString(), deliverySummary = null } = {}) {
  const root = path.resolve(directory, 'releases');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const location = id => { if (!uuid.test(id)) fail('Релиз не найден', 404); return path.join(root, id); };
  const read = async (id, owner) => {
    let record;
    try { record = JSON.parse(await fs.readFile(path.join(location(id), 'release.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail('Релиз не найден', 404); throw error; }
    if (record.owner !== owner) fail('Релиз не найден', 404);
    return record;
  };
  const write = async record => {
    const temp = path.join(location(record.id), crypto.randomUUID() + '.tmp');
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temp, path.join(location(record.id), 'release.json'));
  };
  const checkedBytes = async (record, kind = 'source') => {
    const bytes = await fs.readFile(path.join(location(record.id), kind + '.e365'));
    if (hash(bytes) !== record[kind].checksum) fail('Контрольная сумма снимка не совпадает', 409);
    return bytes;
  };
  const validateInputs = input => ({ title: text(input.title, 'название релиза', 160), intent: text(input.intent, 'деловую цель', 4000), targetIntent: text(input.targetIntent, 'назначение передачи', 200) });
  return {
    async authorize(id, owner) { await read(id, owner); },
    async list(owner) {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const records = [];
      for (const id of await fs.readdir(root)) {
        if (!uuid.test(id)) continue;
        try { const record = await read(id, owner); records.push({ id, title: record.title, createdAt: record.createdAt, state: releaseView(record).state }); }
        catch (error) { if (error.statusCode !== 404) throw error; }
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    create(owner, input) { return serial(async () => {
      const labels = validateInputs(input);
      if ((await this.list(owner)).length >= 50) fail('Максимум 50 релизов');
      const source = await projects.snapshot(input.sourceProjectId, owner), baseline = input.baselineProjectId ? await projects.snapshot(input.baselineProjectId, owner) : null;
      const id = crypto.randomUUID(), staging = path.join(root, '.pending-' + id);
      const record = { schemaVersion: 1, id, owner, ...labels, createdAt: now(), revision: 1, source: snapshot(source), baseline: baseline && snapshot(baseline), reviews: {}, limitations: '', notes: '', candidate: null, approval: null, handoffAt: null, history: [] };
      await fs.mkdir(staging, { mode: 0o700 });
      try {
        await fs.writeFile(path.join(staging, 'source.e365'), source.bytes, { mode: 0o600 });
        if (baseline) await fs.writeFile(path.join(staging, 'baseline.e365'), baseline.bytes, { mode: 0o600 });
        await fs.writeFile(path.join(staging, 'release.json'), JSON.stringify(record), { mode: 0o600 });
        await fs.rename(staging, location(id));
      } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
      return releaseView(record);
    }); },
    async get(id, owner) { const record = await read(id, owner); await checkedBytes(record); if (record.baseline) await checkedBytes(record, 'baseline'); return releaseView(record, deliverySummary ? await deliverySummary(id, owner) : null); },
    // Exact approved artifact for the delivery capability: integrity is rechecked on every call.
    async candidateArtifact(id, owner) { const record = await read(id, owner); return { id, revision: record.revision, approval: record.approval, candidate: record.candidate, code: record.source.code, bytes: await checkedBytes(record) }; },
    change(id, owner, input) { return serial(async () => {
      const record = await read(id, owner);
      if (!Number.isInteger(input.revision) || input.revision !== record.revision) fail('Релиз изменился в другой вкладке. Обновите страницу; черновик сохранён в форме.', 409);
      await checkedBytes(record); if (record.baseline) await checkedBytes(record, 'baseline');
      const actor = owner, at = now();
      if (input.action === 'review') {
        if (!compareSnapshots(record.source, record.baseline).some(row => row.path === input.path)) fail('Изменение не найдено');
        if (!['accepted', 'rejected'].includes(input.decision)) fail('Неизвестное решение');
        record.reviews[input.path] = { decision: input.decision, reason: text(input.reason, 'причину решения', 4000), actor, at };
      } else if (input.action === 'details') {
        Object.assign(record, validateInputs(input));
        if (typeof input.limitations !== 'string' || input.limitations.length > 4000 || typeof input.notes !== 'string' || input.notes.length > 4000) fail('Примечания: до 4000 символов');
        record.limitations = input.limitations.trim(); record.notes = input.notes.trim();
      } else if (input.action === 'freeze') {
        if (releaseView(record).blockers.length) fail('Сначала устраните блокирующие замечания', 409);
        record.candidate = { id: crypto.randomUUID(), sha256: record.source.checksum, createdAt: at, provenance: 'unchanged-original', deployable: false };
      } else if (input.action === 'approve') {
        if (!record.candidate || releaseView(record).blockers.length) fail('Сначала подготовьте неизменяемый кандидат и завершите рецензию', 409);
        record.approval = { actor, at, revision: record.revision + 1, candidateId: record.candidate.id, sha256: record.candidate.sha256, scope: 'offline-handoff-only', reason: text(input.reason, 'объяснение принятия', 4000) };
      } else fail('Неизвестное действие');
      if (!['freeze', 'approve'].includes(input.action)) record.candidate = null;
      if (input.action !== 'approve') record.approval = null;
      record.handoffAt = null;
      record.revision++;
      record.history.push({ action: input.action, actor, at, revision: record.revision,
        ...(input.action === 'review' ? { path: input.path, decision: input.decision, reason: input.reason } : {}),
        ...(input.action === 'approve' ? { approval: { ...record.approval }, reason: record.approval.reason } : {}),
        ...(input.action === 'freeze' ? { candidate: { ...record.candidate } } : {}),
        ...(input.action === 'details' ? { conditions: { title: record.title, intent: record.intent, targetIntent: record.targetIntent, limitations: record.limitations, notes: record.notes } } : {}) });
      await write(record); return releaseView(record);
    }); },
    async preview(id, owner, archivePath, side) {
      const record = await read(id, owner);
      if (!['source', 'baseline'].includes(side) || !record[side]) fail('Снимок не найден');
      if (!record[side].inventory.some(row => row.path === archivePath)) fail('Файл не найден');
      const files = await readArchive(await checkedBytes(record, side)), bytes = files.get(archivePath);
      const buffer = bytes.subarray(0, 256 * 1024);
      let content = null;
      try { if (!buffer.includes(0)) content = new TextDecoder('utf8', { fatal: true }).decode(buffer); } catch {}
      return { path: archivePath, side, text: content, size: bytes.length, truncated: bytes.length > buffer.length };
    },
    bundle(id, owner, expectedRevision) { return serial(async () => {
      const record = await read(id, owner);
      if (expectedRevision !== record.revision || record.approval?.revision !== record.revision || !record.candidate || releaseView(record).blockers.length) fail('Передача требует принятия текущего кандидата. Обновите релиз.', 409);
      const bytes = await checkedBytes(record);
      if (record.baseline) await checkedBytes(record, 'baseline');
      const archive = new yazl.ZipFile(), chunks = [];
      archive.addBuffer(bytes, 'candidate.e365');
      const manifest = { schemaVersion: 1, release: releaseView(record), artifact: { file: 'candidate.e365', sha256: hash(bytes), bytes: bytes.length }, deploymentAuthorized: false, verified: false };
      archive.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
      archive.addBuffer(Buffer.from(`${record.title}\n\n${record.intent}\n\nПримечания: ${record.notes || 'Нет'}\nОграничения: ${record.limitations || 'См. проверки в manifest.json'}\n\nНазначение передачи: ${record.targetIntent} (личность Target не проверена).\n\nПередача не разрешает импорт. Оператор отдельно проверяет зависимости, совместимость, права, native update/preserve настройки и свежесть Target.\nНеизменяемый candidate.e365 должен иметь SHA-256 ${record.source.checksum}.\nПосле разрешённого импорта нужен read-back и сравнение ожидаемого результата. Успех CLI не означает Verified.\nПакет не является гарантированным откатом данных или экземпляров процессов.\n`), 'handoff.txt');
      const done = new Promise((resolve, reject) => { archive.outputStream.on('data', chunk => chunks.push(chunk)); archive.outputStream.on('end', () => resolve(Buffer.concat(chunks))); archive.outputStream.on('error', reject); });
      archive.end(); const bundle = await done;
      record.handoffAt = now(); record.history.push({ action: 'handoff', actor: owner, at: record.handoffAt, revision: record.revision });
      await write(record); return bundle;
    }); }
  };
}

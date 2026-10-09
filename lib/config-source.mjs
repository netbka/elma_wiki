import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readConfiguration, limits } from './e365.mjs';
import { parseProject } from './project-parser.mjs';
import { actorIdentity } from './actors.mjs';
import { SOLUTION_CATALOG } from './solutions.mjs';
import { dependencyReport, readDependencyCatalog } from './dependency-evidence.mjs';

const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const uuid = /^[a-f0-9-]{36}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function configSourceClient({ url, token, fetcher = fetch } = {}) {
  if (!url && !token) return null;
  if (!url || !token) throw Error('Configure both CONFIG_SOURCE_API_URL and CONFIG_SOURCE_API_TOKEN');
  const base = new URL(url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw Error('Invalid configured Source API URL');
  const request = async (route, input, binary = false) => {
    let response;
    try { response = await fetcher(base.toString().replace(/\/$/, '') + route, { method: input ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      body: input ? JSON.stringify(input) : undefined, redirect: 'error', signal: AbortSignal.timeout(120000) }); }
    catch { fail('Источник недоступен. Проверьте соединение.', 502); }
    if (!response.ok) fail(response.status === 409 ? 'Другой экспорт ещё выполняется.' : 'Не удалось получить конфигурацию из источника.', response.status === 409 ? 409 : 502);
    const max = binary ? limits.upload : 1024 * 1024;
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > max) { await response.body.cancel?.().catch(() => {}); fail('Ответ источника превышает лимит', 413); } chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    return binary ? bytes : JSON.parse(bytes.toString('utf8'));
  };
  return { servers: () => request('/v1/servers'), catalog: server => request('/v1/servers/' + server + '/solutions'),
    start: input => request('/v1/exports', input), status: id => request('/v1/exports/' + id), artifact: id => request('/v1/exports/' + id + '/artifact', undefined, true) };
}
export function configAcquisitions(directory, uploads, client) {
  const root = path.resolve(directory, 'config-acquisitions');
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const location = id => { if (!uuid.test(id || '')) fail('Загрузка не найдена', 404); return path.join(root, id); };
  const read = async id => { try { return JSON.parse(await fs.readFile(path.join(location(id), 'record.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') fail('Загрузка не найдена', 404); throw e; } };
  const save = async record => { const dir = location(record.id); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, crypto.randomUUID() + '.tmp'); await fs.writeFile(tmp, JSON.stringify(record), { mode: 0o600 }); await fs.rename(tmp, path.join(dir, 'record.json')); };
  const expose = ({ remoteId, ...record }) => record;
  const ingest = async (record, bytes, actor, sourceServer, remoteEvidence) => {
    const config = await readConfiguration(bytes);
    // Parse every member before admitting any, so a malformed last member cannot look successful.
    const parsedMembers = [];
    for (const solution of config.solutions) parsedMembers.push(await parseProject(solution.bytes));
    await fs.writeFile(path.join(location(record.id), 'original.e365'), bytes, { mode: 0o600, flag: 'wx' });
    record.sha256 = digest(bytes); record.format = config.format; record.exclusions = config.exclusions; record.solutions = [];
    record.dependencyCatalog = config.dependencyCatalog ?? readDependencyCatalog(remoteEvidence);
    const components = parsedMembers.flatMap(member => member.data.entities.map(entity => ({ ...entity, solution: member.data.solution.code })));
    for (const [index, solution] of config.solutions.entries()) {
      const project = sourceServer ? await uploads.createSource(SOLUTION_CATALOG, solution.bytes,
        { connectionId: 'config-api-' + sourceServer, solutionRef: solution.code }, solution.code + '.e365', actor) :
        await uploads.create(SOLUTION_CATALOG, solution.bytes, solution.code + '.e365', actor);
      const parsed = parsedMembers[index];
      record.solutions.push({ code: solution.code, project, sourceAvailability: parsed.data.solution.status === 'opaque' ? 'opaque' : 'readable',
        acceptance: parsed.data.solution.status === 'opaque' ? 'encrypted-source-unavailable' : 'component-review-required',
        dependencies: dependencyReport(parsed.data.solution.dependencies, { catalog: record.dependencyCatalog, components,
          provenance: sourceServer ? 'configured-source-capture' : 'manual-upload' }) }); await save(record);
    }
    record.state = 'ready'; await save(record); return expose(record);
  };
  return {
    async list() { await fs.mkdir(root, { recursive: true, mode: 0o700 }); const records = [];
      for (const id of await fs.readdir(root)) if (uuid.test(id)) records.push(expose(await read(id)));
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100); },
    async servers() { return client ? client.servers() : { servers: [], configured: false }; },
    async catalog(server) { if (!['dev', 'dev2'].includes(server)) fail('Выберите DEV или dev2'); if (!client) fail('Источник не настроен', 503); return client.catalog(server); },
    upload(bytes, actor) { return serial(async () => {
      const record = { id: crypto.randomUUID(), state: 'parsing', createdAt: new Date().toISOString(), actor: actorIdentity(actor) }; await save(record);
      try { return await ingest(record, bytes, actor); }
      catch (error) { record.state = 'failed'; record.error = 'Не удалось разобрать весь файл. Сохранённые решения перечислены отдельно.'; await save(record); error.acquisitionId = record.id; throw error; }
    }); },
    start(input, actor) { return serial(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['server', 'solution'].includes(key)) ||
          !['dev', 'dev2'].includes(input.server) || input.solution !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(input.solution)) fail('Выберите источник и решение');
      if (!client) fail('Источник не настроен', 503);
      const remote = await client.start(input); if (!uuid.test(remote.id || '')) fail('Некорректный ответ источника', 502);
      const record = { id: crypto.randomUUID(), remoteId: remote.id, server: input.server, solution: input.solution, state: 'exporting', createdAt: new Date().toISOString(), actor: actorIdentity(actor) };
      await save(record); return expose(record);
    }); },
    get(id) { return serial(async () => {
      const record = await read(id);
      if (record.state === 'parsing') { record.state = 'failed'; record.error = 'Сохранение было прервано. Уже сохранённые решения перечислены отдельно.'; await save(record); }
      if (record.state !== 'exporting') return expose(record);
      if (!client) fail('Источник не настроен', 503);
      const remote = await client.status(record.remoteId);
      if (remote.progress) record.progress = remote.progress;
      if (remote.state === 'failed') { record.state = 'failed'; record.error = 'Экспорт не завершён. Начните новую загрузку.'; await save(record); }
      if (remote.state === 'ready') {
        const bytes = await client.artifact(record.remoteId);
        if (bytes.length !== remote.result?.bytes || digest(bytes) !== remote.result?.sha256) fail('Контрольная сумма источника не совпадает', 502);
        // Server identity comes from the selected API operation, never uploaded metadata.
        const config = await readConfiguration(bytes);
        if (record.solution && (config.solutions.length !== 1 || config.solutions[0].code !== record.solution)) fail('Источник вернул другое решение', 502);
        record.state = 'parsing'; await save(record);
        try { return await ingest(record, bytes, record.actor, record.server, remote.result?.dependencyEvidence); }
        catch { record.state = 'failed'; record.error = 'Не удалось сохранить весь экспорт. Сохранённые решения перечислены отдельно.'; await save(record); }
      }
      return expose(record);
    }); },
    async original(id) { const record = await read(id); if (record.state !== 'ready') fail('Конфигурация ещё не готова', 409);
      const bytes = await fs.readFile(path.join(location(id), 'original.e365')); if (digest(bytes) !== record.sha256) fail('Контрольная сумма конфигурации не совпадает', 409); return bytes; }
  };
}

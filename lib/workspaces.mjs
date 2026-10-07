import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkSources, generateTypes } from './workspace-check.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(Error(message), {status}); };
const maxSource = 256 * 1024;
export function workspaceStore(projects) {
  const transaction = (id, owner, objectId, operation) => projects.workspaceTransaction(id, owner, async (directory, project) => {
    const data = await projects.read(id, owner), entity = data.entities.find(e => e.id === objectId);
    if (!entity || entity.service !== 'widgets' || entity.kind !== 'WIDGET' || entity.coverage !== 'structural') fail('Для этого объекта редактор скриптов не поддерживается', 422);
    const inventory = await projects.read(id, owner, 'inventory');
    const artifact = async archivePath => {
      const row = inventory.find(r => r.path === archivePath);
      if (!row || row.size > maxSource) fail('Исходник отсутствует или превышает 256 КБ', 422);
      const bytes = await fs.readFile(path.join(directory, 'objects', row.sha256));
      if (hash(bytes) !== row.sha256) fail('Контрольная сумма исходника не совпадает', 422);
      try { return new TextDecoder('utf8', {fatal:true}).decode(bytes).replace(/^\uFEFF/, ''); }
      catch { fail('Исходник не является текстом UTF-8', 422); }
    };
    const raw = JSON.parse(await artifact(entity.archivePath));
    if (!raw.descriptor || typeof raw.descriptor !== 'object' || Array.isArray(raw.descriptor)) fail('Схема скриптов не поддерживается', 422);
    const sources = {}, origins = {};
    for (const side of ['client', 'server']) {
      const filename = side + '.ts', sidePath = entity.archivePath + '.' + side + '.ts';
      if (inventory.some(r => r.path === sidePath)) { sources[filename] = await artifact(sidePath); origins[filename] = sidePath; }
      else if (typeof raw.descriptor[side + 'Scripts'] === 'string') { sources[filename] = raw.descriptor[side + 'Scripts']; origins[filename] = entity.archivePath + '#/descriptor/' + side + 'Scripts'; }
      else if (raw.descriptor[side + 'Scripts'] != null) fail('Неизвестная схема скрипта', 422);
    }
    if (!Object.keys(sources).length || Object.values(sources).some(s => Buffer.byteLength(s) > maxSource)) fail('Поддержанные скрипты отсутствуют или превышают лимит', 422);
    const key = hash(entity.provenance.identity + '\n' + entity.archivePath), dest = path.join(directory, 'workspaces', key);
    let state;
    try { state = JSON.parse(await fs.readFile(path.join(dest, 'state.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    state ||= {revision:0, sourceChecksum:project.checksum, files:sources, checkpoints:[], history:[], check:null};
    if (state.sourceChecksum !== project.checksum) fail('Изменился исходный snapshot', 409);
    const persist = async next => {
      await fs.mkdir(dest, {recursive:true, mode:0o700});
      const temp = path.join(dest, crypto.randomUUID() + '.tmp');
      try { await fs.writeFile(temp, JSON.stringify(next), {mode:0o600, flag:'wx'}); await fs.rename(temp, path.join(dest, 'state.json')); }
      catch (e) { await fs.unlink(temp).catch(() => {}); throw e; }
    };
    const view = next => ({object:{id:entity.id,name:entity.name,code:entity.code,archivePath:entity.archivePath}, revision:next.revision, sourceChecksum:next.sourceChecksum,
      files:next.files, original:sources, origins, types:generateTypes(raw, next.files), check:next.check,
      checkpoints:next.checkpoints.map(({files,...c}) => c), history:next.history.map(({files,...c}) => c),
      capabilities:{edit:true,typescript:true,elmaCompiler:false,build:false,deploy:false},
      limitations:['Типы полей выведены из descriptor; внешние ELMA API и зависимости не проверены.', 'Проверка TypeScript не заменяет ELMA compiler. Сборка и публикация недоступны.']});
    return operation({state, sources, raw, persist, view});
  });
  const expected = (state, revision) => { if (!Number.isInteger(revision) || state.revision !== revision) fail('Конфликт сохранения: рабочая копия уже изменена. Сравните локальный текст с актуальной копией.', 409); };
  const validateFiles = (files, sources) => {
    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).sort().join() !== Object.keys(sources).sort().join()) fail('Можно менять только существующие client.ts/server.ts');
    for (const value of Object.values(files)) if (typeof value !== 'string' || Buffer.byteLength(value) > maxSource || value.includes('\0')) fail('Скрипт должен быть текстом до 256 КБ');
  };
  const changed = (state, files) => ({...state, revision:state.revision+1, files, check:null,
    history:[...state.history, {id:crypto.randomUUID(), label:'Автосохранение ' + state.revision, revision:state.revision, createdAt:new Date().toISOString(), files:state.files}].slice(-10)});
  return {
    read: (id, owner, object) => transaction(id, owner, object, async ({state,view}) => view(state)),
    save: (id, owner, object, payload) => transaction(id, owner, object, async ({state,sources,persist,view}) => {
      expected(state,payload.revision); validateFiles(payload.files,sources);
      const same = Object.keys(sources).every(k => state.files[k] === payload.files[k]);
      const next = same ? state : changed(state,payload.files); if (!same) await persist(next); return view(next);
    }),
    checkpoint: (id, owner, object, payload) => transaction(id, owner, object, async ({state,persist,view}) => {
      expected(state,payload.revision);
      if (typeof payload.label !== 'string' || !payload.label.trim() || payload.label.length > 100 || state.checkpoints.length >= 20) fail('Имя контрольной точки: 1–100 символов; максимум 20 точек');
      const next = {...state, revision:state.revision+1, check:null, checkpoints:[...state.checkpoints,{id:crypto.randomUUID(),label:payload.label.trim(),revision:state.revision,createdAt:new Date().toISOString(),files:state.files}]};
      await persist(next); return view(next);
    }),
    restore: (id, owner, object, payload) => transaction(id, owner, object, async ({state,sources,persist,view}) => {
      expected(state,payload.revision);
      const files = payload.checkpoint === 'original' ? sources : [...state.checkpoints,...state.history].find(c => c.id === payload.checkpoint)?.files;
      if (!files) fail('Контрольная точка не найдена',404);
      const next = changed(state,files); await persist(next); return view(next);
    }),
    async check(id, owner, object, payload) {
      const snapshot = await transaction(id,owner,object,async ({state,raw}) => { expected(state,payload.revision); return {revision:state.revision,files:state.files,raw}; });
      const result = await checkSources(snapshot.raw,snapshot.files);
      return transaction(id,owner,object,async ({state,persist,view}) => {
        expected(state,snapshot.revision);
        const next = {...state,check:{...result,revision:state.revision,sourceHash:hash(JSON.stringify(state.files)),checkedAt:new Date().toISOString()}};
        await persist(next); return view(next);
      });
    }
  };
}

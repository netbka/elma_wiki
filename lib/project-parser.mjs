import crypto from 'node:crypto';
import { readArchive, interpretFiles } from './e365.mjs';
export const parserVersion = '2.0.0';
const knownServices = new Set(['appViews', 'widgets', 'processor', 'settings', 'permissions']);
const pointer = value => value.replaceAll('~','~0').replaceAll('/','~1');
export async function parseProject(buffer) {
  const files = await readArchive(buffer), diagnostics = [], indexed = new Set(), parts = [];
  const add = (path, status, reason, jsonPointer) => diagnostics.push({ path, status, reason, ...(jsonPointer ? { pointer: jsonPointer } : {}), parserVersion });
  const read = path => {
    if (!files.has(path)) { add(path, 'missing', 'Файл объявлен, но отсутствует в архиве'); return null; }
    try { return JSON.parse(files.get(path).toString('utf8').replace(/^\uFEFF/, '')); }
    catch { add(path, 'malformed', 'Некорректный JSON; оригинальные байты сохранены'); return null; }
  };
  const manifests = [...files.keys()].filter(p => /^[^/]+\/manifest\.json$/.test(p));
  if (!files.has('package.json') && !manifests.length && !files.has('data')) throw Error('В архиве нет признаков конфигурации .e365');
  const rawPackage = read('package.json'), pkg = rawPackage && !Array.isArray(rawPackage) && typeof rawPackage === 'object' ? rawPackage : {};
  if (rawPackage !== null && (Array.isArray(rawPackage) || typeof rawPackage !== 'object')) add('package.json', 'unknown', 'Неизвестная схема package.json');
  indexed.add('package.json');
  const codeValid = typeof pkg.code === 'string' && /^[\w.-]+$/.test(pkg.code) && !['.', '..'].includes(pkg.code);
  if (!codeValid) add('package.json', 'unknown', 'Код решения не определён', '/code');
  const safePackage = { ...pkg, code: codeValid ? pkg.code : 'unidentified' };
  const packageKeys = new Set(['code','title','type','solution','serverVersion','dependencies','internalDependencies','optionalDependencies','sysDependencies']);
  for (const key of Object.keys(pkg)) if (!packageKeys.has(key)) add('package.json','unindexed','Свойство пакета сохранено без интерпретации','/'+pointer(key));
  for (const category of ['dependencies','internalDependencies','optionalDependencies','sysDependencies']) {
    if (!pkg[category]) continue;
    if (typeof pkg[category] !== 'object' || Array.isArray(pkg[category])) { add('package.json','unknown','Неизвестная схема зависимостей','/'+category); continue; }
    for (const [service,records] of Object.entries(pkg[category])) if (!Array.isArray(records)) add('package.json','unknown','Записи зависимостей не являются массивом','/'+category+'/'+pointer(service));
  }
  const code = safePackage.code, safePackageBuffer = Buffer.from(JSON.stringify(safePackage));
  if (!manifests.length && !files.has('data')) add('package.json','unknown','Манифесты сервисов отсутствуют; состав решения не определён');
  for (const manifestPath of manifests) {
    const service = manifestPath.split('/')[0], manifest = read(manifestPath);
    indexed.add(manifestPath);
    if (!knownServices.has(service)) add(manifestPath, 'unknown', 'Неизвестный сервис: доступна только общая структура manifest');
    if (!manifest || !Array.isArray(manifest.entities)) { if (manifest) add(manifestPath, 'unknown', 'Неизвестная схема manifest: нет массива entities'); continue; }
    for (let i = 0; i < manifest.entities.length; i++) {
      const entity = manifest.entities[i];
      if (!entity || typeof entity !== 'object' || typeof entity.path !== 'string') { add(manifestPath, 'unknown', 'Некорректная запись сущности', `/entities/${i}`); continue; }
      const original = service + '/' + entity.path.replaceAll('\\','/').replace(/^\/+/, '');
      // Archive paths are validated by readArchive; manifest references are not filesystem paths.
      if (original.split('/').some(p => p === '..' || p === '.' || !p || p.includes(':'))) { add(manifestPath, 'unknown', 'Недопустимая ссылка в manifest', `/entities/${i}/path`); continue; }
      const raw = read(original); if (raw === null) { if (files.get(original)?.toString().trim() === 'null') add(original,'unknown','JSON null не описывает сущность'); continue; }
      if (typeof raw !== 'object') { add(original,'unknown','Неизвестная схема сущности: ожидается объект или массив настроек'); continue; }
      const subset = new Map([['package.json', safePackageBuffer], [original, files.get(original)]]);
      for (const suffix of ['.client.ts','.server.ts']) if (files.has(original + suffix)) subset.set(original + suffix,files.get(original + suffix));
      subset.set(manifestPath, Buffer.from(JSON.stringify({ entities: [{ ...entity, resources: [] }] })));
      try {
        const result = interpretFiles(subset, 'file');
        for (const e of result.entities) {
          e.id = 'object-' + parts.length; e.archivePath = original; e.provenance = { identity: `${manifestPath}#/entities/${i}`, source: original };
          const fieldOrigin = Array.isArray(raw) ? '' : raw.fields ? 'fields' : raw.context ? 'context' : 'descriptor/fields';
          const fieldList = Array.isArray(raw) ? raw : raw.fields || raw.context || raw.descriptor?.fields;
          const fieldIndices = Array.isArray(fieldList) ? fieldList.flatMap((f,n) => f && typeof f === 'object' ? [n] : []) : [];
          e.fields.forEach((f,n) => { f.origin=fieldOrigin ? fieldOrigin.replaceAll('/','.') : 'settings[]'; f.source=`${original}#/${fieldOrigin ? fieldOrigin+'/' : ''}${fieldIndices[n] ?? n}`; });
          if (fieldList && !Array.isArray(fieldList)) add(original,'unknown','Схема полей не является массивом','/'+fieldOrigin);
          e.functionSources.forEach(f => { f.path = f.side === 'process' ? original + '#/scripts' : files.has(original + '.' + f.side + '.ts') ? original + '.' + f.side + '.ts' : original + '#/descriptor/' + f.side + 'Scripts'; });
          e.source = original; e.file = original; e.scripts = [...new Set(e.functionSources.map(f => f.path))]; delete e.workspace; delete e.server; delete e.recommendedFile;
          if (!knownServices.has(service)) { e.coverage = 'unknown'; e.fields = []; e.fieldCount = 0; e.functions = []; e.functionSources = []; e.variableUsage = {}; e.lifecycle = {}; }
          else e.coverage = 'structural';
          parts.push(e);
        }
        indexed.add(original);
        for (const suffix of ['.client.ts','.server.ts']) if (files.has(original + suffix)) indexed.add(original + suffix);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const supported = new Set(['id','code','name','namespace','kind','type','fields','context','descriptor','scripts','dataNamespace','dataCode','history','version']);
          for (const key of Object.keys(raw)) if (!supported.has(key)) add(original, 'unindexed', 'Свойство сохранено, но не интерпретируется', '/' + pointer(key));
          for (const key of Object.keys(raw.descriptor || {})) if (!['fields','clientScripts','serverScripts','template'].includes(key)) add(original,'unindexed','Фрагмент descriptor сохранён без интерпретации','/descriptor/'+pointer(key));
          if (raw.descriptor?.template) add(original,'unindexed','Из template прочитаны только поддерживаемые привязки; полный шаблон сохранён','/descriptor/template');
          const fieldSource = raw.fields || raw.context || raw.descriptor?.fields;
          if (Array.isArray(fieldSource)) for (let n=0;n<fieldSource.length;n++) {
            const field=fieldSource[n];
            if (!field || typeof field !== 'object' || Array.isArray(field)) { add(original,'unknown','Неизвестная схема поля',`/${raw.fields ? 'fields' : raw.context ? 'context' : 'descriptor/fields'}/${n}`); continue; }
            for (const key of Object.keys(field)) if (!['code','name','type','array','required','readonly','view','calcByFormula','data'].includes(key)) add(original,'unindexed','Значение поля сохранено без интерпретации',`/${raw.fields ? 'fields' : raw.context ? 'context' : 'descriptor/fields'}/${n}/${pointer(key)}`);
          }
        }
      } catch { add(original, 'unknown', 'Структура сущности не поддерживается этой версией парсера'); }
      for (const resource of Array.isArray(entity.resources) ? entity.resources : []) {
        const path = service + '/' + String(resource?.path || '').replaceAll('\\','/').replace(/^\/+/, '');
        if (!files.has(path)) add(path, 'missing', 'Ресурс объявлен, но отсутствует');
      }
    }
  }
  if (files.has('data')) { add('data','opaque','Непрозрачный контейнер: сохранён без расшифровки'); indexed.add('data'); }
  for (const [path] of files) if (!indexed.has(path)) add(path,'unindexed','Файл сохранён, но не проиндексирован');
  const inventory = [...files].map(([path, content]) => ({ path, sha256: crypto.createHash('sha256').update(content).digest('hex'), size: content.length, indexed: indexed.has(path) }));
  const value = (key, value) => ({ value: value === undefined ? null : value, source: 'package.json#/' + key, status: value === undefined ? 'unknown' : 'found' });
  const provenance = {
    code: value('code', codeValid ? pkg.code : undefined), serverVersion: value('serverVersion', typeof pkg.serverVersion === 'string' ? pkg.serverVersion : undefined),
    isAuthor: value('solution/isAuthor', typeof pkg.solution?.isAuthor === 'boolean' ? pkg.solution.isAuthor : undefined)
  };
  // Resolve only within this one archive. No lookup in other projects or legacy portals.
  let solution;
  try { const seed = new Map([['package.json', safePackageBuffer], ['data', Buffer.alloc(0)]]); solution = interpretFiles(seed,'file').solution; }
  catch { solution = { code, name: code, dependencies: [] }; }
  solution.entities = parts.length; solution.modules = [...new Set(parts.map(e => e.module))];
  if (!codeValid) { solution.code = null; solution.name = 'Код решения не определён'; parts.forEach(e => e.solution = null); }
  for (const d of solution.dependencies || []) {
    const matches = parts.filter(e => e.service === d.service && e.namespace === d.targetNamespace && (!d.targetCode || e.code === d.targetCode));
    if (d.status !== 'unknown-schema') d.status = !d.targetCode ? 'unverified' : matches.length ? 'present-in-file' : 'external-unverified';
    d.provenance = `package.json#/${d.category}`;
  }
  const status = diagnostics.some(d => d.status === 'opaque') && !parts.length ? 'opaque' : diagnostics.length ? 'partial' : 'structural';
  solution.status = status; delete solution.reason; delete solution.warnings;
  const counts = Object.fromEntries([...new Set(diagnostics.map(d => d.status))].map(status => [status, diagnostics.filter(d => d.status === status).length]));
  const report = { parserVersion, status, counts, indexedEntities: parts.length, files: files.size, diagnostics };
  return { files, data: { parserVersion, solution, entities: parts, provenance, coverage: status, diagnosticCount: diagnostics.length, inventory }, report, inventory };
}

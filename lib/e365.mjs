import yauzl from 'yauzl';
import crypto from 'node:crypto';

export const limits = { upload: 128 * 1024 * 1024, entry: 64 * 1024 * 1024, expanded: 512 * 1024 * 1024, entries: 25000 };
const text = value => typeof value === 'string' ? value.slice(0, 512) : undefined;
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const count = values => Object.fromEntries([...new Set(values)].map(v => [v, values.filter(x => x === v).length]));
const crcTable = Array.from({length:256},(_,n) => { for(let i=0;i<8;i++) n=n&1 ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
const crc32 = bytes => { let crc=0xffffffff; for(const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; };
export function safePath(name) {
  const p = name.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!p || p.split('/').some(x => !x || x === '.' || x === '..' || x.includes(':') || /[\x00-\x1f]/.test(x))) throw Error('Недопустимый путь внутри архива');
  return p;
}
export function serverKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key)) throw Error('Код окружения: латиница, цифры, дефис и подчёркивание, до 64 символов');
  return key;
}
async function unzip(buffer, budget) {
  return new Promise((resolve, reject) => {
    // ELMA exports may use a leading slash; validate normalized names ourselves.
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(Error('Файл не является читаемым ZIP/.e365'));
      const files = new Map(); let finished = false;
      const fail = () => { if (finished) return; finished = true; zip.close(); reject(Error('Архив повреждён, зашифрован или превышает ограничения распаковки')); };
      zip.on('error', fail);
      zip.on('end', () => { if (!finished) { finished = true; resolve(files); } });
      zip.on('entry', entry => {
        try {
          if (++budget.entries > limits.entries) throw Error();
          const raw = entry.fileName.toString('utf8');
          const directory = /[\\/]$/.test(raw);
          const name = safePath(directory ? raw.slice(0, -1) : raw);
          if (files.has(name)) throw Error();
          if ((entry.generalPurposeBitFlag & 1) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw Error();
          if (directory) { zip.readEntry(); return; }
          if (entry.uncompressedSize > limits.entry || budget.bytes + entry.uncompressedSize > limits.expanded) throw Error();
          zip.openReadStream(entry, (err, stream) => {
            if (err) return fail();
            let size = 0; const chunks = [];
            stream.on('error', fail);
            stream.on('data', chunk => {
              size += chunk.length; budget.bytes += chunk.length;
              if (size > limits.entry || budget.bytes > limits.expanded) { stream.destroy(); fail(); return; }
              chunks.push(chunk);
            });
            stream.on('end', () => { if (!finished) { const bytes=Buffer.concat(chunks); if(crc32(bytes)!==entry.crc32) return fail(); files.set(name, bytes); zip.readEntry(); } });
          });
        } catch { fail(); }
      });
      zip.readEntry();
    });
  });
}
function json(files, name) {
  if (!files.has(name)) throw Error('В архиве отсутствует обязательный JSON-файл');
  try { return JSON.parse(files.get(name).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('Некорректный JSON в конфигурации'); }
}
function fields(raw, origin) {
  return list(Array.isArray(raw) ? raw : obj(raw).fields).filter(f => f && typeof f === 'object').map(f => ({
    code: text(f.code), name: text(obj(f.view).name) || text(f.name) || text(f.code), type: text(f.type),
    array: !!f.array, required: !!f.required, readonly: !!f.readonly, hidden: !!obj(f.view).hidden, formula: !!f.calcByFormula,
    references: ['namespace', 'ns', 'code', 'app', 'applicationCode', 'collection', 'collectionCode', 'type'].flatMap(key => typeof obj(f.data)[key] === 'string' ? [{ key, value: text(f.data[key]) }] : []), origin
  }));
}
// Exclude comments and literal values before the heuristic identifier scan.
// Template expressions are intentionally excluded along with template literals.
const identifiersOnly = script => script.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, ' ');
const functionNames = script => [...new Set([...identifiersOnly(script).matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))].sort();
function dependencies(pkg) {
  const result = [];
  for (const category of ['dependencies', 'internalDependencies', 'optionalDependencies', 'sysDependencies']) {
    if (pkg[category] && (typeof pkg[category] !== 'object' || Array.isArray(pkg[category]))) {
      result.push({ category, service: '', status: 'unknown-schema', source: {} }); continue;
    }
    for (const [service, records] of Object.entries(obj(pkg[category]))) {
      for (const record of list(records)) {
        const d = obj(record), target = obj(d.dependsOn || d.data), source = obj(d.entity);
        result.push({ category, service: text(target.service) || service, targetNamespace: text(target.namespace) || text(d.namespace), targetCode: text(target.code), ownerCode: text(d.code), status: 'unresolved', source: Object.fromEntries(['namespace', 'code', 'service'].map(k => [k, text(source[k])])) });
      }
    }
  }
  return result;
}
export async function interpret(buffer, environment) {
  serverKey(environment);
  return interpretFiles(await readArchive(buffer), environment);
}
export async function readArchive(buffer) {
  if (!buffer.length || buffer.length > limits.upload) throw Error('Размер .e365 должен быть от 1 байта до 128 МБ');
  const budget = { entries: 0, bytes: 0 }, outer = await unzip(buffer, budget), files = new Map();
  for (const [name, value] of outer) {
    if (name.endsWith('.zip')) {
      const prefix = name.slice(0, -4);
      for (const [child, content] of await unzip(value, budget)) {
        const target = prefix + '/' + child;
        if (files.has(target)) throw Error('Повторяющийся путь сервиса');
        files.set(target, content);
      }
    } else {
      if (files.has(name)) throw Error('Повторяющийся путь сервиса');
      files.set(name, value);
    }
  }
  return files;
}
// Inspection containers preserve solution boundaries, never flatten packages.
export async function readConfiguration(buffer) {
  if (!buffer.length || buffer.length > limits.upload) throw Error('Configuration exceeds upload limit');
  const outer = await unzip(buffer, { entries: 0, bytes: 0 });
  if (!outer.has('config-bundle.json')) {
    const files = await readArchive(buffer), pkg = json(files, 'package.json');
    if (typeof pkg.code !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(pkg.code)) throw Error('Invalid solution code');
    return { format: 'native-e365', solutions: [{ code: pkg.code, bytes: buffer }], exclusions: [] };
  }
  const manifest = json(outer, 'config-bundle.json');
  if (manifest.format !== 'elma-config-bundle' || manifest.schemaVersion !== 1 || manifest.deployable !== false ||
      !Array.isArray(manifest.solutions) || manifest.solutions.length > 100) throw Error('Unsupported configuration bundle');
  const codes = new Set(), used = new Set(['config-bundle.json']), solutions = [], exclusions = [];
  let expanded = buffer.length, entries = outer.size;
  for (const row of manifest.solutions) {
    if (!row || typeof row.code !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(row.code) || codes.has(row.code)) throw Error('Invalid or duplicate solution');
    codes.add(row.code);
    if (['excluded-paid', 'export-failed', 'pack-failed'].includes(row.status)) { exclusions.push({ code: row.code, status: row.status }); continue; }
    const name = 'solutions/' + row.code + '.e365', bytes = outer.get(name);
    if (row.status !== 'exported' || row.path !== name || !bytes || row.bytes !== bytes.length ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw Error('Bundle member checksum mismatch');
    const files = await readArchive(bytes);
    expanded += [...files.values()].reduce((sum, value) => sum + value.length, 0); entries += files.size;
    if (expanded > limits.expanded || entries > limits.entries || json(files, 'package.json').code !== row.code) throw Error('Invalid bundle solution or extraction limit');
    used.add(name); solutions.push({ code: row.code, bytes });
  }
  if ([...outer.keys()].some(name => !used.has(name)) || !solutions.length) throw Error('Unlisted or empty configuration bundle');
  return { format: manifest.format, solutions, exclusions };
}
export function interpretFiles(files, environment) {
  serverKey(environment);
  if (!(files instanceof Map) || files.size > limits.entries) throw Error('Некорректный набор файлов конфигурации');
  let total = 0;
  for (const [name, value] of files) {
    if (safePath(name) !== name || !Buffer.isBuffer(value) || value.length > limits.entry) throw Error('Некорректный файл конфигурации');
    total += value.length;
  }
  if (total > limits.expanded) throw Error('Конфигурация превышает ограничение распаковки');
  const pkg = obj(json(files, 'package.json')), code = text(pkg.code);
  if (!code || !/^[\w.-]+$/.test(code) || ['.', '..'].includes(code)) throw Error('В package.json нет корректного code решения');
  const manifests = [...files.keys()].filter(p => /^[^/]+\/manifest\.json$/.test(p));
  const opaque = !manifests.length && files.has('data');
  if (!manifests.length && !opaque) throw Error('В .e365 не найдены манифесты сервисов или непрозрачный контейнер data');
  const entities = [], warnings = [], modules = new Set();
  const workspace = `server-configs/${environment}/workspaces/${code}`;
  for (const manifestPath of manifests) {
    const service = manifestPath.split('/')[0], manifest = obj(json(files, manifestPath));
    if (!Array.isArray(manifest.entities)) throw Error('Манифест сервиса не содержит массив entities');
    for (const record of manifest.entities) {
      const e = obj(record), namespace = text(e.namespace) || '', module = namespace.split('.')[0] || '_shared';
      if (!/^[\w.-]+$/.test(module) || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(module)) throw Error('Недопустимое имя модуля');
      const source = `${service}/${safePath(String(e.path || ''))}`, file = module === '_shared' ? `shared/${source}` : `modules/${module}/services/${source}`;
      const raw = json(files, source), o = obj(raw), descriptor = obj(o.descriptor), texts = [], scripts = [], functionSources = [];
      for (const [side, key] of [['client', 'clientScripts'], ['server', 'serverScripts']]) {
        const sidePath = source + `.${side}.ts`, value = files.has(sidePath) ? files.get(sidePath).toString('utf8') : descriptor[key];
        if (typeof value !== 'string') continue;
        const path = file + `.${side}.ts`; texts.push(value); scripts.push(path);
        functionSources.push(...functionNames(value).map(name => ({ name, path, side })));
      }
      if (typeof o.scripts === 'string') { texts.push(o.scripts); functionSources.push(...functionNames(o.scripts).map(name => ({ name, path: file + '#/scripts', side: 'process' }))); }
      const origin = Array.isArray(raw) ? 'settings[]' : service === 'widgets' ? 'descriptor.fields' : service === 'processor' ? 'context' : 'fields';
      const entityFields = fields(Array.isArray(raw) ? raw : o.fields || o.context || descriptor.fields, origin);
      const values = obj(obj(descriptor.template).values), lifecycle = Object.fromEntries(Object.entries(obj(values.systemFunctions)).map(([slot, binding]) => [slot, Object.fromEntries(['name', 'type', 'kind'].flatMap(k => typeof obj(binding)[k] === 'string' ? [[k, text(binding[k])]] : []))]));
      const allText = identifiersOnly(texts.join('\n'));
      modules.add(module);
      entities.push({ id: `${environment}:${code}:${entities.length}`, server: environment, solution: code, service, module, namespace,
        code: text(e.code), name: text(e.name) || text(o.name) || text(e.code), kind: text(e.kind), file, source, workspace, scripts,
        fields: entityFields, fieldCount: entityFields.length, functions: [...new Set(functionSources.map(f => f.name))].sort(), functionSources,
        lifecycle, dataBinding: Object.fromEntries(['dataNamespace', 'dataCode'].flatMap(k => typeof o[k] === 'string' ? [[k, text(o[k])]] : []).concat(typeof descriptor.dataFieldCode === 'string' ? [['dataFieldCode', text(descriptor.dataFieldCode)]] : [])),
        embeddedScriptPointer: typeof o.scripts === 'string' ? '/scripts' : undefined,
        variableUsage: count([...allText.matchAll(/\b(?:Context|ViewContext|Application|Namespace|Global)\.data\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,2}/g)].map(m => m[0])),
        rpcFunctions: [...new Set([...allText.matchAll(/\bServer\.rpc\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))].sort(),
        globalReferences: [...new Set([...allText.matchAll(/\bGlobal\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))].sort(),
        resources: list(e.resources).map(r => `${service}/${safePath(String(obj(r).path || ''))}`)
      });
    }
  }
  if (opaque) warnings.push('Непрозрачный пакет data: поля, скрипты и сущности недоступны для анализа.');
  const deps = dependencies(pkg);
  return { solution: { code, name: text(pkg.title) || text(obj(pkg.solution).name) || code, type: text(pkg.type), status: opaque ? 'opaque' : 'editable', reason: opaque ? 'opaque-package' : undefined,
    modules: [...modules].filter(m => m !== '_shared').sort(), entities: entities.length, files: files.size, services: count(entities.map(e => e.service)), dependencies: deps, dependencyCounts: count(deps.map(d => d.category)), importedAt: new Date().toISOString(), serverVersion: text(pkg.serverVersion), warnings }, entities };
}

export function updateEnvironment(data, environment, imported) {
  serverKey(environment);
  const previous = data.servers[environment] || { label: environment, solutions: [], entities: [] };
  const code = imported.solution.code;
  const info = { ...previous, solutions: [...previous.solutions.filter(s => s.code !== code), imported.solution], entities: [...previous.entities.filter(e => e.solution !== code), ...imported.entities] };
  info.namespaces = {};
  for (const s of info.solutions) for (const m of s.modules || []) {
    const rows = info.entities.filter(e => e.solution === s.code && e.module === m);
    (info.namespaces[m] ||= []).push({ package: s.code, workspace: `workspaces/${s.code}`, entities: rows.length, services: [...new Set(rows.map(e => e.service))] });
  }
  for (const s of info.solutions) for (const d of s.dependencies || []) {
    if (d.status === 'unknown-schema') continue;
    const matches = info.entities.filter(e => e.service === d.service && e.namespace === d.targetNamespace && (!d.targetCode || e.code === d.targetCode));
    const providers = [...new Set(matches.map(e => e.solution))];
    d.status = !d.targetNamespace ? 'unresolved' : !d.targetCode && matches.length ? 'namespace-present-unverified' : providers.length > 1 ? 'ambiguous' : matches.length ? 'present' : 'unresolved';
  }
  info.stats = { catalog: info.solutions.length, exported: info.solutions.filter(s => s.status === 'editable').length, entities: info.entities.length, modules: Object.keys(info.namespaces).length, fields: info.entities.reduce((n, e) => n + e.fields.length, 0), functions: info.entities.reduce((n, e) => n + (e.functions || []).length, 0) };
  return { ...data, updatedAt: new Date().toISOString(), servers: { ...data.servers, [environment]: info } };
}

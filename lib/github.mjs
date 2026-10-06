import { limits, interpret, interpretFiles, safePath } from './e365.mjs';
export function repository(value) {
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(value || '');
  if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2])) throw Error('Укажите https://github.com/owner/repository');
  return `${match[1]}/${match[2]}`;
}
export function githubClient(token, fetchImpl = fetch) {
  if (!token) throw Error('Войдите через GitHub для чтения репозитория');
  async function request(endpoint, raw = false) {
    let response;
    try { response = await fetchImpl(`https://api.github.com${endpoint}`, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'elma-wiki' } }); }
    catch { throw Error('GitHub временно недоступен'); }
    if (!response.ok) throw Error(response.status === 404 ? 'Репозиторий или файл недоступен этому аккаунту' : response.status === 403 ? 'GitHub ограничил доступ. Проверьте разрешения и лимиты API.' : 'GitHub не выполнил запрос');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > (raw ? limits.upload : 16 * 1024 * 1024)) throw Error('Ответ GitHub превышает лимит'); chunks.push(chunk); }
    const buffer = Buffer.concat(chunks);
    return raw ? buffer : JSON.parse(buffer.toString('utf8'));
  }
  async function inspect(value) {
    const repo = repository(value), meta = await request(`/repos/${repo}`);
    const tree = await request(`/repos/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`);
    if (tree.truncated) throw Error('GitHub обрезал дерево репозитория. Загрузите .e365 локально.');
    const blobs = tree.tree.filter(e => e.type === 'blob'), candidates = [];
    for (const file of blobs.filter(f => f.path.endsWith('.e365'))) candidates.push({ type: 'archive', path: file.path, size: file.size });
    for (const file of blobs.filter(f => f.path === 'package.json' || f.path.endsWith('/package.json'))) {
      const prefix = file.path === 'package.json' ? '' : file.path.slice(0, -12);
      if (blobs.some(f => f.path.startsWith(prefix) && /^[^/]+\/manifest\.json$/.test(f.path.slice(prefix.length)))) candidates.push({ type: 'extracted', path: prefix || '.', size: blobs.filter(f => f.path.startsWith(prefix)).reduce((n, f) => n + (f.size || 0), 0) });
    }
    return { repo, sha: tree.sha, branch: meta.default_branch, candidates, blobs };
  }
  return {
    async list(value) { const { repo, sha, branch, candidates } = await inspect(value); return { repo, sha, branch, candidates }; },
    async import(value, selectedPath, environment) {
      const snapshot = await inspect(value), candidate = snapshot.candidates.find(c => c.path === selectedPath);
      if (!candidate) throw Error('Выбранная конфигурация не найдена в текущем дереве');
      const blob = async f => { if (f.size > limits.entry && candidate.type === 'extracted' || f.size > limits.upload) throw Error('Файл GitHub превышает лимит'); return request(`/repos/${snapshot.repo}/git/blobs/${f.sha}`, true); };
      if (candidate.type === 'archive') return interpret(await blob(snapshot.blobs.find(f => f.path === candidate.path)), environment);
      const prefix = candidate.path === '.' ? '' : candidate.path, files = new Map(); let size = 0;
      const selected = snapshot.blobs.filter(f => f.path.startsWith(prefix) && (f.path.slice(prefix.length) === 'package.json' || /^[^/]+\//.test(f.path.slice(prefix.length))));
      if (selected.length > limits.entries || selected.reduce((n, f) => n + (f.size || 0), 0) > limits.expanded) throw Error('Извлечённая конфигурация превышает лимит');
      for (const file of selected) {
        const buffer = await blob(file); size += buffer.length;
        if (size > limits.expanded) throw Error('Извлечённая конфигурация превышает лимит');
        files.set(safePath(file.path.slice(prefix.length)), buffer);
      }
      return interpretFiles(files, environment);
    }
  };
}

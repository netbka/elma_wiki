import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { actorIdentity } from './actors.mjs';
import { githubRequest } from './github-api.mjs';

export const bugLimits = { attachments: 5, attachmentBytes: 5 * 1024 * 1024, bodyBytes: 36 * 1024 * 1024 };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const fields = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('Некорректный отчёт');
};
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Проверьте ${label}`);
  return value.trim();
};
const marker = id => `<!-- wiki-bug:${id} -->`;

export function bugGitHub({ repository = process.env.BUG_REPORT_GITHUB_REPOSITORY, token = process.env.BUG_REPORT_GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  if (!repository && !token) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !token || /\s/.test(token)) fail('Configure a named GitHub repository and server token');
  const call = (route, method, body) => githubRequest(`/repos/${repository}${route}`, { token, fetchImpl, method, body });
  const receipt = result => {
    if (!Number.isSafeInteger(result?.number) || result.number < 1) fail('Не удалось проверить номер GitHub issue', 502);
    return { number: result.number, url: `https://github.com/${repository}/issues/${result.number}` };
  };
  return {
    repository,
    async publish(report, base) {
      const links = report.attachments.map((item, i) => `[Вложение ${i + 1}](${base}/api/bug-reports/${report.id}/attachments/${item.id})`).join('\n');
      const result = await call('/issues', 'POST', { title: report.title,
        body: `${marker(report.id)}\n\n${report.text}\n\nТип: ${report.kind === 'reject' ? 'Отклонение' : 'Ошибка'}\n\n[Отчёт и контекст в Wiki](${base}/bug-reports?id=${report.id})\n\n${links}\n\nВложения доступны только после входа в Wiki. Этот отчёт не разрешает развёртывание.` });
      return receipt(result);
    },
    async recover(id) {
      let match = null;
      for (let page = 1; page <= 3; page++) {
        const rows = await call(`/issues?state=all&per_page=100&page=${page}`);
        if (!Array.isArray(rows) || rows.length > 100) fail('Не удалось полностью проверить GitHub issues', 502);
        const matches = rows.filter(row => !row.pull_request && row.body?.startsWith(marker(id) + '\n'));
        if (matches.length > 1 || match && matches.length) fail('Найдены неоднозначные GitHub issues; требуется проверка оператора', 409);
        if (matches.length) match = receipt(matches[0]);
        if (rows.length < 100) return match;
      }
      fail('Список GitHub issues неполон; повторная отправка запрещена', 409);
    }
  };
}

export function bugReportStore(directory, { github = null, baseUrl, rejectChange } = {}) {
  const root = path.resolve(directory, 'bug-reports');
  const base = new URL(baseUrl).origin;
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const folder = id => { if (!uuid.test(id || '')) fail('Отчёт не найден', 404); return path.join(root, id); };
  const read = async id => {
    try { return JSON.parse(await fs.readFile(path.join(folder(id), 'report.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail('Отчёт не найден', 404); throw error; }
  };
  const save = async record => {
    const dir = folder(record.id), temp = path.join(dir, crypto.randomUUID() + '.tmp');
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, path.join(dir, 'report.json'));
  };
  const publicRecord = record => { const { inputHash, ...safe } = record; return safe; };
  const validate = input => {
    fields(input, ['id', 'title', 'text', 'kind', 'context', 'attachments', 'publishConfirmed']);
    if (!uuid.test(input.id || '') || !['bug', 'reject'].includes(input.kind)) fail('Некорректный отчёт');
    if (input.publishConfirmed !== true) fail('Подтвердите публикацию заголовка и описания в GitHub');
    const title = text(input.title, 160, 'заголовок'), description = text(input.text, 8000, 'описание');
    fields(input.context, ['route', 'viewport', 'solutionId', 'artifactId', 'expectedRevision', 'expectedDiscussionRevision']);
    if (typeof input.context.route !== 'string' || !/^\/[a-z0-9/_-]*$/i.test(input.context.route) || input.context.route.length > 200) fail('Некорректная страница отчёта');
    const viewport = input.context.viewport;
    fields(viewport, ['width', 'height', 'devicePixelRatio']);
    if (![viewport.width, viewport.height].every(value => Number.isInteger(value) && value > 0 && value <= 32768) ||
        typeof viewport.devicePixelRatio !== 'number' || !Number.isFinite(viewport.devicePixelRatio) || viewport.devicePixelRatio <= 0 || viewport.devicePixelRatio > 10) fail('Некорректный размер окна');
    for (const name of ['solutionId', 'artifactId']) if (input.context[name] != null && !uuid.test(input.context[name])) fail('Некорректный контекст решения');
    for (const name of ['expectedRevision', 'expectedDiscussionRevision']) if (input.context[name] != null && (!Number.isInteger(input.context[name]) || input.context[name] < 0)) fail('Некорректная версия');
    if (!Array.isArray(input.attachments) || input.attachments.length > bugLimits.attachments) fail('Можно добавить не более пяти вложений');
    const attachments = input.attachments.map(item => {
      fields(item, ['name', 'mime', 'data']);
      const name = text(item.name, 160, 'имя файла');
      if (/[\x00-\x1f/\\]/.test(name) || !['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'].includes(item.mime)) fail('Разрешены PNG, JPEG, WebP, PDF и текстовые файлы');
      if (typeof item.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data) || item.data.length > Math.ceil(bugLimits.attachmentBytes / 3) * 4) fail('Некорректное вложение');
      const bytes = Buffer.from(item.data, 'base64');
      if (!bytes.length || bytes.length > bugLimits.attachmentBytes) fail('Каждое вложение должно быть не больше 5 МБ');
      if (item.mime === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
          item.mime === 'image/jpeg' && !bytes.subarray(0, 3).equals(Buffer.from([255,216,255])) ||
          item.mime === 'image/webp' && !(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') ||
          item.mime === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') fail('Тип файла не соответствует содержимому');
      return { id: crypto.randomUUID(), name, mime: item.mime, size: bytes.length, sha256: hash(bytes), bytes };
    });
    return { title, text: description, attachments };
  };
  const publish = async record => {
    if (!github) { record.status = 'unconfigured'; record.message = 'Отчёт сохранён. Отправка в GitHub ещё не настроена.'; await save(record); return publicRecord(record); }
    if (record.status === 'published') return publicRecord(record);
    if (record.repository && record.repository !== github.repository) fail('Получатель GitHub изменился. Сохранённый отчёт нельзя отправить в другой репозиторий.', 409);
    if (record.status === 'publishing' || record.status === 'unknown') {
      try {
        const issue = await github.recover(record.id);
        if (issue) { record.issue = issue; record.status = 'published'; record.message = null; }
        else { record.status = 'unknown'; record.message = 'Отправка могла завершиться. Issue пока не найден; новая отправка не выполнялась.'; }
      } catch { record.status = 'unknown'; record.message = 'Результат GitHub неоднозначен. Вложения сохранены; требуется проверка оператора.'; }
      await save(record); return publicRecord(record);
    }
    record.status = 'publishing'; record.repository = github.repository; await save(record);
    try { record.issue = await github.publish(record, base); record.status = 'published'; record.message = null; }
    catch (error) { record.status = error.unknown === false ? 'failed' : 'unknown'; record.message = record.status === 'failed' ? 'GitHub не принял отчёт. Вложения сохранены; можно повторить.' : 'Ответ GitHub не получен. Вложения сохранены; проверьте результат без повторной отправки.'; }
    await save(record); return publicRecord(record);
  };
  return {
    config: () => ({ repository: github?.repository || null, attachmentPolicy: 'authenticated-wiki', limits: bugLimits }),
    get: async (id, user) => { actorIdentity(user); return publicRecord(await read(id)); },
    attachment: async (id, attachmentId, user) => {
      actorIdentity(user); const record = await read(id), item = record.attachments.find(value => value.id === attachmentId);
      if (!item) fail('Вложение не найдено', 404);
      const bytes = await fs.readFile(path.join(folder(id), item.id + '.bin'));
      if (bytes.length !== item.size || hash(bytes) !== item.sha256) fail('Целостность вложения нарушена', 409);
      return { ...item, bytes };
    },
    submit: (input, user) => serial(async () => {
      const actor = actorIdentity(user), validated = validate(input), inputHash = hash(JSON.stringify(input));
      let existing;
      try { existing = await read(input.id); } catch (error) { if (error.statusCode !== 404) throw error; }
      if (existing) {
        if (existing.inputHash !== inputHash || existing.actor.id !== actor.id) fail('Этот отчёт уже сохранён с другим содержимым', 409);
        return publish(existing);
      }
      const record = { id: input.id, title: validated.title, text: validated.text, kind: input.kind,
        context: input.context, actor, createdAt: new Date().toISOString(), inputHash, status: 'ready', issue: null,
        attachments: validated.attachments.map(({ bytes, ...item }) => item) };
      // The dedicated directory is created once; only server-generated IDs become paths.
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const staging = path.join(root, '.stage-' + crypto.randomUUID());
      await fs.mkdir(staging, { mode: 0o700 });
      for (const item of validated.attachments) await fs.writeFile(path.join(staging, item.id + '.bin'), item.bytes, { mode: 0o600, flag: 'wx' });
      await fs.writeFile(path.join(staging, 'report.json'), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      await fs.rename(staging, folder(input.id));
      return publish(record);
    }),
    retry: (id, user) => serial(async () => {
      actorIdentity(user); const record = await read(id);
      return publish(record);
    })
  };
}

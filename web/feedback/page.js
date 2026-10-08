import { mountBugReporter } from './render.js';
const request = async (url, input) => {
  let response;
  try { response = await fetch(url, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Elma-Wiki-Request': '1' }, body: JSON.stringify(input) }); }
  catch { throw Error('Ответ не получен. Повторите сохранение с тем же отчётом.'); }
  let value;
  try { value = await response.json(); } catch { throw Error('Ответ не прочитан. Повторите сохранение с тем же отчётом.'); }
  if (!response.ok) throw Object.assign(Error(value.error || 'Отчёт не сохранён'), { status: response.status });
  return value;
};
try {
  const session = await request('/api/session');
  if (session.user) {
    const config = await request('/api/bug-reports');
    document.body.append(mountBugReporter(config, {
      context: () => ({ route: location.pathname, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        ...JSON.parse(document.querySelector('#managed-root')?.dataset.bugContext || '{}') }),
      submit: input => request('/api/bug-reports', input), retry: id => request('/api/bug-reports/' + id + '/retry', {})
    }));
    if (location.pathname === '/bug-reports') {
      const root = document.getElementById('bug-report-root');
      try {
        const report = await request('/api/bug-reports/' + new URLSearchParams(location.search).get('id'));
        const heading = document.createElement('h1'); heading.textContent = report.title;
        const detail = document.createElement('pre'); detail.textContent = report.text;
        const author = document.createElement('p'); author.textContent = `${report.actor.login} · ${new Date(report.createdAt).toLocaleString('ru-RU')} · ${report.context.route}`;
        const state = document.createElement('p'); state.textContent = report.message || (report.status === 'published' ? 'Отправлен в GitHub' : 'Сохранён');
        root.replaceChildren(heading, author, detail, state);
        if (report.issue) { const link = document.createElement('a'); link.textContent = 'GitHub issue #' + report.issue.number; link.href = report.issue.url; link.rel = 'noopener noreferrer'; root.append(link); }
        const list = document.createElement('ul'); root.append(list);
        for (const attachment of report.attachments) {
          const row = document.createElement('li'), link = document.createElement('a');
          link.textContent = attachment.name; link.href = `/api/bug-reports/${report.id}/attachments/${attachment.id}`; row.append(link); list.append(row);
        }
      } catch (error) { root.textContent = error.message; }
    }
  }
} catch { /* The host page remains usable if feedback is temporarily unavailable. */ }

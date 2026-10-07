/** Server-to-server transport. The authenticated Wiki, never a browser field, supplies owner. */
export function requestCoordinator({ url = process.env.REQUEST_COORDINATOR_URL,
  token = process.env.REQUEST_PORTAL_KEY, fetchImpl = fetch } = {}) {
  if (!url && !token) return null;
  let base;
  try { base = new URL(url); } catch { throw Error('Invalid request coordinator destination'); }
  if (!token || token.length < 32 || base.username || base.password || base.search || base.hash ||
      base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw Error('Request coordinator requires a dedicated secret and HTTPS or numeric loopback');
  }
  async function call(operation, data) {
    let response;
    try {
      response = await fetchImpl(new URL('/portal/' + operation, base), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(data)
      });
    } catch {
      throw Object.assign(Error('Очередь недоступна. Для повтора сохраните тот же operationId.'), { status: 503 });
    }
    // Do not echo a remote error body, URL, secret or stack into the portal.
    if (!response.ok) {
      const messages = { 400: 'Некорректное задание', 403: 'Нет доступа к этому проекту',
        404: 'Задание не найдено', 409: 'Задание изменилось. Обновите состояние.', 429: 'Достигнут лимит активных заданий' };
      throw Object.assign(Error(messages[response.status] || 'Очередь недоступна'),
        { status: messages[response.status] ? response.status : 503 });
    }
    try { return await response.json(); }
    catch { throw Object.assign(Error('Не удалось прочитать состояние очереди'), { status: 503 }); }
  }
  return { read: (owner, id) => call('read', { owner, ...(id ? { id } : {}) }),
    command: (owner, input) => call('command', { owner, input }) };
}

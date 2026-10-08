// Shared GitHub transport. Credentials stay in the server/worker environment.
export async function githubRequest(route, { token, method = 'GET', body, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(`https://api.github.com${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'elma-wiki', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch { throw Object.assign(Error('GitHub недоступен; результат отправки неизвестен'), { statusCode: 502, unknown: true }); }
  if (!response.ok) throw Object.assign(Error('GitHub не принял запрос'), { statusCode: 502, unknown: response.status >= 500, remoteStatus: response.status });
  try { return await response.json(); }
  catch { throw Object.assign(Error('Ответ GitHub не прочитан; результат неизвестен'), { statusCode: 502, unknown: true }); }
}

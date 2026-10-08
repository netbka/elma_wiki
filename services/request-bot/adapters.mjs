import { createHmac, timingSafeEqual } from 'node:crypto';
import { Fault, text } from './core.mjs';

export function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyWebhook(raw, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return secretEqual(expected, signature);
}
export function normalizeVkEvent(event, botId) {
  if (!Number.isSafeInteger(event?.eventId) || event.eventId < 0) throw new Fault('invalid_vk_event_id', 400);
  const p = event.payload || {};
  if (event.type === 'newMessage') {
    const actor = p.from?.userId;
    if (!actor || actor === botId) return { id: event.eventId, type: 'ignored' };
    return { id: p.msgId ? JSON.stringify(['message', String(p.chat?.chatId), String(p.msgId)]) : event.eventId, type: 'message', actor: String(actor), chat: String(p.chat?.chatId || ''), text: p.text,
      chatType: p.chat?.type, replyTo: p.replyMsgId || p.parts?.find(x => x.type === 'reply')?.payload?.message?.msgId };
  }
  if (event.type === 'callbackQuery') {
    // Official SDK uses the second queryId segment. Never use a display name.
    const sdkActor = typeof p.queryId === 'string' ? p.queryId.split(':')[1] : null;
    if (p.from?.userId && sdkActor && String(p.from.userId) !== sdkActor) throw new Fault('callback_identity_mismatch', 400);
    const actor = p.from?.userId || sdkActor;
    if (!actor) throw new Fault('callback_identity_missing', 400);
    return { id: p.queryId ? `callback:${p.queryId}` : event.eventId, type: 'callback', actor: String(actor), chat: String(p.message?.chat?.chatId || ''), token: p.callbackData };
  }
  // Edits/deletions never silently rewrite an approved requirement.
  return { id: event.eventId, type: 'ignored' };
}
async function jsonResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Fault('provider_empty_response', 502);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Fault('provider_response_too_large', 502);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { await reader.cancel().catch(() => {}); throw new Fault('provider_invalid_response', 502); }
}
export class VkClient {
  constructor({ apiBase, token, botId }, fetchImpl = fetch) {
    const url = new URL(apiBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Unsafe VK API URL');
    this.base = url.href.replace(/\/$/, ''); this.token = token; this.botId = botId; this.fetch = fetchImpl;
  }
  async call(method, params, timeout = 10000) {
    const url = new URL(`${this.base}/${method}`);
    url.searchParams.set('token', text(this.token(), 2000));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    try {
      const response = await this.fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      const result = await jsonResponse(response);
      if (!response.ok || result?.ok !== true) throw new Fault('vk_request_failed', 502);
      return result;
    } catch { throw new Fault('vk_request_failed', 502); } // Never propagate a URL containing the token.
  }
  async send(chat, payload) {
    const result = await this.call('messages/sendText', { chatId: chat, text: payload.text,
      ...(payload.buttons ? { inlineKeyboardMarkup: JSON.stringify(payload.buttons) } : {}) });
    return text(String(result.msgId || ''), 200);
  }
  async events(cursor) {
    const r = await this.call('events/get', { lastEventId: cursor, pollTime: 20 }, 30000);
    if (!Array.isArray(r.events) || r.events.length > 100) throw new Fault('invalid_vk_batch', 502);
    return r.events;
  }
}
export const issueMarker = id => `<!-- request-bot:${id} -->`;
export const prMarker = (id, revision, iteration = 0) => `<!-- request-bot:${id}:v${revision}${iteration ? ':fix' + iteration : ''} -->`;
export const prBranch = r => `bot/${r.id.toLowerCase()}/v${r.revision}${r.iteration ? '-fix' + r.iteration : ''}`;
export class GitHubClient {
  constructor({ token, botLogin }, fetchImpl = fetch) { this.token = token; this.botLogin = botLogin; this.fetch = fetchImpl; }
  async call(path, method = 'GET', body) {
    try {
      const response = await this.fetch(`https://api.github.com${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${text(this.token(), 2000)}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'elma-request-bot', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await jsonResponse(response);
      if (!response.ok) throw new Fault('github_request_failed', 502);
      return result;
    } catch { throw new Fault('github_request_failed', 502); }
  }
  async createIssue(r, project) {
    const result = await this.call(`/repos/${project.repository}/issues`, 'POST', {
      title: `Development request ${r.id}`,
      body: `${issueMarker(r.id)}\n\nDevelopment request registered.\nPrivate requirements and conversation are retained in the authorized coordinator, not this repository.\nThis issue does not authorize deployment or production changes.`
    });
    if (!Number.isSafeInteger(result.number) || result.user?.login !== this.botLogin) throw new Fault('invalid_issue_receipt', 502);
    return result.number;
  }
  async createComment(r, project, payload) {
    const result = await this.call(`/repos/${project.repository}/issues/${r.issueNumber}/comments`, 'POST', {
      body: `Request ${r.id}: **${payload.state}**, requirements v${r.revision}.\nThis is a status projection, not deployment evidence. Private details remain in the authorized request service.\n<!-- request-bot:${r.id}:state:${payload.state}:v${r.revision} -->`
    });
    if (!Number.isSafeInteger(result.id)) throw new Fault('invalid_comment_receipt', 502);
    return String(result.id);
  }
  async recoverIssue(r, project) {
    // Read-only reconciliation. Absence is NOT proof a timed-out create did not happen.
    let match = null;
    for (let page = 1; page <= 3; page++) {
      const issues = await this.call(`/repos/${project.repository}/issues?state=all&creator=${encodeURIComponent(this.botLogin)}&per_page=100&page=${page}`);
      if (!Array.isArray(issues) || issues.length > 100) throw new Fault('invalid_issue_list', 502);
      const matches = issues.filter(x => !x.pull_request && x.user?.login === this.botLogin && x.body?.includes(issueMarker(r.id)));
      if (matches.length > 1 || (match !== null && matches.length)) throw new Fault('ambiguous_issue_receipt', 409);
      if (matches.length === 1) {
        if (!Number.isSafeInteger(matches[0].number) || matches[0].number < 1) throw new Fault('invalid_issue_receipt', 502);
        match = matches[0].number;
      }
      if (issues.length < 100) return match;
    }
    // A full last page leaves unseen records; uniqueness has not been established.
    throw new Fault('incomplete_issue_list', 502);
  }
  async verifyPr(r, project, result) {
    if (!Number.isSafeInteger(result?.number) || result.number < 1 || !/^[a-f0-9]{40}$/.test(result.headSha || '')) throw new Fault('invalid_pr_result', 400);
    const pr = await this.call(`/repos/${project.repository}/pulls/${result.number}`);
    if (pr.number !== result.number || pr.state !== 'open' || pr.head?.sha !== result.headSha || pr.base?.repo?.full_name !== project.repository ||
        pr.head?.repo?.full_name !== project.repository || pr.base?.ref !== (project.baseRef || 'main') ||
        pr.head?.ref !== prBranch(r) || !pr.body?.includes(prMarker(r.id, r.revision, r.iteration))) throw new Fault('publication_mismatch', 409);
    return { repository: project.repository, number: pr.number, headSha: pr.head.sha };
  }
}
export async function dispatchOne(core, adapters) {
  const o = core.claimOutbox();
  if (!o) return false;
  try {
    let id;
    if (o.kind === 'github_issue') id = await adapters.github.createIssue(o.request, o.project);
    else if (o.kind === 'github_comment') id = await adapters.github.createComment({ ...o.request, revision: o.revision }, o.project, o.payload);
    else id = await adapters.vk.send(o.request.chat, o.payload);
    core.sent(o, id);
  } catch {
    // Sending may already have happened. Repeating a POST blindly is unsafe.
    core.uncertain(o, o.kind === 'github_issue' ? 'github_delivery_unknown' : 'vk_delivery_unknown');
  }
  return true;
}
export async function reconcileIssues(core, github) {
  for (const o of core.s.all("SELECT * FROM outbox WHERE status='unknown' AND kind='github_issue' ORDER BY id LIMIT 20")) {
    const r = core.s.request(o.request_id);
    try {
      core.authorizedRoute(r);
      const number = await github.recoverIssue(r, core.project(r.project));
      if (number) core.sent(o, number);
    } catch { /* Retain unknown for operator inspection; never hide uncertainty. */ }
  }
}
export function githubCommentEvent(core, payload) {
  if (payload.action !== 'created' || !payload.comment || payload.comment.user?.id !== payload.sender?.id) return null;
  const command = payload.comment.body?.match(/^\/(reply|changes)\s+([\s\S]+)$/);
  if (!command) return null;
  for (const row of core.s.all('SELECT record FROM requests')) {
    const r = JSON.parse(row.record);
    if (core.project(r.project).repository !== payload.repository?.full_name || r.issueNumber !== payload.issue?.number) continue;
    const binding = core.config.bindings.find(b => b.actor === r.owner && b.chat === r.chat && b.projects.includes(r.project) && b.githubUserId === payload.sender.id);
    if (!binding) return null;
    return { id: `${payload.repository.id}:comment:${payload.comment.id}`, type: 'message', actor: r.owner, chat: r.chat, text: `/${command[1]} ${r.id} ${command[2]}` };
  }
  return null;
}

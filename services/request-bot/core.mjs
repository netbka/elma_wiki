import { createHash, randomBytes } from 'node:crypto';
import { ciPolicy, ciSummary } from './ci.mjs';

export class Fault extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export const digest = value => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(24).toString('hex');
const SHA = /^[a-f0-9]{40}$/;
const ACTIVE = ['TRIAGING', 'WAITING_USER', 'AWAITING_APPROVAL', 'QUEUED', 'IMPLEMENTING', 'PUBLISHING', 'PR_READY', 'BLOCKED'];
export function text(value, max = 8000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\u0000/.test(value)) throw new Fault('invalid_text', 400);
  return value.trim();
}
function strings(value, max = 10, maxChars = 2000) {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Fault('invalid_list', 400);
  return value.map(v => text(v, maxChars));
}
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Fault('invalid_result', 400);
}

/** Pure state/authorization boundary; no network or child processes inside transactions. */
export class Coordinator {
  constructor(store, config, clock = Date.now) {
    this.s = store; this.config = config; this.clock = clock;
    this.leaseMs = config.leaseMs ?? 120000;
    this.maxJobs = config.maxJobs ?? 20;
    this.maxRunMs = config.maxRunMs ?? 1800000;
  }
  project(key) {
    const p = this.config.projects[key];
    if (!p) throw new Fault('unknown_project', 403);
    return p;
  }
  route(project) {
    const p = this.project(project);
    return { repository: p.repository, baseRef: p.baseRef || 'main', taskKind: p.taskKind, targetRef: p.targetRef || null, ...(p.ci ? { ci: ciPolicy(p.ci) } : {}) };
  }
  authorizedRoute(r) {
    this.binding(r.owner, r.chat, r.project);
    if (JSON.stringify(r.route) !== JSON.stringify(this.route(r.project))) throw new Fault('routing_changed');
  }
  binding(actor, chat, project) {
    const b = chat === 'portal' ? this.config.portal?.bindings.find(b => b.owner === actor && b.projects.includes(project))
      : this.config.bindings.find(b => b.actor === actor && b.chat === chat && b.projects.includes(project));
    if (!b) throw new Fault('not_authorized', 403);
    return b;
  }
  owned(id, actor, chat) {
    const r = this.s.request(id);
    if (!r || r.owner !== actor || r.chat !== chat) throw new Fault('not_found', 404);
    this.binding(actor, chat, r.project);
    return r;
  }
  audit(r, actor, event) {
    this.s.run('INSERT INTO audit(request_id,actor,event,revision,created) VALUES(?,?,?,?,?)', r.id, actor, event, r.revision, this.clock());
  }
  enqueue(r, kind) {
    const count = this.s.get('SELECT count(*) AS n FROM jobs WHERE request_id=?', r.id).n;
    if (count >= this.maxJobs) { r.state = 'BLOCKED'; r.blocker = 'job_budget_exhausted'; return false; }
    this.s.run('INSERT INTO jobs(request_id,revision,kind,iteration) VALUES(?,?,?,?)', r.id, r.revision, kind, r.iteration || 0);
    return true;
  }
  out(r, kind, payload) {
    // Portal requests are read through the authenticated API, never delivered to a VK chat.
    if (kind === 'vk' && r.chat === 'portal') return;
    this.s.run('INSERT INTO outbox(request_id,kind,revision,payload) VALUES(?,?,?,?)', r.id, kind, r.revision, JSON.stringify(payload));
  }
  notify(r, detail = '') {
    // Status projections on GitHub never include the user's text or the private specification.
    const issue = r.issueNumber ? `\nGitHub: https://github.com/${r.route.repository}/issues/${r.issueNumber}` : '';
    this.out(r, 'vk', { text: `${r.id} | ${r.state} | v${r.revision}\n${detail}${r.ci ? '\n' + ciSummary(r) : ''}${issue}` });
    if (r.issueNumber && !this.s.get("SELECT id FROM outbox WHERE request_id=? AND kind='github_comment' AND revision=? AND json_extract(payload,'$.state')=?", r.id, r.revision, r.state)) this.out(r, 'github_comment', { state: r.state });
  }
  action(r, action) {
    const token = nonce();
    this.s.run('INSERT INTO actions(digest,request_id,revision,actor,action,expires) VALUES(?,?,?,?,?,?)', digest(token), r.id, r.revision, r.owner, action, this.clock() + 86400000);
    return token;
  }
  newRequest(actor, chat, project, body) {
    this.binding(actor, chat, project); this.project(project);
    const count = this.s.all('SELECT record FROM requests WHERE owner=? AND project=?', actor, project)
      .filter(x => ACTIVE.includes(JSON.parse(x.record).state)).length;
    if (count >= (this.config.maxActive ?? 10)) throw new Fault('active_request_limit', 429);
    const r = { id: `REQ-${randomBytes(6).toString('hex').toUpperCase()}`, project, owner: actor, chat,
      state: 'TRIAGING', revision: 1, route: this.route(project), created: this.clock(), messages: [{ actor, text: text(body), at: this.clock() }] };
    this.s.save(r); this.enqueue(r, 'triage'); this.s.save(r);
    this.out(r, 'github_issue', {});
    this.notify(r, '\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430. /status ' + r.id);
    this.audit(r, actor, 'created');
    return r.id;
  }
  revise(r, actor, body) {
    if (!['WAITING_USER', 'AWAITING_APPROVAL', 'PR_READY'].includes(r.state)) throw new Fault('reply_not_expected');
    if (r.messages.length >= 20) throw new Fault('conversation_limit', 429);
    r.messages.push({ actor, text: text(body), at: this.clock() });
    r.revision++; r.state = 'TRIAGING';
    delete r.spec; delete r.approval; delete r.patch; delete r.blocker; delete r.questions;
    r.iteration = 0; delete r.ci; delete r.repairFrom;
    // Old PRs remain traceable; no destructive close or overwrite on a new iteration.
    if (r.pr) { r.previousPrs = [...(r.previousPrs || []), r.pr]; delete r.pr; }
    this.s.run("UPDATE jobs SET status='cancelled' WHERE request_id=? AND status IN ('queued','running')", r.id);
    this.s.run('UPDATE actions SET used=1 WHERE request_id=?', r.id);
    this.enqueue(r, 'triage'); this.s.save(r); this.audit(r, actor, 'requirements_revised'); this.notify(r);
  }
  approve(r, actor, revision) {
    this.authorizedRoute(r);
    if (r.state !== 'AWAITING_APPROVAL' || r.revision !== revision || !r.spec) throw new Fault('stale_approval');
    r.approval = { actor, revision, at: this.clock(), specHash: digest(JSON.stringify(r.spec)) };
    r.state = 'QUEUED'; this.enqueue(r, 'implement'); this.s.save(r);
    this.audit(r, actor, 'spec_approved'); this.notify(r);
  }
  cancel(r, actor) {
    if (r.state === 'CANCELLED') return;
    r.state = 'CANCELLED';
    this.s.run("UPDATE jobs SET status='cancelled' WHERE request_id=? AND status IN ('queued','running')", r.id);
    this.s.run('UPDATE actions SET used=1 WHERE request_id=?', r.id);
    this.s.save(r); this.audit(r, actor, 'cancelled');
    this.notify(r, '\u041d\u043e\u0432\u044b\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u044b. Existing PRs are retained; cancellation is not rollback.');
  }
  message(e) {
    const actor = text(e.actor, 200), chat = text(e.chat, 200), body = text(e.text);
    const bindings = this.config.bindings.filter(b => b.actor === actor && b.chat === chat);
    if (!bindings.length) throw new Fault('not_authorized', 403);
    const match = body.match(/^\/(task|reply|changes|approve|cancel|status)(?:\s+([\s\S]+))?$/);
    if (!match) {
      const rows = this.s.all('SELECT record FROM requests WHERE owner=? AND chat=?', actor, chat)
        .map(x => JSON.parse(x.record)).filter(r => ACTIVE.includes(r.state));
      if (e.replyTo) {
        const sent = this.s.all("SELECT request_id FROM outbox WHERE kind='vk' AND provider_id=?", String(e.replyTo));
        const ids = [...new Set(sent.map(x => x.request_id).filter(Boolean))];
        if (ids.length !== 1) throw new Fault('unknown_reply', 400);
        const r = this.owned(ids[0], actor, chat); this.revise(r, actor, body); return r.id;
      }
      if (e.chatType && e.chatType !== 'private') throw new Fault('use_task_or_reply', 400);
      if (rows.length === 1 && rows[0].state === 'WAITING_USER') { this.revise(rows[0], actor, body); return rows[0].id; }
      const projects = [...new Set(bindings.flatMap(b => b.projects))];
      if (!rows.length && projects.length === 1 && !body.startsWith('/')) return this.newRequest(actor, chat, projects[0], body);
      throw new Fault('use_task_or_reply', 400);
    }
    const cmd = match[1], rest = match[2] || '';
    if (cmd === 'task') {
      const parts = rest.match(/^(\S+)\s+([\s\S]+)$/);
      if (!parts) throw new Fault('usage_task_project_text', 400);
      return this.newRequest(actor, chat, parts[1], parts[2]);
    }
    const parts = rest.match(/^(REQ-[A-F0-9]{12})(?:\s+([\s\S]+))?$/);
    if (!parts) throw new Fault('request_id_required', 400);
    const r = this.owned(parts[1], actor, chat);
    if (cmd === 'reply' || cmd === 'changes') this.revise(r, actor, parts[2]);
    if (cmd === 'approve') this.approve(r, actor, Number(parts[2]));
    if (cmd === 'cancel') this.cancel(r, actor);
    if (cmd === 'status') this.notify(r, r.blocker || (r.pr ? `PR: ${r.pr.url}\nDev2: NOT DEPLOYED` : ''));
    return r.id;
  }
  callback(e) {
    const a = this.s.get('SELECT * FROM actions WHERE digest=?', digest(text(e.token, 100)));
    if (!a || a.actor !== e.actor || a.used || a.expires <= this.clock()) throw new Fault('invalid_or_expired_action', 403);
    const r = this.owned(a.request_id, e.actor, e.chat);
    if (r.revision !== a.revision) throw new Fault('stale_approval');
    if (a.action === 'approve') this.approve(r, e.actor, a.revision);
    else if (a.action === 'cancel') this.cancel(r, e.actor);
    else throw new Fault('invalid_action');
    this.s.run('UPDATE actions SET used=1 WHERE digest=?', a.digest);
    return r.id;
  }
  /** Events are normalized by a trusted VK adapter/dispatcher, not by browser clients. */
  ingest(stream, events, cursor = null) {
    if (!Array.isArray(events) || events.length > 100) throw new Fault('invalid_batch', 400);
    return this.s.tx(() => {
      const outcomes = [];
      for (const e of events) {
        if (!e || !['string', 'number'].includes(typeof e.id)) throw new Fault('invalid_event_id', 400);
        const eventKey = JSON.stringify([text(stream, 200), text(String(e.id), 200)]);
        const old = this.s.get('SELECT outcome FROM inbox WHERE event_key=?', eventKey);
        if (old) { outcomes.push(JSON.parse(old.outcome)); continue; }
        this.s.db.exec('SAVEPOINT incoming_event');
        let result;
        try {
          const requestId = e.type === 'message' ? this.message(e) : e.type === 'callback' ? this.callback(e) : null;
          result = { status: requestId ? 'accepted' : 'ignored', requestId };
          this.s.db.exec('RELEASE incoming_event');
        } catch (err) {
          this.s.db.exec('ROLLBACK TO incoming_event; RELEASE incoming_event');
          if (!(err instanceof Fault)) throw err;
          result = { status: 'rejected', code: err.code };
          const binding = this.config.bindings.find(b => b.actor === e.actor && b.chat === e.chat);
          if (binding) this.s.run('INSERT INTO outbox(request_id,kind,revision,payload) VALUES(NULL,?,?,?)', 'vk', 0, JSON.stringify({ chat: e.chat,
            text: `Request not applied: ${err.code}. /task ${binding.projects[0]} <description>; /reply REQ-... <answer>; /status REQ-...` }));
        }
        this.s.run('INSERT INTO inbox(event_key,outcome,created) VALUES(?,?,?)', eventKey, JSON.stringify(result), this.clock());
        outcomes.push(result);
      }
      if (cursor !== null) {
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Fault('invalid_cursor', 400);
        this.s.run('INSERT INTO cursors(stream,position) VALUES(?,?) ON CONFLICT(stream) DO UPDATE SET position=max(position,excluded.position)', stream, cursor);
      }
      return outcomes;
    });
  }
  claim(worker) {
    return this.s.tx(() => {
      const jobs = this.s.all("SELECT * FROM jobs WHERE status='queued' ORDER BY id");
      for (const j of jobs) {
        const r = this.s.request(j.request_id);
        if (!worker.kinds.includes(j.kind) || !worker.projects.includes(r.project)) continue;
        try { this.authorizedRoute(r); }
        catch { this.s.run("UPDATE jobs SET status='failed' WHERE id=?", j.id); r.state = 'BLOCKED'; r.blocker = 'routing_or_authorization_changed'; this.s.save(r); this.audit(r, 'coordinator', r.blocker); continue; }
        if (j.revision !== r.revision || j.iteration !== (r.iteration || 0) || r.state === 'CANCELLED') { this.s.run("UPDATE jobs SET status='cancelled' WHERE id=?", j.id); continue; }
        // One active worker per request, enforced transactionally even with concurrent claim calls.
        if (this.s.get("SELECT id FROM jobs WHERE request_id=? AND status='running'", r.id)) continue;
        if (j.kind !== 'triage' && (r.approval?.revision !== r.revision || r.approval.specHash !== digest(JSON.stringify(r.spec)))) throw new Fault('approval_required');
        const token = nonce(), expires = this.clock() + Math.min(this.leaseMs, this.maxRunMs);
        this.s.run("UPDATE jobs SET status='running',worker=?,token=?,expires=?,deadline=?,attempts=attempts+1 WHERE id=?", worker.id, token, expires, this.clock() + this.maxRunMs, j.id);
        r.state = { triage: 'TRIAGING', implement: 'IMPLEMENTING', publish: 'PUBLISHING' }[j.kind];
        this.s.save(r); this.audit(r, worker.id, `${j.kind}_claimed`);
        const p = this.project(r.project);
        return { id: j.id, kind: j.kind, leaseToken: token, expires, revision: r.revision, iteration: r.iteration || 0,
          request: r, repository: p.repository, taskKind: p.taskKind, targetRef: p.targetRef || null };
      }
      return null;
    });
  }
  leased(worker, id, token) {
    const j = this.s.get('SELECT * FROM jobs WHERE id=?', id);
    const r = j && this.s.request(j.request_id);
    if (!j || j.worker !== worker.id || j.token !== token || !worker.kinds.includes(j.kind) || !worker.projects.includes(r.project)) throw new Fault('lease_not_found', 404);
    this.authorizedRoute(r);
    if (j.status !== 'running' || j.expires <= this.clock() || j.deadline <= this.clock() || j.revision !== r.revision || j.iteration !== (r.iteration || 0) || r.state === 'CANCELLED') throw new Fault('lease_lost');
    return { j, r };
  }
  heartbeat(worker, id, token) {
    return this.s.tx(() => {
      const { j } = this.leased(worker, id, token);
      const expires = Math.min(this.clock() + this.leaseMs, j.deadline);
      this.s.run('UPDATE jobs SET expires=? WHERE id=?', expires, id);
      return { expires };
    });
  }
  complete(worker, id, token, result, verifiedPublication = null) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Fault('invalid_result', 400);
    const resultHash = digest(JSON.stringify(result));
    return this.s.tx(() => {
      const old = this.s.get('SELECT * FROM jobs WHERE id=?', id);
      if (old?.status === 'done' && old.worker === worker.id && old.token === token && old.result_hash === resultHash && worker.kinds.includes(old.kind) && worker.projects.includes(this.s.request(old.request_id).project)) return { accepted: true, replay: true };
      const { j, r } = this.leased(worker, id, token);
      if (j.kind === 'triage') {
        fields(result, ['type', 'questions', 'summary', 'criteria', 'scope']);
        if (result.type === 'needs_input') {
          r.questions = strings(result.questions, 5, 400); r.state = 'WAITING_USER';
          this.notify(r, `${r.questions.join('\n')}\n/reply ${r.id} ...`);
        } else if (result.type === 'specification') {
          r.spec = { summary: text(result.summary, 600), criteria: strings(result.criteria, 6, 240), scope: strings(result.scope, 5, 120) };
          r.state = 'AWAITING_APPROVAL'; delete r.questions;
          const approve = this.action(r, 'approve'), cancel = this.action(r, 'cancel');
          this.out(r, 'vk', { text: `${r.id} | v${r.revision}\n${r.spec.summary}\n${r.spec.criteria.map(x => '- ' + x).join('\n')}\nScope: ${r.spec.scope.join('; ')}\nProject: ${r.project}. CI repairs within this exact specification: ${r.route.ci?.maxRepairs || 0}. Deployment is NOT approved by this action.\n/approve ${r.id} ${r.revision}\n/reply ${r.id} ...`,
            buttons: [[{ text: '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c', callbackData: approve }, { text: '\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c', callbackData: cancel }]] });
        } else throw new Fault('invalid_triage_result', 400);
      } else if (j.kind === 'implement') {
        fields(result, ['type', 'artifactId', 'sha256', 'baseSha']);
        if (result.type !== 'patch_ready' || typeof result.artifactId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(result.artifactId) || !/^[a-f0-9]{64}$/.test(result.sha256) || !SHA.test(result.baseSha)) throw new Fault('invalid_patch_manifest', 400);
        r.patch = { artifactId: result.artifactId, sha256: result.sha256, baseSha: result.baseSha };
        r.state = 'PUBLISHING'; this.enqueue(r, 'publish'); this.notify(r);
      } else if (j.kind === 'publish') {
        fields(result, ['type', 'number', 'headSha']);
        if (result.type !== 'pull_request' || !Number.isSafeInteger(result.number) || result.number < 1 || !SHA.test(result.headSha)) throw new Fault('invalid_pr_result', 400);
        // Only the HTTP server's independent GitHub read can supply this receipt.
        if (verifiedPublication?.number !== result.number || verifiedPublication?.headSha !== result.headSha || verifiedPublication?.repository !== this.project(r.project).repository) throw new Fault('publication_not_verified');
        r.pr = { number: result.number, headSha: result.headSha, url: `https://github.com/${verifiedPublication.repository}/pull/${result.number}` };
        r.state = 'PR_READY';
        delete r.ci;
        this.notify(r, `${r.pr.url}\nDev2: NOT DEPLOYED. CI/review and a separately approved delivery are still required.\n/changes ${r.id} ...`);
      } else throw new Fault('unknown_job_kind');
      this.s.run("UPDATE jobs SET status='done',result_hash=? WHERE id=?", resultHash, id);
      this.s.save(r); this.audit(r, worker.id, `${j.kind}_completed`);
      return { accepted: true, state: r.state };
    });
  }
  fail(worker, id, token, code = 'worker_failed') {
    if (!['worker_failed', 'budget_exhausted', 'unsupported_capability', 'tests_failed'].includes(code)) throw new Fault('invalid_failure_code', 400);
    return this.s.tx(() => {
      const { r } = this.leased(worker, id, token);
      this.s.run("UPDATE jobs SET status='failed' WHERE id=?", id);
      r.state = 'BLOCKED'; r.blocker = code;
      this.s.save(r); this.notify(r, code); this.audit(r, worker.id, code);
      return { state: r.state };
    });
  }
  reconcile() {
    return this.s.tx(() => {
      let recovered = 0;
      for (const j of this.s.all("SELECT * FROM jobs WHERE status='running' AND expires<=?", this.clock())) {
        const r = this.s.request(j.request_id);
        if (j.kind === 'triage' && j.attempts < 3) {
          this.s.run("UPDATE jobs SET status='queued',token=NULL,worker=NULL,expires=NULL WHERE id=?", j.id);
        } else {
          this.s.run("UPDATE jobs SET status='failed' WHERE id=?", j.id);
          r.state = 'BLOCKED'; r.blocker = 'worker_outcome_unknown'; this.s.save(r); this.notify(r, r.blocker);
        }
        this.audit(r, 'reconciler', 'lease_expired'); recovered++;
      }
      this.s.run("UPDATE outbox SET status='unknown',error_code='delivery_outcome_unknown' WHERE status='sending' AND expires<=?", this.clock());
      return { recovered };
    });
  }
  claimOutbox() {
    return this.s.tx(() => {
      for (const o of this.s.all("SELECT * FROM outbox WHERE status='queued' ORDER BY id")) {
        const r = o.request_id ? this.s.request(o.request_id) : null;
        if (r && o.kind === 'vk' && o.revision !== r.revision) { this.s.run("UPDATE outbox SET status='superseded' WHERE id=?", o.id); continue; }
        const payload = JSON.parse(o.payload);
        if (r) {
          try { this.authorizedRoute(r); }
          catch { this.s.run("UPDATE outbox SET status='unknown',error_code='routing_or_authorization_changed' WHERE id=?", o.id); continue; }
        }
        if (payload.buttons && r?.state !== 'AWAITING_APPROVAL') { this.s.run("UPDATE outbox SET status='superseded' WHERE id=?", o.id); continue; }
        const token = nonce();
        this.s.run("UPDATE outbox SET status='sending',token=?,expires=?,attempts=attempts+1 WHERE id=?", token, this.clock() + 60000, o.id);
        return { ...o, token, payload, request: r || { chat: payload.chat }, project: r ? this.project(r.project) : null };
      }
      return null;
    });
  }
  sent(o, providerId) {
    return this.s.tx(() => {
      const current = this.s.get('SELECT * FROM outbox WHERE id=?', o.id);
      if (current?.token !== o.token || !['sending', 'unknown'].includes(current.status)) throw new Fault('outbox_lease_lost');
      const r = o.request_id ? this.s.request(o.request_id) : null;
      if (o.kind === 'github_issue') {
        const number = Number(providerId);
        if (!Number.isSafeInteger(number) || number < 1) throw new Fault('invalid_issue_receipt');
        r.issueNumber = number; this.s.save(r); this.notify(r);
      }
      this.s.run("UPDATE outbox SET status='sent',provider_id=?,error_code=NULL WHERE id=?", String(providerId), o.id);
    });
  }
  uncertain(o, code) {
    this.s.run("UPDATE outbox SET status='unknown',error_code=? WHERE id=? AND token=? AND status='sending'", code, o.id, o.token);
  }
}

import { Fault, digest, text } from './core.mjs';

function bindings(core, owner) {
  text(owner, 200);
  const found = core.config.portal?.bindings.filter(b => b.owner === owner) || [];
  if (!found.length) throw new Fault('not_authorized', 403);
  return found;
}
function view(r) {
  // No worker leases, patch artifacts, provider keys or internal routing in the browser model.
  return { id: r.id, project: r.project, state: r.state, revision: r.revision, created: r.created,
    messages: r.messages, questions: r.questions || [], specification: r.spec || null,
    approved: r.approval?.revision === r.revision, blocker: r.blocker || null,
    pullRequest: r.pr || null, ci: r.ci ? { status: r.ci.status } : null, deployed: false };
}
export function readPortal(core, owner, id) {
  const allowed = [...new Set(bindings(core, owner).flatMap(b => b.projects))];
  if (id) return view(core.owned(text(id, 40), owner, 'portal'));
  const requests = core.s.all("SELECT record FROM requests WHERE owner=? AND chat=? ORDER BY json_extract(record,'$.created') DESC LIMIT 100", owner, 'portal')
    .map(row => JSON.parse(row.record)).filter(r => allowed.includes(r.project))
    .sort((a, b) => b.created - a.created).map(view);
  return { projects: allowed, requests };
}
export function commandPortal(core, owner, input) {
  bindings(core, owner);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['operationId', 'action', 'requestId', 'revision', 'project', 'text'].includes(k))) throw new Fault('invalid_command', 400);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(input.operationId || '') ||
      !['create', 'reply', 'approve', 'cancel'].includes(input.action)) throw new Fault('invalid_command', 400);
  const key = 'portal:' + digest(JSON.stringify([owner, input.operationId]));
  const hash = digest(JSON.stringify(input));
  return core.s.tx(() => {
    const old = core.s.get('SELECT outcome FROM inbox WHERE event_key=?', key);
    if (old) {
      const receipt = JSON.parse(old.outcome);
      if (receipt.hash !== hash) throw new Fault('operation_id_reused');
      return readPortal(core, owner, receipt.requestId);
    }
    let id;
    if (input.action === 'create') {
      if (input.requestId !== undefined || input.revision !== undefined) throw new Fault('invalid_command', 400);
      id = core.newRequest(owner, 'portal', text(input.project, 40), input.text);
    } else {
      if (input.project !== undefined || (input.action !== 'reply' && input.text !== undefined)) throw new Fault('invalid_command', 400);
      const r = core.owned(text(input.requestId, 40), owner, 'portal');
      if (!Number.isSafeInteger(input.revision) || r.revision !== input.revision) throw new Fault('stale_revision');
      if (input.action === 'reply') core.revise(r, owner, input.text);
      if (input.action === 'approve') core.approve(r, owner, input.revision);
      if (input.action === 'cancel') core.cancel(r, owner);
      id = r.id;
    }
    core.s.run('INSERT INTO inbox(event_key,outcome,created) VALUES(?,?,?)', key,
      JSON.stringify({ hash, requestId: id }), core.clock());
    return readPortal(core, owner, id);
  });
}

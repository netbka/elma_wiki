import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positive = n => Number.isSafeInteger(n) && n > 0;
const require = (ok, code) => { if (!ok) throw Error(code); };
const safeName = s => typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\x00-\x1f\x7f]/.test(s);

/** Explicit workflow IDs/paths/jobs, not a forgeable check name or aggregate green badge. */
export function ciPolicy(value) {
  require(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => ['workflows', 'maxRepairs'].includes(k)), 'invalid_ci_policy');
  require(Array.isArray(value.workflows) && value.workflows.length > 0 && value.workflows.length <= 4, 'invalid_ci_workflows');
  const workflows = value.workflows.map(w => {
    require(w && Object.keys(w).sort().join() === 'id,jobs,path' && positive(w.id) &&
      /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(w.path) &&
      Array.isArray(w.jobs) && w.jobs.length > 0 && w.jobs.length <= 8 && w.jobs.every(safeName) &&
      new Set(w.jobs).size === w.jobs.length, 'invalid_ci_workflow');
    return { id: w.id, path: w.path, jobs: [...w.jobs] };
  });
  require(new Set(workflows.map(w => w.id)).size === workflows.length &&
    new Set(workflows.map(w => w.path)).size === workflows.length, 'duplicate_ci_workflow');
  const maxRepairs = value.maxRepairs ?? 0;
  require(Number.isInteger(maxRepairs) && maxRepairs >= 0 && maxRepairs <= 2, 'invalid_ci_repair_limit');
  return { workflows, maxRepairs };
}
export function ciSummary(r) {
  const c = r.ci;
  return `CI: ${c.status.toUpperCase()} for ${c.headSha.slice(0, 12)}; observed ${new Date(c.observedAt).toISOString()}. Repair ${r.iteration || 0}/${r.route.ci?.maxRepairs || 0}. Dev2: NOT DEPLOYED. This is not acceptance or merge.`;
}
const identity = r => JSON.stringify([r.id, r.revision, r.iteration || 0, r.pr, r.patch, r.approval, r.route]);
const stamp = run => JSON.stringify([run.id, run.run_attempt, run.status, run.conclusion, run.updated_at]);

async function listAll(github, path, field) {
  const rows = []; let expected;
  for (let page = 1; page <= 3; page++) {
    const data = await github.call(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    require(Number.isSafeInteger(data?.total_count) && data.total_count >= 0 && data.total_count <= 300 &&
      Array.isArray(data[field]) && data[field].length <= 100, 'incomplete_ci_list');
    expected ??= data.total_count;
    require(expected === data.total_count, 'ci_list_changed');
    rows.push(...data[field]);
    if (rows.length === expected) {
      require(new Set(rows.map(r => r.id)).size === rows.length && rows.every(r => positive(r.id)), 'ambiguous_ci_list');
      return rows;
    }
    require(rows.length < expected && data[field].length === 100, 'incomplete_ci_list');
  }
  throw Error('incomplete_ci_list');
}

/** Read-only observation. Raw job logs, URLs from output and artifact downloads are never followed. */
export async function observeCi(github, r, project) {
  const policy = ciPolicy(r.route.ci), root = `/repos/${r.route.repository}`;
  const checkedPr = async () => {
    await github.verifyPr(r, project, { number: r.pr.number, headSha: r.pr.headSha });
    const pr = await github.call(`${root}/pulls/${r.pr.number}`);
    require(pr.number === r.pr.number && pr.state === 'open' && pr.head?.sha === r.pr.headSha &&
      pr.head?.repo?.full_name === r.route.repository && pr.base?.repo?.full_name === r.route.repository &&
      pr.base?.ref === r.route.baseRef && pr.base?.sha === r.patch.baseSha, 'ci_pr_or_base_changed');
    return pr;
  };
  const pr = await checkedPr();
  const runPath = `${root}/actions/runs?head_sha=${r.pr.headSha}&event=pull_request`;
  const runs = await listAll(github, runPath, 'workflow_runs');
  const select = rows => policy.workflows.map(w => rows.filter(x => x.workflow_id === w.id).sort((a, b) => b.id - a.id)[0]);
  const selected = select(runs), evidence = [];
  let waiting = false, blocked = false, failed = false;
  for (let i = 0; i < policy.workflows.length; i++) {
    const w = policy.workflows[i], run = selected[i];
    if (!run) { waiting = true; evidence.push({ workflowId: w.id, status: 'missing' }); continue; }
    require(run.workflow_id === w.id && run.path === w.path && run.event === 'pull_request' &&
      run.head_sha === r.pr.headSha && run.head_branch === pr.head.ref && run.head_repository?.full_name === r.route.repository &&
      positive(run.run_attempt) && Array.isArray(run.pull_requests) && run.pull_requests.some(p =>
        p.number === r.pr.number && p.head?.sha === r.pr.headSha && p.base?.sha === r.patch.baseSha), 'ci_run_mismatch');
    const e = { workflowId: w.id, runId: run.id, attempt: run.run_attempt, status: run.status, conclusion: run.conclusion, jobs: [] };
    evidence.push(e);
    if (run.status !== 'completed') { waiting = true; continue; }
    const jobs = await listAll(github, `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
    for (const name of w.jobs) {
      const matching = jobs.filter(j => j.name === name);
      if (matching.length !== 1) { blocked = true; continue; }
      const j = matching[0];
      require(j.run_id === run.id && Array.isArray(j.steps) && j.steps.length <= 100, 'ci_job_mismatch');
      const steps = j.steps.filter(s => s.conclusion === 'failure').map(s => { require(safeName(s.name), 'invalid_ci_step'); return s.name; });
      e.jobs.push({ id: j.id, name, status: j.status, conclusion: j.conclusion, failedSteps: steps });
      if (j.status !== 'completed') waiting = true;
      else if (j.conclusion === 'failure') failed = true;
      else if (j.conclusion !== 'success') blocked = true; // skipped, neutral, cancelled, timeout != pass
    }
    if (!['success', 'failure'].includes(run.conclusion)) blocked = true;
    if (run.conclusion === 'success' && e.jobs.some(j => j.conclusion === 'failure')) blocked = true;
    if (run.conclusion === 'failure' && !e.jobs.some(j => j.conclusion === 'failure')) blocked = true;
  }
  // A rerun/newer run, PR change or base change during the network reads invalidates the observation.
  const after = select(await listAll(github, runPath, 'workflow_runs'));
  require(selected.every((r, i) => stamp(r || {}) === stamp(after[i] || {})), 'ci_changed_during_read');
  await checkedPr();
  return { status: blocked ? 'blocked' : waiting ? 'waiting' : failed ? 'failed' : 'passed',
    headSha: r.pr.headSha, baseSha: r.patch.baseSha, workflows: evidence };
}

function apply(core, original, result) {
  return core.s.tx(() => {
    const r = core.s.request(original.id);
    if (!r || r.state !== 'PR_READY' || identity(r) !== identity(original)) return false;
    try { core.authorizedRoute(r); } catch { return false; }
    const fingerprint = hash(result), changed = r.ci?.fingerprint !== fingerprint;
    r.ci = { ...result, fingerprint, observedAt: core.clock() };
    const approvalOk = r.approval?.actor === r.owner && r.approval?.revision === r.revision &&
      r.approval.specHash === hash(r.spec);
    // No retry authority comes from a check log or an issue comment. It was shown on the approval card.
    const limit = r.route.ci.maxRepairs;
    if (result.status === 'failed' && approvalOk && (r.iteration || 0) < limit) {
      r.repairFrom = { iteration: r.iteration || 0, revision: r.revision, patch: r.patch, pr: r.pr, feedback: result };
      r.previousPrs = [...(r.previousPrs || []), { ...r.pr, ci: r.ci }];
      r.iteration = (r.iteration || 0) + 1;
      r.state = 'QUEUED'; delete r.pr; delete r.patch;
      const queued = core.enqueue(r, 'implement');
      core.audit(r, 'ci-observer', queued ? 'ci_repair_queued' : 'ci_repair_budget_exhausted');
      core.notify(r, queued ? 'CI failed. A bounded repair of the same approved specification is queued. No deployment is authorized.' : 'Job budget exhausted. No repair was queued.');
    } else if (changed) {
      core.audit(r, 'ci-observer', 'ci_' + result.status);
      core.notify(r, result.status === 'failed' ? 'Automatic repair disabled or exhausted. Review the checks or send /changes with your feedback.' : 'CI observation updated.');
    }
    core.s.save(r);
    return true;
  });
}

// Per-process suppression only; transactional request identity and job uniqueness also fence overlap.
const inflight = new WeakSet();
export async function refreshCi(core, github, signal) {
  if (signal?.aborted || inflight.has(core)) return { observed: 0 };
  inflight.add(core);
  try {
    // ponytail: bounded single-host sweep; oldest observation first prevents starvation.
    const rows = core.s.all("SELECT record FROM requests WHERE json_extract(record,'$.state')='PR_READY'")
      .map(x => JSON.parse(x.record)).filter(r => r.route?.ci && r.pr && r.patch)
      .sort((a, b) => (a.ci?.observedAt || 0) - (b.ci?.observedAt || 0)).slice(0, 20);
    let observed = 0;
    for (const r of rows) {
      if (signal?.aborted) break;
      try { core.authorizedRoute(r); } catch { continue; }
      let result;
      try { result = await observeCi(github, r, core.project(r.project)); }
      catch { result = { status: 'unavailable', headSha: r.pr.headSha, baseSha: r.patch.baseSha, workflows: [] }; }
      if (!signal?.aborted && apply(core, r, result)) observed++;
    }
    return { observed };
  } finally { inflight.delete(core); }
}

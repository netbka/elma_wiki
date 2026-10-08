import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Summarizes observer declarations. It neither performs human review nor
// closes an issue, and deliberately omits identities, links and free text.
export function usabilityReport(session, observations) {
  const blockers = [];
  const source = session?.source;
  if (session?.synthetic !== true || observations?.synthetic !== true) blockers.push('synthetic-session-required');
  if (!/^[a-f0-9]{40}$/.test(source?.revision ?? '') || source?.dirty !== false) blockers.push('clean-source-revision-required');
  if (!session?.startedAt || observations?.sessionStartedAt !== session.startedAt ||
      observations?.source?.revision !== source?.revision || observations?.source?.dirty !== source?.dirty)
    blockers.push('observation-session-mismatch');
  const roles = ['elma-familiar', 'new-to-repository'];
  const rows = Array.isArray(observations?.participants) ? observations.participants : [];
  if (rows.length !== 2 || rows.some(row => !roles.includes(row?.role))) blockers.push('exactly-two-participant-roles-required');
  const participants = roles.map(role => {
    const matches = rows.filter(row => row?.role === role);
    const row = matches.length === 1 ? matches[0] : null;
    const failures = [];
    if (!row || row.performed !== true) failures.push('not-performed');
    if (row?.coachingGiven !== false) failures.push('uncoached-declaration-required');
    if (row?.outcome !== 'pass') failures.push('passing-outcome-not-recorded');
    for (let i = 1; i <= 10; i++) {
      const task = row?.tasks?.[String(i)];
      if (task?.outcome !== 'pass' || task?.coachingGiven !== false || typeof task?.actions !== 'string' || !task.actions.trim())
        failures.push(`task-${i}-incomplete-coached-or-failed`);
    }
    for (const field of ['hesitation', 'wrongClicks', 'misunderstoodLabels', 'materialFindings']) {
      if (!Array.isArray(row?.[field])) failures.push(`${field}-record-required`);
    }
    if (row?.materialFindings?.length) failures.push('material-findings-remain');
    if (failures.length) blockers.push(`${role}-evidence-incomplete`);
    return { role, status: failures.length ? 'incomplete-or-needs-changes' : 'reported-pass', blockers: failures };
  });
  const visual = observations?.independentVisualReview;
  if (visual?.performed !== true || visual?.independent !== true || visual?.outcome !== 'pass' ||
      visual?.sourceRevision !== source?.revision || !Array.isArray(visual?.materialFindings) || visual.materialFindings.length)
    blockers.push('independent-visual-review-required');
  return { sourceRevision: /^[a-f0-9]{40}$/.test(source?.revision ?? '') ? source.revision : null,
    synthetic: session?.synthetic === true && observations?.synthetic === true,
    evidence: 'observer-declarations-only', participants, blockers,
    status: blockers.length ? 'incomplete-or-needs-changes' : 'ready-for-owner-walkthrough',
    productAccepted: false, nativeElmaObserved: false, deploymentAuthorized: false };
}

export async function readUsabilityReport(directory) {
  const read = async filename => {
    const location = path.resolve(directory, filename), stat = await fs.lstat(location);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Expected bounded regular observation files.');
    return JSON.parse(await fs.readFile(location, 'utf8'));
  };
  const [session, observations] = await Promise.all([read('session.local.json'), read('observations.local.json')]);
  return usabilityReport(session, observations);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Usage: node tools/usability-report.mjs <session-directory>');
  const report = await readUsabilityReport(process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.blockers.length ? 1 : 0;
}

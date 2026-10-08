import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createServer } from '../server.mjs';
import { vkLoginLinks } from '../lib/vk-login-links.mjs';
import { zip } from '../test/fixture.mjs';
import { visualSource } from '../web/visual/fixtures.js';

// A local human review of the actual product, never a substitute for its results.
// Do not load .env, real exports, real senders or an external Target.
export async function startUsabilitySession(directory, { port = 0 } = {}) {
  if (process.env.VK_LOGIN_BOT_POLL === '1') throw Error('Disable VK_LOGIN_BOT_POLL for the isolated synthetic session.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid local port.');
  await fs.mkdir(directory, { recursive: false, mode: 0o700 }); // Never reuse runtime storage.
  const code = 'synthetic_usability';
  const widget = limit => ({ descriptor: { fields: [{ code: 'title', type: 'STRING', view: { name: 'Название договора' } }],
    clientScripts: `const titleLimit: number = ${limit};`, serverScripts: 'async function check() { return true; }' } });
  const archive = (limit, full) => zip([
    ['package.json', { code, title: 'Учебные договоры', type: 'SOLUTION' }],
    ['widgets/manifest.json', { entities: [{ code: 'contract', namespace: 'synthetic.records', kind: 'WIDGET', path: 'contract.json' },
      ...(full ? [{ code: 'reference', namespace: 'synthetic.records', kind: 'WIDGET', path: 'reference.json' }] : [])] }],
    ['widgets/contract.json', widget(limit)],
    ...(full ? [['widgets/reference.json', widget(80)],
      ['processor/manifest.json', { entities: [{ code: 'approval', namespace: 'synthetic', kind: 'PROCESS', path: 'approval.json' }] }],
      ['processor/approval.json', visualSource]] : [])
  ]);
  const inputs = [
    { filename: '01-full.e365', scope: 'full', titleLimit: 160 },
    { filename: '02-change.e365', scope: 'partial', titleLimit: 240 },
    { filename: '03-later-full.e365', scope: 'full', titleLimit: 300 }
  ];
  for (const input of inputs) await fs.writeFile(path.join(directory, input.filename), await archive(input.titleLimit, input.scope === 'full'), { mode: 0o600, flag: 'wx' });
  const secret = crypto.randomBytes(32).toString('hex');
  const baseUrl = `http://127.0.0.1:${port}`;
  const sendVk = Object.assign(async () => { throw Error('Synthetic session has no message transport.'); }, { domain: 'example.org', linkSecret: secret });
  const server = createServer({ directory: path.join(directory, 'data'), baseUrl, sendEmail: undefined, sendVk,
    allowLocal: false, syntheticDelivery: false, protectedTargetHosts: [] });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const links = vkLoginLinks({ secret, baseUrl, domain: 'example.org' });
  const participants = ['elma-familiar', 'new-to-repository'].map(role => {
    const login = new URL(links.issue(role + '@example.org')); login.port = String(server.address().port);
    return { role, login: login.href };
  });
  const session = { synthetic: true, nativeElmaObserved: false, startedAt: new Date().toISOString(), base, inputs, participants };
  try {
    await fs.writeFile(path.join(directory, 'session.local.json'), JSON.stringify(session, null, 2), { mode: 0o600, flag: 'wx' });
    await fs.writeFile(path.join(directory, 'observations.local.json'), JSON.stringify({
      synthetic: true, participants: participants.map(({ role }) => ({ role, performed: false, coachingGiven: null,
        tasks: {}, hesitation: [], wrongClicks: [], misunderstoodLabels: [], materialFindings: [], outcome: null })),
      independentVisualReview: null, ownerDecision: null
    }, null, 2), { mode: 0o600, flag: 'wx' });
  } catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); throw error; }
  return { ...session, directory, server, close: async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await fs.mkdir('.local', { recursive: true, mode: 0o700 });
  const directory = path.resolve('.local', 'usability-' + crypto.randomUUID());
  const session = await startUsabilitySession(directory);
  console.log('Synthetic human usability session; no real VK or ELMA connection.');
  console.log('Input files and private observations: ' + directory);
  for (const participant of session.participants) console.log(participant.role + ': ' + participant.login);
  console.log('Use separate browser profiles. Stop with Ctrl+C; synthetic evidence is retained.');
  const stop = async () => { await session.close(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

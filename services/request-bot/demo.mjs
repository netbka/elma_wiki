import { Store } from './store.mjs';
import { Coordinator } from './core.mjs';

console.log('SYNTHETIC CONTRACT DEMO: no VK connection, LLM, GitHub write or deployment.');
const config = {
  projects: { wiki: { repository: 'example/wiki', taskKind: 'wiki_code' } },
  bindings: [{ actor: 'demo-user', chat: 'demo-chat', projects: ['wiki'] }]
};
const store = new Store(':memory:'), core = new Coordinator(store, config);
const agent = { id: 'demo-agent', projects: ['wiki'], kinds: ['triage', 'implement'] };
let event = 0;
const send = body => core.ingest('synthetic', [{ id: ++event, type: 'message', actor: 'demo-user', chat: 'demo-chat', text: body }])[0];
try {
  const id = send('/task wiki Add a reason field').requestId;
  const run = result => { const j = core.claim(agent); return core.complete(agent, j.id, j.leaseToken, result); };
  console.log(id, store.request(id).state);
  run({ type: 'needs_input', questions: ['Which form should change?'] });
  console.log(id, store.request(id).state);
  send(`/reply ${id} Payment form`);
  run({ type: 'specification', summary: 'Require a reason when returning a payment request', criteria: ['Return without reason is rejected', 'Normal saving stays unchanged'], scope: ['One test form'] });
  console.log(id, store.request(id).state, 'revision', store.request(id).revision);
  send(`/approve ${id} 2`);
  const implementation = core.claim(agent);
  console.log(id, store.request(id).state, 'leased job', implementation.id);
  core.fail(agent, implementation.id, implementation.leaseToken, 'unsupported_capability');
  console.log(id, store.request(id).state, ': no real agent runner is configured in this demo.');
} finally { store.close(); }

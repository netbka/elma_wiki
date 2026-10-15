import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stringify } from 'yaml';
import { checkWorktrees, loadCapabilities, run, taskContext, worktreeViolations } from '../tools/agent-workflow.mjs';

const authority = ['docs/SOLUTION_FIRST_PRODUCT_PLAN.md', 'docs/SOLUTION_FIRST_EXECUTION.md', 'docs/SOLUTION_FIRST_CONTRADICTIONS.md'];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-agent-workflow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = {
    version: 1,
    classification: { intents: { change: 'Implement an outcome', investigate: 'Inspect' }, boundaries: { tooling: 'Tools', ui: 'Visible UI' } },
    capabilities: {
      'agent-system': { owners: ['AGENTS.md', 'tools/'], routes: authority, boundaries: ['tooling'] },
      example: { owners: ['web/example.js'], routes: ['docs/example.md'], boundaries: ['ui'] },
    },
  };
  for (const entry of [...authority, 'AGENTS.md', 'web/example.js', 'docs/example.md']) {
    fs.mkdirSync(path.dirname(path.join(root, entry)), { recursive: true });
    fs.writeFileSync(path.join(root, entry), 'synthetic');
  }
  fs.mkdirSync(path.join(root, 'tools'));
  fs.mkdirSync(path.join(root, '.agent'));
  const save = () => fs.writeFileSync(path.join(root, '.agent/capabilities.yaml'), stringify(data));
  save();
  return { root, data, save };
}

test('repository router and CLI work independently of current directory', () => {
  const data = loadCapabilities();
  assert.ok(data.capabilities['agent-system'].routes.includes('docs/workflows/agent-execution.md'));
  const cli = fileURLToPath(new URL('../tools/agent-workflow.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--check'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Capability router verified/);
  const bad = spawnSync(process.execPath, [cli, 'change', 'missing-capability'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown capability/);
});

test('explicit selection loads only selected contracts and deduplicates product authority', t => {
  const { root } = fixture(t);
  const data = loadCapabilities(root);
  const context = taskContext(data, 'change', ['example']);
  assert.deepEqual(context.capabilities, ['example']);
  assert.deepEqual(context.boundaries, ['ui']);
  for (const route of authority) assert.ok(context.routes.includes(route));
  assert.ok(context.routes.includes('docs/example.md'));
  assert.equal(new Set(context.routes).size, context.routes.length);
  const agent = taskContext(data, 'investigate', ['agent-system']);
  assert.ok(!agent.routes.includes('docs/example.md'));
  assert.match(run(['change', 'example'], root), /does not authorize scope/);
});

test('rejects unknown phase, capabilities, empty selection and duplicates', t => {
  const { root } = fixture(t);
  const data = loadCapabilities(root);
  assert.throws(() => taskContext(data, 'deploy', ['example']), /Unknown intent/);
  assert.throws(() => taskContext(data, 'change', ['missing']), /Unknown capability/);
  assert.throws(() => taskContext(data, 'change', []), /nonempty list/);
  assert.throws(() => taskContext(data, 'change', ['example', 'example']), /duplicates/);
  assert.match(run(['--list'], root), /Intents: change, investigate/);
});

test('rejects missing files and file/directory type confusion', t => {
  const { root, data, save } = fixture(t);
  fs.unlinkSync(path.join(root, 'docs/example.md'));
  assert.throws(() => loadCapabilities(root), /missing docs\/example.md/);
  fs.mkdirSync(path.join(root, 'docs/example.md'));
  assert.throws(() => loadCapabilities(root), /wrong path type/);
  data.capabilities.example.routes = authority;
  data.capabilities.example.owners = ['web/'];
  save();
  assert.doesNotThrow(() => loadCapabilities(root));
  data.capabilities.example.owners = ['web/example.js/'];
  save();
  assert.throws(() => loadCapabilities(root), /wrong path type/);
});

test('rejects unknown boundaries, malformed schema and missing current authority', t => {
  const { root, data, save } = fixture(t);
  data.capabilities.example.boundaries = ['unregistered'];
  save();
  assert.throws(() => loadCapabilities(root), /unknown boundary/);
  data.capabilities.example.boundaries = ['ui'];
  data.capabilities['agent-system'].routes = [authority[0]];
  save();
  assert.throws(() => loadCapabilities(root), /current product, execution and contradiction/);
  data.capabilities['agent-system'].routes = authority;
  data.version = 2;
  save();
  assert.throws(() => loadCapabilities(root), /Unsupported/);
});

test('rejects paths outside repository and absolute paths', t => {
  const { root, data, save } = fixture(t);
  for (const unsafe of ['../private.md', '/etc/passwd', 'C:/private.md', 'docs/../../private.md', 'docs\\example.md']) {
    data.capabilities.example.routes = [unsafe];
    save();
    assert.throws(() => loadCapabilities(root), /Invalid repository path/);
  }
});

test('malformed YAML and duplicate capability keys fail validation', t => {
  const { root } = fixture(t);
  const router = path.join(root, '.agent/capabilities.yaml');
  fs.writeFileSync(router, 'version: [');
  assert.throws(() => loadCapabilities(root));
  fs.writeFileSync(router, 'version: 1\nversion: 2\n');
  assert.throws(() => loadCapabilities(root), /unique/);
});

test('secondary worktrees must be direct children of the primary .worktrees directory', () => {
  const primary = path.resolve(os.tmpdir(), 'wiki-primary');
  const entry = (location, extra = 'branch refs/heads/x') => `worktree ${location}\nHEAD 0000000000000000000000000000000000000000\n${extra}\n`;
  const porcelain = [
    entry(primary, 'branch refs/heads/main'),
    entry(path.join(primary, '.worktrees', 'ok')),
    entry(path.join(primary, '.worktrees', 'nested', 'deep'), 'detached'),
    entry(path.join(primary, 'sibling')),
    entry(path.resolve(primary, '..', 'wiki-primary-outside')),
  ].join('\n');
  const result = worktreeViolations(porcelain);
  assert.equal(result.primary, primary);
  assert.equal(result.secondary.length, 4);
  assert.deepEqual(result.violations, [
    path.join(primary, '.worktrees', 'nested', 'deep'),
    path.join(primary, 'sibling'),
    path.resolve(primary, '..', 'wiki-primary-outside'),
  ]);
  assert.deepEqual(worktreeViolations(entry(primary)).violations, []);
  assert.throws(() => worktreeViolations(''), /no primary worktree/);
});

test('worktree check reads real git registrations', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-worktrees-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const primary = path.join(base, 'repo');
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: primary, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  fs.mkdirSync(primary);
  git('init', '--quiet');
  git('commit', '--quiet', '--allow-empty', '-m', 'synthetic');
  git('worktree', 'add', '--quiet', '.worktrees/inside', '-b', 'inside');
  assert.match(checkWorktrees(primary), /1 secondary worktree\(s\)/);
  assert.match(checkWorktrees(path.join(primary, '.worktrees', 'inside')), /1 secondary worktree\(s\)/);
  git('worktree', 'add', '--quiet', path.join(base, 'outside'), '-b', 'outside');
  assert.throws(() => checkWorktrees(primary), /1 worktree\(s\) outside[\s\S]*outside[\s\S]*git worktree move/);
});

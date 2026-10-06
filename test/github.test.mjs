import test from 'node:test';
import assert from 'node:assert/strict';
import { githubClient, repository } from '../lib/github.mjs';
import { fixture } from './fixture.mjs';
test('repo URL is restricted to GitHub, without arbitrary URLs or shell execution', () => {
  assert.equal(repository('https://github.com/example/config.git'), 'example/config');
  for (const input of ['http://127.0.0.1:80/', 'https://evil.example/config', 'owner/../repo', 'file:///secret', 'owner/repo?token=x']) assert.throws(() => repository(input));
  assert.throws(() => githubClient(null));
});
test('GitHub archive listing and import use a fixed API origin and read-only methods', async () => {
  const archive = await fixture(), calls = [];
  const client = githubClient('TEST_TOKEN_NOT_REAL', async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/repos/example/config')) return Response.json({ default_branch: 'main' });
    if (url.includes('/git/trees/')) return Response.json({ sha: 'TEST_TREE', tree: [{ type: 'blob', path: 'export.e365', sha: 'TEST_BLOB', size: archive.length }] });
    if (url.endsWith('/git/blobs/TEST_BLOB')) return new Response(archive);
    throw Error('Unexpected URL');
  });
  assert.equal((await client.list('example/config')).candidates.length, 1);
  assert.equal((await client.import('example/config', 'export.e365', 'local')).entities.length, 1);
  assert.ok(calls.every(c => c.method === 'GET' && c.url.startsWith('https://api.github.com/')));
});
test('extracted config import reads only the selected subtree', async () => {
  const content = {
    pkg: Buffer.from('{"code":"example"}'), manifest: Buffer.from('{"entities":[{"code":"records","namespace":"example_module","path":"records.json"}]}'),
    entity: Buffer.from('{"fields":[{"code":"title","type":"STRING","defaultValue":"TEST_DEFAULT_NOT_REAL"}]}')
  };
  const tree = [{ type: 'blob', path: 'config/package.json', sha: 'pkg', size: content.pkg.length }, { type: 'blob', path: 'config/appViews/manifest.json', sha: 'manifest', size: content.manifest.length }, { type: 'blob', path: 'config/appViews/records.json', sha: 'entity', size: content.entity.length }, { type: 'blob', path: 'elsewhere/private.txt', sha: 'never-read', size: 10 }];
  const client = githubClient('TEST_TOKEN_NOT_REAL', async url => {
    if (url.endsWith('/repos/example/config')) return Response.json({ default_branch: 'main' });
    if (url.includes('/git/trees/')) return Response.json({ sha: 'tree', tree });
    const key = url.split('/').at(-1); if (!content[key]) throw Error('Read outside selected config'); return new Response(content[key]);
  });
  assert.deepEqual((await client.list('example/config')).candidates.map(c => c.path), ['config/']);
  const data = await client.import('example/config', 'config/', 'local');
  assert.equal(data.entities[0].fields[0].code, 'title');
  assert.ok(!JSON.stringify(data).includes('TEST_DEFAULT_NOT_REAL'));
});
test('truncated repository tree is rejected instead of claiming full coverage', async () => {
  const client = githubClient('TEST_TOKEN_NOT_REAL', async url => Response.json(url.includes('/git/trees/') ? { truncated: true } : { default_branch: 'main' }));
  await assert.rejects(client.list('example/config'), /обрезал/);
});
test('root-level config excludes unrelated folders, runtime data and nested configs', async () => {
  const content = {
    pkg: Buffer.from('{"code":"root_example"}'),
    manifest: Buffer.from('{"entities":[{"code":"records","namespace":"example_module","path":"records.json"}]}'),
    entity: Buffer.from('{"fields":[{"code":"title","type":"STRING"}]}')
  };
  const tree = [
    { type: 'blob', path: 'package.json', sha: 'pkg', size: content.pkg.length },
    { type: 'blob', path: 'appViews/manifest.json', sha: 'manifest', size: content.manifest.length },
    { type: 'blob', path: 'appViews/records.json', sha: 'entity', size: content.entity.length },
    ...['.local/private.json', '.github/workflows/ci.yml', 'node_modules/module/index.js', 'other/package.json', 'other/widgets/manifest.json'].map(path => ({ type: 'blob', path, sha: 'must-not-read', size: 500 }))
  ];
  const client = githubClient('TEST_TOKEN_NOT_REAL', async url => {
    if (url.endsWith('/repos/example/config')) return Response.json({ default_branch: 'main' });
    if (url.includes('/git/trees/')) return Response.json({ sha: 'tree', tree });
    const key = url.split('/').at(-1); assert.ok(content[key], 'Never download files outside selected service folders'); return new Response(content[key]);
  });
  const result = await client.import('example/config', '.', 'local');
  assert.equal(result.solution.files, 3); assert.equal(result.entities.length, 1);
});
test('LFS pointers produce an actionable error rather than an invalid-ZIP message', async () => {
  const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:TEST_SYNTHETIC_OBJECT\nsize 1000\n';
  const client = githubClient('TEST_TOKEN_NOT_REAL', async url => {
    if (url.endsWith('/repos/example/config')) return Response.json({ default_branch: 'main' });
    if (url.includes('/git/trees/')) return Response.json({ sha: 'tree', tree: [{ type: 'blob', path: 'export.e365', sha: 'pointer', size: pointer.length }] });
    return new Response(pointer);
  });
  await assert.rejects(client.import('example/config', 'export.e365', 'local'), /Git LFS/);
});
test('GitHub symlinks are rejected before downloading their blob', async () => {
  const client = githubClient('TEST_TOKEN_NOT_REAL', async url => {
    if (url.endsWith('/repos/example/config')) return Response.json({ default_branch: 'main' });
    if (url.includes('/git/trees/')) return Response.json({ sha: 'tree', tree: [{ type: 'blob', mode: '120000', path: 'export.e365', sha: 'link', size: 12 }] });
    assert.fail('Symlink must not be downloaded');
  });
  await assert.rejects(client.import('example/config', 'export.e365', 'local'), /Символические ссылки/);
});

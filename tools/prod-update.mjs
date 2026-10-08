import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw Error(`${command} failed; production was not declared updated`);
  return result.stdout?.trim();
}
try {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Usage: npm run prod:update [-- --check]');
  const env = { ...parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')), ...process.env };
  for (const key of ['PROD_IP', 'PROD_USER', 'PROD_PASS', 'PROD_URL']) {
    if (!env[key] || /[\r\n\0]/.test(env[key])) throw Error(`Set ${key} in the private .env`);
  }
  const url = new URL(env.PROD_URL.includes('://') ? env.PROD_URL : `https://${env.PROD_URL}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('PROD_URL must be an HTTPS origin');
  const knownHosts = path.join(root, '.local', 'prod-known-hosts');
  if (!fs.existsSync(knownHosts)) throw Error('Missing trusted SSH pin: .local/prod-known-hosts; provision it from the verified CT host key');
  if (!check) {
    if (run('git', ['branch', '--show-current']) !== 'main') throw Error('Run prod:update from main');
    if (run('git', ['status', '--porcelain', '--untracked-files=all'])) throw Error('Commit or preserve local changes before updating production');
    run('git', ['fetch', 'origin', '--prune'], { stdio: 'inherit' });
    run('git', ['merge', '--ff-only', 'origin/main'], { stdio: 'inherit' });
    if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) throw Error('Local main must equal origin/main');
  }
  const revision = run('git', ['rev-parse', 'HEAD']);
  const stage = path.join(root, '.local', `prod-update-${revision}-${Date.now()}.tar.gz`);
  if (!check) run('git', ['archive', '--format=tar.gz', `--output=${stage}`, revision]);
  const config = { host: env.PROD_IP, user: env.PROD_USER, password: env.PROD_PASS, origin: url.origin,
    knownHosts, revision, archive: stage, check };
  console.log(check ? 'Checking CT production without changing it…' : `Updating Wiki production to ${revision.slice(0, 12)}…`);
  run(env.PROD_PYTHON || 'python', [path.join(root, 'deploy', 'prod-ssh.py')], {
    input: JSON.stringify(config), stdio: ['pipe', 'inherit', 'inherit'],
  });
} catch (error) {
  // Do not print remote errors, command output, environment values or credentials.
  console.error(error.message.startsWith('ENOENT') ? 'Private .env or required executable is unavailable' : error.message);
  process.exitCode = 1;
}

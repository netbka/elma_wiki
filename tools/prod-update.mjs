import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { selectAuth } from './prod-auth.mjs';
import { parseUpdateArgs, readRuntimeSettings } from './prod-settings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw Error(`${command} failed; production was not declared updated`);
  return result.stdout?.trim();
}
try {
  const { check, designation } = parseUpdateArgs(process.argv.slice(2));
  const env = { ...parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')), ...process.env };
  for (const key of ['PROD_IP', 'PROD_USER', 'PROD_URL']) {
    if (!env[key] || /[\r\n\0]/.test(env[key])) throw Error(`Set ${key} in the private .env`);
  }
  const auth = selectAuth(env, root);
  for (const warning of auth.warnings) console.warn(warning);
  const url = new URL(env.PROD_URL.includes('://') ? env.PROD_URL : `https://${env.PROD_URL}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('PROD_URL must be an HTTPS origin');
  const knownHosts = path.join(root, '.local', 'prod-known-hosts');
  if (!fs.existsSync(knownHosts)) throw Error('Missing trusted SSH pin: .local/prod-known-hosts; provision it from the verified CT host key');
  // Optional named runtime settings to add or change; the CT revalidates them and prints changed key names only.
  // A designation-only operation sends none: it changes the DEV2 designation record and nothing else.
  const settings = designation ? {} : readRuntimeSettings(path.join(root, '.local', 'prod-runtime-settings.env'));
  if (Object.keys(settings).length) console.log(`Runtime settings requested: ${Object.keys(settings).sort().join(', ')}`);
  if (!check) {
    if (run('git', ['branch', '--show-current']) !== 'main') throw Error('Run prod:update from main');
    if (run('git', ['status', '--porcelain', '--untracked-files=all'])) throw Error('Commit or preserve local changes before updating production');
    run('git', ['fetch', 'origin', '--prune'], { stdio: 'inherit' });
    run('git', ['merge', '--ff-only', 'origin/main'], { stdio: 'inherit' });
    if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) throw Error('Local main must equal origin/main');
  }
  const revision = run('git', ['rev-parse', 'HEAD']);
  const stage = path.join(root, '.local', `prod-update-${revision}-${Date.now()}.tar.gz`);
  // A designation sends no source archive; like an update it still runs only the updater of clean, current main.
  if (!check && !designation) run('git', ['archive', '--format=tar.gz', `--output=${stage}`, revision]);
  // Key mode sends only the key file path (or the agent flag); the key itself is read by Paramiko.
  const config = { host: env.PROD_IP, user: env.PROD_USER, password: auth.password, keyFile: auth.keyFile,
    useAgent: auth.useAgent, origin: url.origin, knownHosts, revision, archive: designation ? null : stage, check, settings, designation };
  console.log(designation ? `${check ? 'Checking' : 'Applying'} DEV2 designation (${designation.action}, ${designation.candidates.length} digest(s)) without restarting Wiki…`
    : check ? 'Checking CT production without changing it…' : `Updating Wiki production to ${revision.slice(0, 12)}…`);
  run(env.PROD_PYTHON || 'python', [path.join(root, 'deploy', 'prod-ssh.py')], {
    input: JSON.stringify(config), stdio: ['pipe', 'inherit', 'inherit'],
  });
} catch (error) {
  // Do not print remote errors, command output, environment values or credentials.
  console.error(error.message.startsWith('ENOENT') ? 'Private .env or required executable is unavailable' : error.message);
  process.exitCode = 1;
}

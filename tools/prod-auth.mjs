import fs from 'node:fs';
import path from 'node:path';

// Password SSH login is a time-limited fallback (engineering-platform EP-031, review date 2026-11-30).
export const PASSWORD_FALLBACK_UNTIL = '2026-11-30';

const unsafe = value => /[\r\n\0]/.test(value);

// Chooses how the local updater authenticates to the CT. Never reads key material and never
// returns a password in key mode, so a leftover PROD_PASS cannot reach SSH or sudo.
export function selectAuth(env, root) {
  const keyFile = (env.PROD_SSH_KEY_FILE ?? '').trim();
  const useAgent = env.PROD_SSH_AGENT === '1';
  const warnings = [];
  if (keyFile || useAgent) {
    let resolved = null;
    if (keyFile) {
      if (unsafe(keyFile)) throw Error('PROD_SSH_KEY_FILE must be a single file path');
      resolved = path.resolve(root, keyFile);
      const relative = path.relative(root, resolved);
      const inside = relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      if (inside) throw Error('Keep the SSH private key outside the repository (PROD_SSH_KEY_FILE)');
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw Error('PROD_SSH_KEY_FILE does not point to a key file');
    }
    if (env.PROD_PASS) warnings.push('PROD_PASS is still set but no longer used; remove it from the private .env');
    return { mode: 'key', keyFile: resolved, useAgent, password: null, warnings };
  }
  if (env.PROD_PASS) {
    if (unsafe(env.PROD_PASS)) throw Error('Set PROD_PASS in the private .env');
    warnings.push(`Password SSH login is deprecated and allowed only until ${PASSWORD_FALLBACK_UNTIL}: set PROD_SSH_KEY_FILE or PROD_SSH_AGENT=1 (deploy/README.md)`);
    return { mode: 'password', keyFile: null, useAgent: false, password: env.PROD_PASS, warnings };
  }
  throw Error('Set PROD_SSH_KEY_FILE (or PROD_SSH_AGENT=1) in the private .env');
}

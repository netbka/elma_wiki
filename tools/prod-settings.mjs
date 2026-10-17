import fs from 'node:fs';
import { parseEnv } from 'node:util';

// Named non-secret runtime settings `npm run prod:update` may add or change on the production
// container. deploy/prod-update.py holds the same allowlist and is authoritative on the CT; this
// copy fails early on the operator's machine. Formats follow lib/target-presets.mjs and
// lib/native-materialization-bridge.mjs, narrowed to production use.
export const RUNTIME_SETTINGS = Object.freeze({
  WIKI_TARGET_DEV2_URL: /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/,
  // Empty withdraws every designation: lib/target-presets.mjs reads it as no candidate, as when unset.
  WIKI_TARGET_DEV2_DEPLOY_CANDIDATES: /^([0-9a-f]{64}(,[0-9a-f]{64})*)?$/,
  WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: /^(vk|email):[0-9a-f]{64}$/,
  WIKI_NATIVE_MATERIALIZATION_REVISION: /^[0-9a-f]{40}$/,
  WIKI_NATIVE_TARGET_PROFILE_TARGET: /^dev2$/,
  // Explicit adoption of the private designation record; the CT requires an empty candidate list with it.
  WIKI_TARGET_DEV2_DESIGNATIONS: /^file$/
});

// Validates the text of the private settings file. Errors name keys only, never values.
export function parseRuntimeSettings(text) {
  const settings = {};
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (!Object.hasOwn(RUNTIME_SETTINGS, key)) throw Error(`Runtime setting is not allowlisted: ${key}`);
    if (/[\r\n\0]/.test(value) || !RUNTIME_SETTINGS[key].test(value)) throw Error(`Runtime setting has an invalid format: ${key}`);
    settings[key] = value;
  }
  if (settings.WIKI_TARGET_DEV2_DESIGNATIONS === 'file' && settings.WIKI_TARGET_DEV2_DEPLOY_CANDIDATES)
    throw Error('File designation mode requires an empty WIKI_TARGET_DEV2_DEPLOY_CANDIDATES');
  return settings;
}

// A missing file means no runtime setting changes.
export function readRuntimeSettings(file) {
  if (!fs.existsSync(file)) return {};
  return parseRuntimeSettings(fs.readFileSync(file, 'utf8'));
}

// `npm run prod:update -- [--check] [--designate-grant=<sha256>[,…] | --designate-withdraw=<sha256>[,…] | --designate-withdraw-all]`.
// A designation-only operation changes exactly the DEV2 designation record on the CT and nothing else
// (deploy/prod-update.py `designate`). Arguments carry only the action and exact digests: no path,
// host, command or setting. Errors never repeat an argument value.
export const DESIGNATION_USAGE = 'Usage: npm run prod:update -- [--check] [--designate-grant=<sha256>[,<sha256>...] | --designate-withdraw=<sha256>[,<sha256>...] | --designate-withdraw-all]';
const digestList = /^[0-9a-f]{64}(,[0-9a-f]{64})*$/;
export function parseUpdateArgs(args) {
  let check = false, designation = null;
  for (const arg of args) {
    if (arg === '--check' && !check) { check = true; continue; }
    if (designation) throw Error(DESIGNATION_USAGE);
    if (arg === '--designate-withdraw-all') { designation = { action: 'withdraw-all', candidates: [] }; continue; }
    const match = /^--designate-(grant|withdraw)=(.*)$/s.exec(arg);
    if (!match) throw Error(DESIGNATION_USAGE);
    const candidates = digestList.test(match[2]) ? match[2].split(',') : null;
    if (!candidates || new Set(candidates).size !== candidates.length || candidates.length > 32)
      throw Error('Designation candidates must be up to 32 distinct lowercase SHA-256 digests, comma-separated without spaces');
    designation = { action: match[1], candidates };
  }
  return { check, designation };
}

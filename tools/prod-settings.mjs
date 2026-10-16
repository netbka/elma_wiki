import fs from 'node:fs';
import { parseEnv } from 'node:util';

// Named non-secret runtime settings `npm run prod:update` may add or change on the production
// container. deploy/prod-update.py holds the same allowlist and is authoritative on the CT; this
// copy fails early on the operator's machine. Formats follow lib/target-presets.mjs and
// lib/native-materialization-bridge.mjs, narrowed to production use.
export const RUNTIME_SETTINGS = Object.freeze({
  WIKI_TARGET_DEV2_URL: /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/,
  WIKI_NATIVE_MATERIALIZATION_BRIDGE_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  WIKI_NATIVE_MATERIALIZATION_BRIDGE_OWNER: /^(vk|email):[0-9a-f]{64}$/,
  WIKI_NATIVE_MATERIALIZATION_REVISION: /^[0-9a-f]{40}$/,
  WIKI_NATIVE_TARGET_PROFILE_TARGET: /^dev2$/
});

// Validates the text of the private settings file. Errors name keys only, never values.
export function parseRuntimeSettings(text) {
  const settings = {};
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (!Object.hasOwn(RUNTIME_SETTINGS, key)) throw Error(`Runtime setting is not allowlisted: ${key}`);
    if (/[\r\n\0]/.test(value) || !RUNTIME_SETTINGS[key].test(value)) throw Error(`Runtime setting has an invalid format: ${key}`);
    settings[key] = value;
  }
  return settings;
}

// A missing file means no runtime setting changes.
export function readRuntimeSettings(file) {
  if (!fs.existsSync(file)) return {};
  return parseRuntimeSettings(fs.readFileSync(file, 'utf8'));
}

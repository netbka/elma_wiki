import crypto from 'node:crypto';

// Predefined Target configurations (issue #37 follow-up, PLAN-01 P8 readiness).
// Exactly two exist: shared business DEV and the owner's technical DEV2. PROD has
// none. Each is read from non-secret configuration variables; credentials stay on
// the operator-bridge machine. A missing or contradictory variable leaves that
// Target unavailable with a reason instead of guessing a host.
//
// Bridge mapping (netbka/elma365 elma-development/commands/bridge.mjs):
//   DEV  -> `elma-dev bridge --target=main-dev`
//   DEV2 -> `elma-dev bridge --target=dev2`
// The legacy bridge target `dev` historically meant dev2; it is ambiguous and refused.

export const presetOperations = ['health', 'inspect', 'export', 'readBack', 'deploy'];
const sha256 = /^[0-9a-f]{64}$/;
const definitions = [
  { id: 'preset-dev', key: 'DEV', name: 'DEV', role: 'shared-business', bridgeTarget: 'main-dev',
    maxOperations: ['health', 'inspect', 'export'] },
  { id: 'preset-dev2', key: 'DEV2', name: 'DEV2', role: 'technical', bridgeTarget: 'dev2',
    maxOperations: presetOperations }
];
export const presetIds = definitions.map(definition => definition.id);
export const hostOf = value => String(value || '').trim().toLowerCase().replace(/\.$/, '');
const list = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

function parseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return { reason: 'адрес не является URL' }; }
  if (!['https:', 'http:'].includes(url.protocol)) return { reason: 'адрес должен начинаться с https://' };
  if (url.username || url.password) return { reason: 'адрес не может содержать учётные данные' };
  return { baseUrl: url.origin, host: hostOf(url.host) };
}

function readPreset(definition, env, protectedHosts) {
  const variable = suffix => `WIKI_TARGET_${definition.key}_${suffix}`;
  const name = String(env[variable('NAME')] || '').trim().slice(0, 120) || definition.name;
  const preset = { id: definition.id, name, environmentRole: definition.role, bridgeTarget: definition.bridgeTarget,
    baseUrl: null, host: null, allowedOperations: [], designatedCandidates: [], available: false, reason: null };
  const unavailable = reason => ({ ...preset, reason });
  const rawUrl = String(env[variable('URL')] || '').trim();
  if (!rawUrl) return unavailable(`Не задан ${variable('URL')}: адрес ${definition.key} не угадывается`);
  const url = parseUrl(rawUrl);
  if (url.reason) return unavailable(`${variable('URL')}: ${url.reason}`);
  Object.assign(preset, url);
  const bridgeTarget = String(env[variable('BRIDGE_TARGET')] || definition.bridgeTarget).trim().toLowerCase();
  if (bridgeTarget === 'dev') return unavailable(`${variable('BRIDGE_TARGET')}=dev неоднозначен (исторически означал dev2); для ${definition.key} используйте ${definition.bridgeTarget}`);
  if (bridgeTarget !== definition.bridgeTarget) return unavailable(`${variable('BRIDGE_TARGET')} для ${definition.key} должен быть ${definition.bridgeTarget}`);
  const operations = env[variable('OPERATIONS')] === undefined || env[variable('OPERATIONS')] === '' ? definition.maxOperations : list(env[variable('OPERATIONS')]);
  const forbidden = operations.filter(operation => !definition.maxOperations.includes(operation));
  if (forbidden.length) return unavailable(`${variable('OPERATIONS')}: для ${definition.key} не разрешено ${forbidden.join(', ')}`);
  preset.allowedOperations = presetOperations.filter(operation => operations.includes(operation));
  // A deploy is unprovable without its pre-deploy inspection, identity health and read-back.
  if (preset.allowedOperations.includes('deploy') && !['health', 'inspect', 'readBack'].every(operation => preset.allowedOperations.includes(operation)))
    return unavailable(`${variable('OPERATIONS')}: deploy требует health, inspect и readBack`);
  if (definition.key === 'DEV2') {
    const candidates = list(env[variable('DEPLOY_CANDIDATES')]).map(value => value.toLowerCase());
    if (candidates.some(value => !sha256.test(value))) return unavailable(`${variable('DEPLOY_CANDIDATES')}: ожидаются SHA-256 кандидатов через запятую`);
    preset.designatedCandidates = [...new Set(candidates)];
  }
  if (protectedHosts.has(preset.host)) return unavailable(`${definition.key} указывает на защищённый узел (PROTECTED_TARGET_HOSTS): конфигурация отклонена`);
  return { ...preset, available: true };
}

// Returns exactly DEV then DEV2. DEV2 that shares DEV's host is a misconfiguration:
// the technical Target must never resolve to the shared business environment.
export function targetPresets(env = process.env, { protectedHosts = [] } = {}) {
  const protectedSet = new Set(protectedHosts.map(hostOf).filter(Boolean));
  const [dev, dev2] = definitions.map(definition => readPreset(definition, env, protectedSet));
  if (dev2.available && dev.host && dev2.host === dev.host)
    return [dev, { ...dev2, available: false, reason: 'DEV2 указывает на узел общего DEV: конфигурация отклонена' }];
  return [dev, dev2];
}

export const allows = (preset, operation) => !!preset?.available && preset.allowedOperations.includes(operation);

// Deploy to a predefined Target: DEV never, DEV2 only for an exact candidate the
// owner designated (bound by its SHA-256). Every other Target keeps existing guards.
export function guardPresetDeploy(preset, candidateSha256) {
  const fail = (message, statusCode = 403) => { throw Object.assign(Error(message), { statusCode }); };
  if (!preset.available) fail(`${preset.name} недоступен: ${preset.reason}`, 503);
  if (!allows(preset, 'deploy')) fail(`${preset.name} (${preset.environmentRole}) разрешает только чтение: доставка запрещена`);
  if (!preset.designatedCandidates.includes(String(candidateSha256 || '').toLowerCase()))
    fail(`${preset.name}: доставка разрешена только для кандидата, назначенного владельцем`);
}

// Each actor executes through their own bridge: pick the actor's online bridge whose
// worker reports the mapped `--target` and whose observed host equals the configured one.
export const workerTarget = worker => /→\s*([a-z0-9-]+)\s*$/i.exec(String(worker || ''))?.[1]?.toLowerCase() || null;
export const ownerKey = owner => crypto.createHash('sha256').update(String(owner)).digest('hex');

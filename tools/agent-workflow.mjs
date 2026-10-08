import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const productRoutes = [
  'docs/SOLUTION_FIRST_PRODUCT_PLAN.md',
  'docs/SOLUTION_FIRST_EXECUTION.md',
  'docs/SOLUTION_FIRST_CONTRADICTIONS.md',
];
const productBoundaries = new Set(['ui', 'domain', 'connection', 'ops']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function mapping(value, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a mapping`);
  requireValue(Object.keys(value).length > 0, `${label} must not be empty`);
}

function list(value, label) {
  requireValue(Array.isArray(value) && value.length > 0, `${label} must be a nonempty list`);
  requireValue(value.every(item => typeof item === 'string' && item.trim() === item && item.length > 0), `${label} must contain nonempty strings`);
  requireValue(new Set(value).size === value.length, `${label} contains duplicates`);
}

function repositoryPath(repositoryRoot, value) {
  requireValue(!path.isAbsolute(value) && !value.includes('\\') && !value.includes(':') && !value.split('/').some(part => part === '..' || part === '.'), `Invalid repository path: ${value}`);
  const absolute = path.resolve(repositoryRoot, value);
  requireValue(absolute.startsWith(path.resolve(repositoryRoot) + path.sep), `Path leaves repository: ${value}`);
  return absolute;
}

export function loadCapabilities(repositoryRoot = root) {
  const data = parse(fs.readFileSync(path.join(repositoryRoot, '.agent/capabilities.yaml'), 'utf8'));
  requireValue(data?.version === 1, 'Unsupported capability router version');
  mapping(data.classification?.intents, 'classification.intents');
  mapping(data.classification?.boundaries, 'classification.boundaries');
  mapping(data.capabilities, 'capabilities');
  for (const [label, values] of Object.entries(data.classification)) {
    for (const [name, description] of Object.entries(values)) {
      requireValue(typeof description === 'string' && description.trim().length > 0, `${label}.${name} needs a description`);
    }
  }
  for (const [name, capability] of Object.entries(data.capabilities)) {
    requireValue(/^[a-z][a-z0-9-]*$/.test(name), `Invalid capability name: ${name}`);
    for (const field of ['owners', 'routes', 'boundaries']) list(capability?.[field], `${name}.${field}`);
    for (const boundary of capability.boundaries) {
      requireValue(Object.hasOwn(data.classification.boundaries, boundary), `${name}: unknown boundary ${boundary}`);
    }
    for (const field of ['owners', 'routes']) {
      for (const entry of capability[field]) {
        const absolute = repositoryPath(repositoryRoot, entry);
        requireValue(fs.existsSync(absolute), `${name}.${field}: missing ${entry}`);
        const real = fs.realpathSync(absolute);
        requireValue(real.startsWith(fs.realpathSync(repositoryRoot) + path.sep), `${name}.${field}: path leaves repository ${entry}`);
        const stat = fs.statSync(absolute);
        requireValue(field === 'routes' ? stat.isFile() : entry.endsWith('/') ? stat.isDirectory() : stat.isFile(), `${name}.${field}: wrong path type ${entry}`);
      }
    }
  }
  const agent = data.capabilities['agent-system'];
  requireValue(agent && productRoutes.every(route => agent.routes.includes(route)), 'agent-system must route to the current product, execution and contradiction contracts');
  return data;
}

export function taskContext(data, intent, capabilities) {
  requireValue(Object.hasOwn(data.classification.intents, intent), `Unknown intent: ${intent}`);
  list(capabilities, 'Selected capabilities');
  for (const name of capabilities) requireValue(Object.hasOwn(data.capabilities, name), `Unknown capability: ${name}`);
  const boundaries = [...new Set(capabilities.flatMap(name => data.capabilities[name].boundaries))];
  const routes = ['AGENTS.md', '.agent/capabilities.yaml', 'docs/workflows/agent-execution.md'];
  if (boundaries.some(boundary => productBoundaries.has(boundary))) routes.push(...productRoutes);
  routes.push(...capabilities.flatMap(name => data.capabilities[name].routes));
  return { intent, capabilities, boundaries, routes: [...new Set(routes)] };
}

export function run(args, repositoryRoot = root) {
  const data = loadCapabilities(repositoryRoot);
  if (args.length === 1 && args[0] === '--check') {
    return `Capability router verified: ${Object.keys(data.capabilities).length} capabilities; current authority and all owner/contract paths exist.`;
  }
  if (args.length === 1 && args[0] === '--list') {
    return `Intents: ${Object.keys(data.classification.intents).join(', ')}\nCapabilities: ${Object.keys(data.capabilities).join(', ')}`;
  }
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    return 'Usage: npm run agent:context -- <intent> <capability> [capability...]\n       npm run agent:context -- --list\n       npm run check:agent';
  }
  const context = taskContext(data, args[0], args.slice(1));
  return [
    `Phase: ${context.intent}`, `Capabilities: ${context.capabilities.join(', ')}`,
    `Boundaries to assess: ${context.boundaries.join(', ')}`,
    'Read:', ...context.routes.map(route => `  ${route}`),
    'Before edits: inspect worktrees/ignored artifacts, refresh origin, inspect open PRs and overlapping work.',
    'Record the assigned outcome, actually crossed boundaries, base/head and proportional verification in the PR template.',
    'For an implementation assignment, continue through change and focused verification; finish with evidence or a concrete blocker.',
    'This command selects context only. It does not authorize scope, execute checks, clean worktrees, merge, deploy or establish acceptance.',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run(process.argv.slice(2))); }
  catch (error) { console.error(`Agent workflow: ${error.message}`); process.exitCode = 1; }
}

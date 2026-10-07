import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Local replica of the ELMA365 widget-script compiler.
 *
 * ELMA365 compiles widget/form scripts in its `worker` service
 * (image `elma365/serv_worker/worker`, Node + `typescript`), module
 * `dist/worker/compile/{compiler.builder,compiler.host,compiler.options,
 * script.explorer}.js`. The Designer's «Проверить»/«Опубликовать» and the
 * exchange importer send the TypeScript source there over RabbitMQ and get
 * back `runtime.{client,server}Scripts` (JS) + `*FnDeclarations`. This module
 * reproduces that pipeline step by step, with the same TypeScript version
 * (pinned in package.json — bump it together with the server), the same
 * compiler options, the same wrapper and the same transpile settings, so the
 * output follows the researched worker contract. Ported from netbka/elma365
 * lib/widget-compiler.mjs at revision 539bae085d2645a4a75f5044bfc5acf39b86908a.
 * See docs/COMPILER_PROFILE.md for provenance and verification limits.
 *
 * Nothing here talks to a server. The only server-provided input is the
 * context `.d.ts` (see widget-dts.mjs) used for type-checking.
 */

const require = createRequire(import.meta.url);
const ts = require('typescript/lib/typescript');
const tsLibDir = path.dirname(require.resolve('typescript'));

/** worker: compile/compiler.options.js — single source of truth for target. */
export const compilerTarget = ts.ScriptTarget.ES2018;

/** worker: compile/compiler.options.js — options for createProgram() (type-check). */
export const defaultCompilerOptions = {
  outDir: './dist',
  allowJs: true,
  checkJs: false,
  declaration: false,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  noImplicitAny: true,
  strictNullChecks: true,
  stripInternal: true,
  skipDefaultLibCheck: true,
  skipLibCheck: true,
  target: compilerTarget,
  lib: ['lib.es2018.d.ts'],
};

/** worker: compile/compiler.factory.js — fixed virtual file names. */
export const SCRIPT_FILE = 'script.ts';
export const DTS_FILE = 'elma365.d.ts';
export const ADDITIONAL_DTS_FILE = '/node_modules/@types/additional.d.ts';
export const ADDITIONAL_SERVER_DTS_FILE = '/node_modules/@types/additional_server.d.ts';

export const typescriptVersion = ts.version;

// --- CompilerHost (worker: compile/compiler.host.js) ------------------------

const libDiskCache = new Map();
const libSourceFileCache = new Map();

function readLibFromDisk(filename) {
  if (libDiskCache.has(filename)) return libDiskCache.get(filename);
  // Only TypeScript's own lib.*.d.ts files are readable; everything else the
  // program asks for (node_modules/@typescript/*, etc.) does not exist.
  if (!/^lib\.[a-z0-9.]+\.d\.ts$/i.test(filename)) return undefined;
  let content;
  try {
    content = fs.readFileSync(path.join(tsLibDir, filename), 'utf8');
  } catch {
    content = undefined;
  }
  libDiskCache.set(filename, content);
  return content;
}

function makeHost(files, options) {
  const has = (f) => Object.prototype.hasOwnProperty.call(files, f);
  return {
    getSourceFile(filename) {
      if (has(filename)) return ts.createSourceFile(filename, files[filename], options.target, false);
      if (libSourceFileCache.has(filename)) return libSourceFileCache.get(filename);
      const content = readLibFromDisk(filename);
      if (content === undefined) return undefined;
      const sf = ts.createSourceFile(filename, content, options.target, false);
      libSourceFileCache.set(filename, sf);
      return sf;
    },
    writeFile() {},
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '',
    getNewLine: () => '\n',
    getDefaultLibFileName: () => ts.getDefaultLibFileName(options),
    getDirectories: () => [],
    directoryExists: () => false,
    fileExists: (f) => has(f) || readLibFromDisk(f) !== undefined,
    readFile: (f) => (has(f) ? files[f] : readLibFromDisk(f)),
  };
}

// --- ScriptExplorer (worker: compile/script.explorer.js) --------------------

function flattenMessage(message) {
  if (message == null) return '';
  if (typeof message === 'string') return message;
  let text = message.messageText;
  const walk = (chain) => {
    let t = '';
    if (chain) for (const c of chain) t += ' -> ' + c.messageText + walk(c.next);
    return t;
  };
  return text + walk(message.next);
}

function diagnosticsOf(program) {
  return [
    ...program.getDeclarationDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ].map((err) => ({
    filename: err.file?.fileName,
    code: err.code,
    message: flattenMessage(err.messageText),
    // 0-based, like ts.getLineAndCharacterOfPosition (what the server reports)
    position: err.file && err.start !== undefined ? err.file.getLineAndCharacterOfPosition(err.start) : undefined,
    errorPart: err.file && err.start !== undefined ? err.file.text.substr(err.start, err.length) : undefined,
  }));
}

function importRanges(sourceFile) {
  return sourceFile.statements
    .filter((s) => s.kind === ts.SyntaxKind.ImportDeclaration)
    .map((s) => [s.pos, s.end]);
}

/**
 * Top-level function declarations, in the exact shape the server stores in
 * runtime.*FnDeclarations. The server calls `.toString()` on TypeScript AST
 * nodes for `parameters[].name/type` and `type`, which yields the literal
 * string "[object Object]"; missing nodes come back as "" after the Go side
 * re-marshals them. Both quirks are reproduced on purpose so our output is
 * byte-identical to a Designer publish — do not "fix" them here.
 */
function functionDeclarations(sourceFile) {
  return sourceFile.statements
    .filter((s) => s.kind === ts.SyntaxKind.FunctionDeclaration)
    .map((f) => ({
      name: f.name ? f.name.escapedText.toString() : '',
      parameters: f.parameters.map((p) => ({
        name: p.name?.toString() ?? '',
        type: p.type?.toString() ?? '',
      })),
      type: f.type?.toString() ?? '',
    }));
}

// --- CompilerBuilder (worker: compile/compiler.builder.js) ------------------

function moduleKindFor(runtime) {
  return runtime === 'client' ? ts.ModuleKind.System : ts.ModuleKind.None;
}

/** Client scripts are wrapped into a default-exported factory before transpile. */
function wrapClient(text, sourceFile) {
  const imports = importRanges(sourceFile);
  const importClauses = imports.map(([pos, end]) => text.slice(pos, end)).join('\n');
  const textWoImports = [...imports].reverse().reduce((res, [pos, end]) => res.slice(0, pos) + res.slice(end), text);
  const functions = functionDeclarations(sourceFile).map((d) => d.name).join(',\n');
  return `${importClauses}
export default function(Context, ViewContext, Server, System): any {
    ${textWoImports}
    return {
        ${functions}
    };
}`;
}

function transpile(script, runtime) {
  return ts.transpile(script, {
    module: moduleKindFor(runtime),
    target: compilerTarget,
    removeComments: true,
  });
}

/**
 * Compile one script the way the ELMA365 worker does.
 *
 * @param {object} p
 * @param {string} p.source   TypeScript source (descriptor.clientScripts / serverScripts)
 * @param {'client'|'server'} p.runtime
 * @param {string} [p.dts]    full context .d.ts for this widget+runtime (from
 *                            widget-dts.mjs). When omitted, no type-check is
 *                            performed — only wrap+transpile (emit).
 * @param {string} [p.additionalDts]  client-side external library typings
 *                            (worker: request.additionalDTS)
 * @param {string} [p.serverDependencyDts]  server-side external dependency
 *                            typings (worker: scriptDependency)
 * @returns {{ ok: boolean, errors: Array, scripts?: string, fnDeclarations?: Array, typeChecked: boolean }}
 */
export function compileScript({ source, runtime, dts, additionalDts, serverDependencyDts }) {
  if (runtime !== 'client' && runtime !== 'server') throw new Error(`runtime must be client|server, got ${runtime}`);
  const text = source ?? '';

  let typeChecked = false;
  if (dts !== undefined) {
    const files = { [DTS_FILE]: dts, [SCRIPT_FILE]: text };
    if (additionalDts) files[ADDITIONAL_DTS_FILE] = additionalDts;
    if (serverDependencyDts) files[ADDITIONAL_SERVER_DTS_FILE] = serverDependencyDts;
    const program = ts.createProgram(Object.keys(files), defaultCompilerOptions, makeHost(files, defaultCompilerOptions));
    const errors = diagnosticsOf(program);
    typeChecked = true;
    if (errors.length) return { ok: false, errors, typeChecked };
  }

  const sourceFile = ts.createSourceFile(SCRIPT_FILE, text, compilerTarget, false);
  const fnDeclarations = functionDeclarations(sourceFile);
  let scripts = transpile(runtime === 'client' ? wrapClient(text, sourceFile) : text, runtime);
  // worker: compiler.factory.js — "костыль, нужный для возможности экспорта
  // виджетов (см. TEAM-26395)": an empty result is stored as "/**/".
  if (scripts === '') scripts = '/**/';
  return { ok: true, errors: [], scripts, fnDeclarations, typeChecked };
}

/** Human-readable one-liner per compile error, like the Designer's error list. */
export function formatCompileError(e, label) {
  const pos = e.position ? `${e.position.line + 1}:${e.position.character + 1}` : '';
  const where = [e.filename, pos].filter(Boolean).join(':');
  return `[${label}] ${where} TS${e.code} ${e.message}`.trim();
}

/** Strip a UTF-8 BOM (editors on Windows love to add one; the Designer never does). */
export function stripBom(text) {
  return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

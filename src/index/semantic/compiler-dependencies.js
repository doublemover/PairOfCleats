import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadTypeScript, getTypeScriptLoadReceipt } from '../tooling/typescript/load.js';
import { createDefaultCompilerOptions, resolveTsconfigOverride, findNearestConfig, parseTsConfig } from '../tooling/typescript/config.js';
import { canonicalSemanticJson, semanticHash } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

export const COMPILER_DEPENDENCY_KEY = 'semantic.compiler.dependency-inventory.v1';
const methods = ['readFile', 'fileExists', 'directoryExists', 'getDirectories', 'readDirectory', 'realpath'];
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
const argsKey = (method, args) => {
  const normalized = args.map(value => value === undefined ? null : value);
  while (normalized.length && normalized.at(-1) === null) normalized.pop();
  if (typeof normalized[0] === 'string') normalized[0] = process.platform === 'win32' ? path.resolve(normalized[0]).toLowerCase() : path.resolve(normalized[0]);
  return canonicalSemanticJson({ method, args: normalized });
};
const resultKey = (method, result) => method === 'readFile' ? (result === undefined ? null : digest(result)) : result ?? null;
export const compilerInventoryHash = inventory => semanticHash(COMPILER_DEPENDENCY_KEY, inventory);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const assertCompilerDependencyInventory = inventory => {
  if (!exactKeys(inventory, ['schemaVersion', 'compilerVersion', 'compilerFile', 'compilerReceipt', 'repoRoot', 'sourceInputs', 'toolingHash', 'files', 'groups', 'observations'])
    || inventory.schemaVersion !== 1 || !exactKeys(inventory.compilerReceipt, ['filename', 'hash'])
    || ![inventory.compilerVersion, inventory.compilerFile, inventory.repoRoot, inventory.compilerReceipt.filename].every(value => typeof value === 'string' && value.length)
    || ![inventory.toolingHash, inventory.compilerReceipt.hash].every(value => /^[a-f0-9]{64}$/.test(value))
    || !Array.isArray(inventory.files) || !inventory.files.every(value => typeof value === 'string')
    || !Array.isArray(inventory.sourceInputs) || !inventory.sourceInputs.every(row => exactKeys(row, ['path', 'sourceUnitId', 'byteHash', 'textHash'])
      && typeof row.path === 'string' && /^su1:[a-f0-9]{64}$/.test(row.sourceUnitId) && [row.byteHash, row.textHash].every(value => /^[a-f0-9]{64}$/.test(value)))
    || !Array.isArray(inventory.groups) || !inventory.groups.every(row => exactKeys(row, ['configPath', 'options', 'rootNames'])
      && (row.configPath === null || typeof row.configPath === 'string') && row.options && typeof row.options === 'object' && !Array.isArray(row.options)
      && Array.isArray(row.rootNames) && row.rootNames.every(value => typeof value === 'string'))
    || !Array.isArray(inventory.observations) || inventory.observations.length > 100000) throw fail('Malformed compiler dependency inventory.');
  for (const row of inventory.observations) {
    if (!exactKeys(row, ['method', 'args', 'result']) || !methods.includes(row.method) || !Array.isArray(row.args)
      || !row.args.length || typeof row.args[0] !== 'string' || row.args.length > 5) throw fail('Malformed compiler dependency probe.');
    const valid = row.method === 'readFile' ? row.result === null || typeof row.result === 'string' && /^[a-f0-9]{64}$/.test(row.result)
      : ['fileExists', 'directoryExists'].includes(row.method) ? typeof row.result === 'boolean'
        : row.method === 'realpath' ? typeof row.result === 'string'
          : Array.isArray(row.result) && row.result.every(value => typeof value === 'string');
    if (!valid) throw fail('Malformed compiler dependency result.');
  }
  canonicalSemanticJson(inventory);
  return inventory;
};


/** A closed read authority. Unknown probes fail rather than change module resolution silently. */
export const createCompilerDependencySystem = ({ ts, inventory = null, signal = null }) => {
  const observations = new Map();
  for (const row of inventory?.observations || []) {
    const key = argsKey(row.method, row.args), previous = observations.get(key);
    if (previous && canonicalSemanticJson(previous.result) !== canonicalSemanticJson(row.result)) throw fail('Conflicting sealed compiler observations.');
    observations.set(key, row);
  }
  let bytes = 0;
  const system = { ...ts.sys };
  for (const method of methods) if (typeof ts.sys[method] === 'function') system[method] = (...args) => {
    throwIfAborted(signal);
    const key = argsKey(method, args), expected = observations.get(key);
    if (inventory && !expected) throw fail(`Compiler ${method} probe was not sealed: ${String(args[0])}`);
    const result = ts.sys[method](...args), observed = resultKey(method, result);
    if (expected && canonicalSemanticJson(expected.result) !== canonicalSemanticJson(observed)) throw fail(`Compiler dependency changed: ${String(args[0])}`);
    if (!expected) {
      bytes += method === 'readFile' && typeof result === 'string' ? Buffer.byteLength(result) : 0;
      if (observations.size >= 100000 || bytes > 256 * 1024 * 1024) throw fail('Compiler dependency preflight allowance exhausted.');
      observations.set(key, { method, args: JSON.parse(key).args, result: observed });
    }
    return result;
  };
  return { system, observations };
};

/** Reuse TypeScript configuration and resolver APIs; never construct a second Program. */
export const collectCompilerDependencyInventory = async ({ repoRoot, toolingConfig, files, sourceInputs = [], signal }) => {
  const ts = await loadTypeScript(toolingConfig, repoRoot);
  if (!ts) throw fail('TypeScript dependency preflight is unavailable.');
  const { system, observations } = createCompilerDependencySystem({ ts, signal });
  const log = () => {}, config = toolingConfig?.typescript || {}, cache = new Map(), configs = new Map();
  const override = resolveTsconfigOverride(repoRoot, toolingConfig, log, system);
  for (const file of [...new Set(files)].sort()) {
    const absolute = path.resolve(repoRoot, file);
    const selected = override || (config.useTsconfig === false ? null : findNearestConfig(path.dirname(absolute), repoRoot, cache, ts.sys.useCaseSensitiveFileNames, system));
    const list = configs.get(selected) || []; list.push(absolute); configs.set(selected, list);
  }
  const compilerReceipt = getTypeScriptLoadReceipt(ts);
  if (!compilerReceipt) throw fail('Compiler load receipt is unavailable.');
  const compilerFile = compilerReceipt.filename;
  if (system.readFile(compilerFile) === undefined) throw fail('Compiler implementation identity is unavailable.');
  const groups = [];
  for (const [configPath, roots] of configs) {
    const parsed = parseTsConfig(ts, configPath, log, system), defaults = createDefaultCompilerOptions(ts, config);
    const options = { ...defaults, ...parsed?.options, allowJs: defaults.allowJs, checkJs: defaults.checkJs };
    const rootNames = [...new Set([...(parsed?.fileNames || []), ...roots])].sort();
    const queue = [...rootNames], seen = new Set(), host = { ...system, getCurrentDirectory: () => process.cwd() };
    const libDirectory = path.dirname(ts.getDefaultLibFilePath(options));
    const addLib = lib => {
      if (!ts.resolveLibrary || !ts.getLibraryNameFromLibFileName || !ts.getInferredLibraryNameResolveFrom) throw fail('Compiler library preflight API unavailable.');
      const resolved = ts.resolveLibrary(ts.getLibraryNameFromLibFileName(lib), ts.getInferredLibraryNameResolveFrom(options, process.cwd(), lib), options, host).resolvedModule;
      queue.push(resolved?.resolvedFileName || path.join(libDirectory, lib));
    };
    if (!options.noLib) for (const lib of options.lib || [path.basename(ts.getDefaultLibFilePath(options))]) addLib(lib);
    const addType = (name, containing) => {
      const resolved = ts.resolveTypeReferenceDirective(name, containing, options, host).resolvedTypeReferenceDirective;
      if (resolved) queue.push(resolved.resolvedFileName);
    };
    for (const name of ts.getAutomaticTypeDirectiveNames(options, host)) addType(name, path.join(options.configFilePath ? path.dirname(options.configFilePath) : process.cwd(), '__inferred type names__.ts'));
    for (let position = 0; position < queue.length; position++) {
      throwIfAborted(signal);
      const file = path.resolve(queue[position]);
      if (seen.has(file)) continue;
      seen.add(file);
      if (seen.size > 50000) throw fail('Compiler source closure exceeds its preflight allowance.');
      for (let directory = path.dirname(file);;) {
        system.directoryExists(directory);
        const packageFile = path.join(directory, 'package.json');
        if (system.fileExists(packageFile)) system.readFile(packageFile);
        const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
      }
      system.fileExists(file);
      if (system.realpath && system.fileExists(file)) system.realpath(file);
      const text = system.readFile(file);
      if (text === undefined) continue;
      const info = ts.preProcessFile(text, true, true);
      for (const item of info.importedFiles) {
        const resolved = ts.resolveModuleName(item.fileName, file, options, host).resolvedModule;
        if (resolved) queue.push(resolved.resolvedFileName);
      }
      for (const item of info.referencedFiles) queue.push(path.resolve(path.dirname(file), item.fileName));
      for (const item of info.typeReferenceDirectives) addType(item.fileName, file);
      for (const item of info.libReferenceDirectives) addLib('lib.' + item.fileName.toLowerCase() + '.d.ts');
    }
    groups.push({ configPath, options: JSON.parse(JSON.stringify(options)), rootNames });
  }
  const inventory = { schemaVersion: 1, compilerVersion: ts.version, compilerFile, compilerReceipt, repoRoot: path.resolve(repoRoot),
    sourceInputs: [...sourceInputs].sort((a,b) => a.path.localeCompare(b.path)), toolingHash: semanticHash('semantic.compiler.tooling.v1', toolingConfig), files: [...new Set(files)].sort(), groups,
    observations: [...observations.values()].sort((a, b) => argsKey(a.method, a.args).localeCompare(argsKey(b.method, b.args))) };
  if (Buffer.byteLength(canonicalSemanticJson(inventory)) > 24 * 1024 * 1024) throw fail('Compiler dependency descriptor exceeds its allowance.');
  return assertCompilerDependencyInventory(inventory);
};

export const assertCompilerTaskAuthority = (task, target) => {
  const dependencies = task.dependencies.filter(row => row.dependencyKey === COMPILER_DEPENDENCY_KEY);
  if (target.compilerInventory) {
    assertCompilerDependencyInventory(target.compilerInventory);
    if (task.kind !== 'bind' || dependencies.length !== 1 || dependencies[0].expectedHash !== compilerInventoryHash(target.compilerInventory)) throw fail('Task dependency authority hash mismatch.');
  } else if (dependencies.length) throw fail('Task dependency authority is missing.');
};

export const verifyCompilerDependencyInventory = async ({ inventory, repoRoot, toolingConfig, signal }) => {
  assertCompilerDependencyInventory(inventory);
  if (!inventory || inventory.schemaVersion !== 1 || inventory.repoRoot !== path.resolve(repoRoot)
    || inventory.toolingHash !== semanticHash('semantic.compiler.tooling.v1', toolingConfig)
    || !Array.isArray(inventory.observations) || inventory.observations.length > 100000) throw fail('Compiler dependency authority identity mismatch.');
  const ts = await loadTypeScript(toolingConfig, repoRoot);
  if (!ts || ts.version !== inventory.compilerVersion || canonicalSemanticJson(getTypeScriptLoadReceipt(ts)) !== canonicalSemanticJson(inventory.compilerReceipt)) throw fail('Compiler version changed.');
  const { system } = createCompilerDependencySystem({ ts, inventory, signal });
  for (const row of inventory.observations) {
    if (!methods.includes(row.method) || typeof system[row.method] !== 'function' || !Array.isArray(row.args)) throw fail('Invalid compiler dependency observation.');
    system[row.method](...row.args.map(value => value === null ? undefined : value));
  }
  return { ts, system, authorityHash: compilerInventoryHash(inventory) };
};

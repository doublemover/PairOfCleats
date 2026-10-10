import { createVirtualCompilerHost } from '../tooling/typescript/host.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadTypeScript, getTypeScriptLoadReceipt } from '../tooling/typescript/load.js';
import { selectTypeScriptDocuments, createDefaultCompilerOptions, resolveTsconfigOverride, findNearestConfig, parseTsConfig } from '../tooling/typescript/config.js';
import { canonicalSemanticJson, semanticHash } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

export const COMPILER_DEPENDENCY_KEY = 'semantic.compiler.dependency-inventory.v1';
const methods = ['readFile', 'fileExists', 'directoryExists', 'getDirectories', 'readDirectory', 'realpath'];
const pathIdentity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
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
  if (!exactKeys(inventory, ['schemaVersion', 'compilerVersion', 'compilerFile', 'compilerReceipt', 'repoRoot', 'sourceInputs', 'virtualInputs', 'toolingHash', 'files', 'groups', 'observations'])
    || inventory.schemaVersion !== 1 || !exactKeys(inventory.compilerReceipt, ['filename', 'hash'])
    || ![inventory.compilerVersion, inventory.compilerFile, inventory.repoRoot, inventory.compilerReceipt.filename].every(value => typeof value === 'string' && value.length)
    || ![inventory.toolingHash, inventory.compilerReceipt.hash].every(value => /^[a-f0-9]{64}$/.test(value))
    || !Array.isArray(inventory.virtualInputs) || !inventory.virtualInputs.every(row => exactKeys(row, ['virtualPath', 'containerPath', 'segmentUid', 'sourceUnitId', 'sourceHash', 'textHash', 'parentSourceUnitId', 'parentByteHash', 'mappingIdentity', 'mappingQuality'])
      && typeof row.virtualPath === 'string' && typeof row.containerPath === 'string' &&  /^[a-f0-9]{64}$/.test(row.textHash)
      && [row.sourceUnitId,row.parentSourceUnitId].every(value => value === null || /^su1:[a-f0-9]{64}$/.test(value))
      && [row.sourceHash,row.parentByteHash,row.mappingIdentity].every(value => value === null || /^[a-f0-9]{64}$/.test(value))
      && (row.segmentUid === null || typeof row.segmentUid === 'string')
      && ['exact', 'coarse', 'synthetic', 'unmapped'].includes(row.mappingQuality))
    || !Array.isArray(inventory.files) || !inventory.files.every(value => typeof value === 'string')
    || !Array.isArray(inventory.sourceInputs) || !inventory.sourceInputs.every(row => exactKeys(row, ['path', 'sourceUnitId', 'byteHash', 'textHash'])
      && typeof row.path === 'string' && /^su1:[a-f0-9]{64}$/.test(row.sourceUnitId) && [row.byteHash, row.textHash].every(value => /^[a-f0-9]{64}$/.test(value)))
    || !Array.isArray(inventory.groups) || !inventory.groups.every(row => exactKeys(row, ['configPath', 'options', 'rootNames', 'projectReferences'])
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
export const collectCompilerDependencyInventory = async ({ repoRoot, toolingConfig, files, sourceInputs = [], documents = [], signal }) => {
  const ts = await loadTypeScript(toolingConfig, repoRoot);
  if (!ts) throw fail('TypeScript dependency preflight is unavailable.');
  const { system, observations } = createCompilerDependencySystem({ ts, signal });
  const log = () => {}, config = toolingConfig?.typescript || {}, cache = new Map(), configs = new Map();
  const override = resolveTsconfigOverride(repoRoot, toolingConfig, log, system);
  const rootDocs = selectTypeScriptDocuments(documents, config);
  const fallback = files.map(file => ({ virtualPath: file, containerPath: file, text: null, segmentUid: null }));
  for (const doc of rootDocs.length ? rootDocs : fallback) {
    const absolute = path.resolve(repoRoot, doc.containerPath || doc.virtualPath);
    const selected = override || (config.useTsconfig === false ? null : findNearestConfig(path.dirname(absolute), repoRoot, cache, ts.sys.useCaseSensitiveFileNames, system));
    const list = configs.get(selected) || []; list.push(doc); configs.set(selected, list);
  }
  const compilerReceipt = getTypeScriptLoadReceipt(ts);
  if (!compilerReceipt) throw fail('Compiler load receipt is unavailable.');
  const compilerFile = compilerReceipt.filename;
  if (system.readFile(compilerFile) === undefined) throw fail('Compiler implementation identity is unavailable.');
  const groups = [];
  for (const [configPath, docs] of configs) {
    const parsed = parseTsConfig(ts, configPath, log, system), defaults = createDefaultCompilerOptions(ts, config);
    const options = { ...defaults, ...parsed?.options, allowJs: defaults.allowJs, checkJs: defaults.checkJs };
    const roots = docs.map(doc => path.resolve(repoRoot,doc.virtualPath));
    const rootNames = [...new Set([...(parsed?.fileNames || []), ...roots])].sort();
    const key = file => ts.sys.useCaseSensitiveFileNames ? path.resolve(file) : path.resolve(file).toLowerCase();
    const vfs = new Map(), sourcePaths = new Map(), origins = new Map();
    for (const doc of docs) if (typeof doc.text === 'string') {
      const virtual = key(path.resolve(repoRoot,doc.virtualPath)); vfs.set(virtual,doc.text);
      const container = path.resolve(repoRoot,doc.containerPath || doc.virtualPath); origins.set(virtual,container);
      if (!doc.segmentUid) sourcePaths.set(virtual,container);
    }
    const host = createVirtualCompilerHost(ts, options, vfs, sourcePaths, origins, system);
    const queue = [...rootNames], seen = new Set();
    const references = [...(parsed?.projectReferences || [])], seenConfigs = new Set();
    for (let index = 0; index < references.length; index++) {
      const reference = references[index];
      const filename = ts.resolveProjectReferencePath(reference);
      if (seenConfigs.has(filename)) continue;
      seenConfigs.add(filename); if (seenConfigs.size > 4096) throw fail('Project reference inventory exceeds its allowance.');
      system.fileExists(filename);
      const project = parseTsConfig(ts,filename,log,system);
      if (project) { queue.push(...project.fileNames); references.push(...(project.projectReferences || [])); }
    }
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
      host.fileExists(file);
      if (system.realpath && !vfs.has(key(file)) && system.fileExists(file)) system.realpath(file);
      const text = host.readFile(file);
      if (text === undefined) continue;
      const info = ts.preProcessFile(text, true, true);
      for (const item of info.importedFiles) {
        const resolved = host.resolveModuleNames([item.fileName], file)[0];
        if (resolved) queue.push(resolved.resolvedFileName);
      }
      for (const item of info.referencedFiles) queue.push(path.resolve(path.dirname(file), item.fileName));
      for (const item of info.typeReferenceDirectives) addType(item.fileName, file);
      for (const item of info.libReferenceDirectives) addLib('lib.' + item.fileName.toLowerCase() + '.d.ts');
    }
    groups.push({ configPath, options: JSON.parse(JSON.stringify(options)), rootNames, projectReferences: parsed?.projectReferences ? JSON.parse(JSON.stringify(parsed.projectReferences)) : null });
  }
  const inventory = { schemaVersion: 1, compilerVersion: ts.version, compilerFile, compilerReceipt, repoRoot: path.resolve(repoRoot),
    virtualInputs: rootDocs.map(doc => doc.authority).sort((a,b) => a.virtualPath < b.virtualPath ? -1 : a.virtualPath > b.virtualPath ? 1 : 0),
    sourceInputs: [...sourceInputs].sort((a,b) => a.path.localeCompare(b.path)), toolingHash: semanticHash('semantic.compiler.tooling.v1', toolingConfig), files: [...new Set(files)].sort(), groups,
    observations: [...observations.values()].sort((a, b) => argsKey(a.method, a.args).localeCompare(argsKey(b.method, b.args))) };
  if (Buffer.byteLength(canonicalSemanticJson(inventory)) > 24 * 1024 * 1024) throw fail('Compiler dependency descriptor exceeds its allowance.');
  return assertCompilerDependencyInventory(inventory);
};

export const assertCompilerTaskAuthority = (task, target) => {
  const dependencies = task.dependencies.filter(row => row.dependencyKey === COMPILER_DEPENDENCY_KEY);
  if (target.compilerInventory) {
    assertCompilerDependencyInventory(target.compilerInventory);
    if (!['bind', 'localFlow', 'crossFileFlow'].includes(task.kind) || dependencies.length !== 1 || dependencies[0].expectedHash !== compilerInventoryHash(target.compilerInventory)) throw fail('Task dependency authority hash mismatch.');
  } else if (dependencies.length) throw fail('Task dependency authority is missing.');
};

export const verifyCompilerDependencyInventory = async ({ inventory, repoRoot, toolingConfig, signal }) => {
  assertCompilerDependencyInventory(inventory);
  if (!inventory || inventory.schemaVersion !== 1 || pathIdentity(inventory.repoRoot) !== pathIdentity(repoRoot)
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

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isRepoTrusted } from '../../../shared/config-authority.js';
import { assertTypeScriptCompatibility } from './compatibility.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

export const DEFAULT_TYPESCRIPT_RESOLVE_ORDER = Object.freeze(['repo', 'cache', 'global']);

const globalRequire = createRequire(import.meta.url);
const syncTypeScriptCache = new Map();
const compilerLoadReceipts = new WeakMap();
const preserveCompilerFailure = error => {
  observeStorageResource(error, { phase: 'typescript-compiler-load' }).requireSettled();
  throw error;
};
const hasFailureCode = (error, codes) => codes.includes(observeStorageResource(error,
  { phase: 'typescript-compiler-resolution' }).read('code'));
const compilerEntryExists = filename => {
  try {
    if (!fsSync.statSync(filename).isFile()) throw Object.assign(new Error('Selected TypeScript compiler entry is not a regular file: ' + filename),
      { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED', reason: 'typescript_compiler_entry_invalid', source: filename });
    return true;
  } catch (error) {
    if (!hasFailureCode(error, ['ENOENT'])) return preserveCompilerFailure(error);
    const packageRoot = path.dirname(path.dirname(filename));
    try { fsSync.statSync(packageRoot); }
    catch (missing) { if (hasFailureCode(missing, ['ENOENT'])) return false; return preserveCompilerFailure(missing); }
    throw Object.assign(new Error('Installed TypeScript at ' + packageRoot + ' has no compatible lib/typescript.js entry. Native API packages need their distinct adapter; select a compatible programmatic compiler or change tooling.typescript.resolveOrder.'),
      { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED', reason: 'typescript_compiler_entry_missing', source: filename, cause: error });
  }
};
const moduleHash = filename => createHash('sha256').update(fsSync.readFileSync(filename)).digest('hex');
const loadCompilerWithReceipt = async url => {
  const filename = fsSync.realpathSync(fileURLToPath(url)), before = moduleHash(filename);
  const mod = await import(url), compiler = mod?.default || mod;
  const after = moduleHash(filename), previous = compilerLoadReceipts.get(compiler);
  if (before !== after || previous && (previous.filename !== filename || previous.hash !== after)) {
    throw Object.assign(new Error('Loaded TypeScript module identity changed; restart the indexing process.'), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
  }
  assertTypeScriptCompatibility(compiler, filename);
  compilerLoadReceipts.set(compiler, { filename, hash: after });
  return compiler;
};
const recordSyncReceipt = (compiler, filename, before) => {
  const hash = moduleHash(filename), previous = compilerLoadReceipts.get(compiler);
  if (before !== hash || previous && (previous.filename !== filename || previous.hash !== hash)) throw Object.assign(new Error('Loaded TypeScript changed; restart indexing.'), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
  assertTypeScriptCompatibility(compiler, filename);
  compilerLoadReceipts.set(compiler, { filename, hash });
};
export const getTypeScriptLoadReceipt = compiler => compilerLoadReceipts.get(compiler) || null;


const resolveTypeScriptLookup = (repoRoot, toolingRoot) => ({
  repo: repoRoot ? path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js') : null,
  cache: toolingRoot ? path.join(toolingRoot, 'node', 'node_modules', 'typescript', 'lib', 'typescript.js') : null,
  tooling: toolingRoot ? path.join(toolingRoot, 'node', 'node_modules', 'typescript', 'lib', 'typescript.js') : null
});

export const resolveTypeScriptResolveOrder = (toolingConfig) => {
  const order = Array.isArray(toolingConfig?.typescript?.resolveOrder)
    ? toolingConfig.typescript.resolveOrder
    : DEFAULT_TYPESCRIPT_RESOLVE_ORDER;
  return order
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
};

export async function loadTypeScript(toolingConfig, repoRoot) {
  if (toolingConfig?.typescript?.enabled === false) return null;
  const toolingRoot = toolingConfig?.dir || '';
  const resolveOrder = resolveTypeScriptResolveOrder(toolingConfig);
  const lookup = resolveTypeScriptLookup(repoRoot, toolingRoot);

  for (const key of resolveOrder) {
    if (key === 'repo' && !isRepoTrusted(repoRoot)) continue;
    if (key === 'global') {
      let resolved;
      try {
        resolved = import.meta.resolve('typescript');
      } catch (error) {
        if (hasFailureCode(error, ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])) continue;
        return preserveCompilerFailure(error);
      }
      try { return await loadCompilerWithReceipt(resolved); }
      catch (error) { return preserveCompilerFailure(error); }
    }
    const candidate = lookup[key];
    if (!candidate || !compilerEntryExists(candidate)) continue;
    try {
      return await loadCompilerWithReceipt(pathToFileURL(candidate).href);
    } catch (error) { return preserveCompilerFailure(error); }
  }
  return null;
}

export function loadTypeScriptModule(rootDir) {
  const trusted = rootDir && isRepoTrusted(rootDir);
  const key = `${rootDir || '__default__'}:${Boolean(trusted)}`;
  if (syncTypeScriptCache.has(key)) return syncTypeScriptCache.get(key);
  let resolved = null;
  if (trusted) {
    const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
    let filename;
    try {
      filename = requireFromRoot.resolve('typescript');
    } catch (error) {
      if (!hasFailureCode(error, ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'])) return preserveCompilerFailure(error);
      // A missing package can follow the declared fallback order. A present,
      // damaged/native-API package cannot be replaced by the global compiler.
      compilerEntryExists(path.join(rootDir, 'node_modules', 'typescript', 'lib', 'typescript.js'));
    }
    if (filename) try {
      filename = fsSync.realpathSync(filename);
      const before = moduleHash(filename);
      const mod = requireFromRoot('typescript');
      recordSyncReceipt(mod?.default || mod, filename, before);
      resolved = mod?.default || mod;
    } catch (error) {
      return preserveCompilerFailure(error);
    }
  }
  if (!resolved) {
    let filename;
    try {
      filename = globalRequire.resolve('typescript');
    } catch (error) {
      if (!hasFailureCode(error, ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'])) return preserveCompilerFailure(error);
    }
    if (filename) try {
      filename = fsSync.realpathSync(filename);
      const before = moduleHash(filename);
      const mod = globalRequire('typescript');
      recordSyncReceipt(mod?.default || mod, filename, before);
      resolved = mod?.default || mod;
    } catch (error) {
      return preserveCompilerFailure(error);
    }
  }
  syncTypeScriptCache.set(key, resolved);
  return resolved;
}

export function clearTypeScriptModuleCache(rootDir = null) {
  if (rootDir == null) {
    syncTypeScriptCache.clear();
    return;
  }
  syncTypeScriptCache.delete(`${rootDir}:true`);
  syncTypeScriptCache.delete(`${rootDir}:false`);
}

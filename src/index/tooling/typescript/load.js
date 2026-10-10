import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isRepoTrusted } from '../../../shared/config-authority.js';

export const DEFAULT_TYPESCRIPT_RESOLVE_ORDER = Object.freeze(['repo', 'cache', 'global']);

const globalRequire = createRequire(import.meta.url);
const syncTypeScriptCache = new Map();
const compilerLoadReceipts = new WeakMap();
const moduleHash = filename => createHash('sha256').update(fsSync.readFileSync(filename)).digest('hex');
const loadCompilerWithReceipt = async url => {
  const filename = fsSync.realpathSync(fileURLToPath(url)), before = moduleHash(filename);
  const mod = await import(url), compiler = mod?.default || mod;
  const after = moduleHash(filename), previous = compilerLoadReceipts.get(compiler);
  if (before !== after || previous && (previous.filename !== filename || previous.hash !== after)) {
    throw Object.assign(new Error('Loaded TypeScript module identity changed; restart the indexing process.'), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
  }
  compilerLoadReceipts.set(compiler, { filename, hash: after });
  return compiler;
};
const recordSyncReceipt = (compiler, filename, before) => {
  const hash = moduleHash(filename), previous = compilerLoadReceipts.get(compiler);
  if (before !== hash || previous && (previous.filename !== filename || previous.hash !== hash)) throw Object.assign(new Error('Loaded TypeScript changed; restart indexing.'), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
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
      try {
        return await loadCompilerWithReceipt(import.meta.resolve('typescript'));
      } catch (error) {
        if (error.code === 'ERR_SEMANTIC_DEPENDENCY_UNSEALED') throw error;
        continue;
      }
    }
    const candidate = lookup[key];
    if (!candidate || !fsSync.existsSync(candidate)) continue;
    try {
      return await loadCompilerWithReceipt(pathToFileURL(candidate).href);
    } catch (error) { if (error.code === 'ERR_SEMANTIC_DEPENDENCY_UNSEALED') throw error; }
  }
  return null;
}

export function loadTypeScriptModule(rootDir) {
  const trusted = rootDir && isRepoTrusted(rootDir);
  const key = `${rootDir || '__default__'}:${Boolean(trusted)}`;
  if (syncTypeScriptCache.has(key)) return syncTypeScriptCache.get(key);
  let resolved = null;
  if (trusted) {
    try {
      const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
      const filename = fsSync.realpathSync(requireFromRoot.resolve('typescript'));
      const before = moduleHash(filename);
      const mod = requireFromRoot('typescript');
      recordSyncReceipt(mod?.default || mod, filename, before);
      resolved = mod?.default || mod;
    } catch (error) {
      if (error.code === 'ERR_SEMANTIC_DEPENDENCY_UNSEALED') throw error;
      resolved = null;
    }
  }
  if (!resolved) {
    try {
      const filename = fsSync.realpathSync(globalRequire.resolve('typescript'));
      const before = moduleHash(filename);
      const mod = globalRequire('typescript');
      recordSyncReceipt(mod?.default || mod, filename, before);
      resolved = mod?.default || mod;
    } catch {
      resolved = null;
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

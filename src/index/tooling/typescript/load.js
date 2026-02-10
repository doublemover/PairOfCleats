import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TYPESCRIPT_RESOLVE_ORDER = Object.freeze(['repo', 'cache', 'global']);

const globalRequire = createRequire(import.meta.url);
const syncTypeScriptCache = new Map();

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
    if (key === 'global') {
      try {
        const mod = await import('typescript');
        return mod?.default || mod;
      } catch {
        continue;
      }
    }
    const candidate = lookup[key];
    if (!candidate || !fsSync.existsSync(candidate)) continue;
    try {
      const mod = await import(pathToFileURL(candidate).href);
      return mod?.default || mod;
    } catch {}
  }
  return null;
}

export function loadTypeScriptModule(rootDir) {
  const key = rootDir || '__default__';
  if (syncTypeScriptCache.has(key)) return syncTypeScriptCache.get(key);
  let resolved = null;
  if (rootDir) {
    try {
      const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
      const mod = requireFromRoot('typescript');
      resolved = mod?.default || mod;
    } catch {
      resolved = null;
    }
  }
  if (!resolved) {
    try {
      const mod = globalRequire('typescript');
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
  syncTypeScriptCache.delete(rootDir || '__default__');
}

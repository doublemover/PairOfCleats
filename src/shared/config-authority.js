import fs from 'node:fs';
import path from 'node:path';
import { isPathWithinRoot } from './file-paths.js';

const canonicalPath = (value) => {
  try { return fs.realpathSync(path.resolve(value)); } catch { return null; }
};

/** Trust is granted by the launching user, never by repository configuration. */
export const isRepoTrusted = (repoRoot, env = process.env) => {
  const root = canonicalPath(repoRoot);
  if (!root) return false;
  let approved;
  try { approved = JSON.parse(env.PAIROFCLEATS_TRUSTED_REPOS || '[]'); } catch { return false; }
  return Array.isArray(approved) && approved.some((entry) => (
    typeof entry === 'string' && path.isAbsolute(entry) && canonicalPath(entry) === root
  ));
};

/** A launch-selected user policy must not be stored inside the target repo. */
export const resolveTrustedConfigPath = (repoRoot, env = process.env) => {
  if (!env.PAIROFCLEATS_TRUSTED_CONFIG) return null;
  if (!path.isAbsolute(env.PAIROFCLEATS_TRUSTED_CONFIG)) {
    throw new Error('PAIROFCLEATS_TRUSTED_CONFIG must be an absolute user-owned path.');
  }
  const root = canonicalPath(repoRoot);
  const file = canonicalPath(env.PAIROFCLEATS_TRUSTED_CONFIG);
  if (!root || !file || isPathWithinRoot(file, root)
    || isPathWithinRoot(path.resolve(env.PAIROFCLEATS_TRUSTED_CONFIG), path.resolve(repoRoot))) {
    throw new Error('PAIROFCLEATS_TRUSTED_CONFIG must name an existing user-owned file outside the repository.');
  }
  return file;
};

const removePath = (config, keys) => {
  let parent = config;
  for (const key of keys.slice(0, -1)) {
    if (!parent?.[key] || typeof parent[key] !== 'object') return;
    parent = parent[key];
  }
  delete parent[keys.at(-1)];
};

/** Keep data/analysis settings, but not repo-selected execution or storage authority. */
export const applyRepoConfigAuthority = (config, repoRoot) => {
  if (isRepoTrusted(repoRoot)) return config;
  const safe = structuredClone(config);
  for (const keys of [
    ['runtime', 'nodeOptions'], ['cache', 'root'],
    ['dictionary', 'dir'], ['models', 'dir'], ['extensions', 'dir'],
    ['tooling', 'dir'], ['tooling', 'lsp', 'servers'],
    ['tooling', 'autoInstallOnDetect'],
    ['tooling', 'typescript', 'resolveOrder'],
    ['sqlite', 'vectorExtension'], ['security', 'downloads', 'allowlist']
  ]) removePath(safe, keys);
  for (const value of Object.values(safe.tooling || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of ['cmd', 'command', 'args', 'env', 'path', 'bin', 'executable']) delete value[key];
  }
  return safe;
};

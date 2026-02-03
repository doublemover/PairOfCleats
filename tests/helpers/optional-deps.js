import fs from 'node:fs';
import { tryImport, tryRequire } from '../../src/shared/optional-deps.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../../tools/sqlite/vector-extension.js';
import { skip } from './skip.js';

const hasModule = (result) => Boolean(result && result.ok);

export const hasHnswLib = () => hasModule(tryRequire('hnswlib-node'));

export const hasSqlite = () => hasModule(tryRequire('better-sqlite3'));

export const hasLanceDb = async () => hasModule(await tryImport('@lancedb/lancedb'));

export const resolveSqliteVecPath = ({ repoRoot, userConfig } = {}) => {
  if (!repoRoot) return null;
  const config = getVectorExtensionConfig(repoRoot, userConfig);
  return resolveVectorExtensionPath(config);
};

export const hasSqliteVecExtension = ({ repoRoot, userConfig } = {}) => {
  const extensionPath = resolveSqliteVecPath({ repoRoot, userConfig });
  return extensionPath ? fs.existsSync(extensionPath) : false;
};

export const requireHnswLib = ({ reason = '' } = {}) => {
  if (hasHnswLib()) return true;
  skip(reason || 'hnswlib-node not available; skipping test.');
  return false;
};

export const requireLanceDb = async ({ reason = '' } = {}) => {
  if (await hasLanceDb()) return true;
  skip(reason || 'lancedb not available; skipping test.');
  return false;
};

export const requireSqliteVec = ({ repoRoot, userConfig, reason = '' } = {}) => {
  if (!hasSqlite()) {
    skip(reason || 'better-sqlite3 not available; skipping sqlite-vec test.');
    return null;
  }
  const extensionPath = resolveSqliteVecPath({ repoRoot, userConfig });
  if (!extensionPath || !fs.existsSync(extensionPath)) {
    const detail = extensionPath ? ` (${extensionPath})` : '';
    skip(reason || `sqlite-vec extension missing; skipping test.${detail}`);
    return null;
  }
  return extensionPath;
};

import fs from 'node:fs';
import path from 'node:path';
import { loadUserConfig } from '../config.js';
import { getRepoCacheRoot, resolveIndexRoot, resolvePath } from './repo.js';

const resolveRepoOverride = (repoRoot, value, fallback) => (
  (value ? resolvePath(repoRoot, value) : null) || fallback
);

/**
 * Resolve LMDB database paths for the repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{codePath:string,prosePath:string,dbDir:string}}
 */
export function resolveLmdbPaths(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const lmdb = cfg.lmdb || {};
  const indexRoot = resolveIndexRoot(repoRoot, cfg, options);
  const defaultDir = path.join(indexRoot, 'index-lmdb');
  const dbDir = resolveRepoOverride(repoRoot, lmdb.dbDir, defaultDir);
  const codePath = resolveRepoOverride(repoRoot, lmdb.codeDbPath, path.join(dbDir, 'index-code'));
  const prosePath = resolveRepoOverride(repoRoot, lmdb.proseDbPath, path.join(dbDir, 'index-prose'));
  return { codePath, prosePath, dbDir };
}

/**
 * Resolve SQLite database paths for the repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{codePath:string,prosePath:string,extractedProsePath:string,recordsPath:string,dbDir:string,legacyPath:string,legacyExists:boolean}}
 */
export function resolveSqlitePaths(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const sqlite = cfg.sqlite || {};
  const repoCacheRoot = getRepoCacheRoot(repoRoot, cfg);
  const indexRoot = resolveIndexRoot(repoRoot, cfg, options);
  const defaultDir = path.join(indexRoot, 'index-sqlite');
  const legacyPath = path.join(repoCacheRoot, 'index-sqlite', 'index.db');
  const dbDir = resolveRepoOverride(repoRoot, sqlite.dbDir, defaultDir);
  const codePath = resolveRepoOverride(repoRoot, sqlite.codeDbPath, path.join(dbDir, 'index-code.db'));
  const prosePath = resolveRepoOverride(repoRoot, sqlite.proseDbPath, path.join(dbDir, 'index-prose.db'));
  const extractedProsePath = resolveRepoOverride(
    repoRoot,
    sqlite.extractedProseDbPath,
    path.join(dbDir, 'index-extracted-prose.db')
  );
  const recordsPath = resolveRepoOverride(repoRoot, sqlite.recordsDbPath, path.join(dbDir, 'index-records.db'));
  return {
    codePath,
    prosePath,
    extractedProsePath,
    recordsPath,
    dbDir,
    legacyPath,
    legacyExists: fs.existsSync(legacyPath)
  };
}

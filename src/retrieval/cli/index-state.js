import fsSync from 'node:fs';
import path from 'node:path';
import { resolveIndexDir } from '../cli-index.js';

export const loadIndexState = (rootDir, userConfig, mode, options = {}) => {
  try {
    const dir = resolveIndexDir(rootDir, mode, userConfig, options.resolveOptions || {});
    const statePath = path.join(dir, 'index_state.json');
    if (!fsSync.existsSync(statePath)) return null;
    return JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
};

export const isSqliteReady = (state) => {
  if (!state?.sqlite) return true;
  return state.sqlite.ready !== false && state.sqlite.pending !== true;
};

export const isLmdbReady = (state) => {
  if (!state?.lmdb) return true;
  return state.lmdb.ready !== false && state.lmdb.pending !== true;
};

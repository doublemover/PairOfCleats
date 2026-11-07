import path from 'node:path';
import { areAllPrimaryModesRequested } from './modes.js';

/**
 * Resolve sqlite stage mode list, collapsing full primary mode sets to `all`.
 * @param {string[]} sqliteModes
 * @returns {string[]}
 */
export const resolveSqliteModeList = (sqliteModes) => (
  areAllPrimaryModesRequested(sqliteModes) ? ['all'] : sqliteModes
);

/** Batch only after each concrete mode has resolved its authoritative root. */
export const resolveSqliteModePlan = (modeRoots) => {
  if (areAllPrimaryModesRequested(modeRoots.map(entry => entry.mode))
    && modeRoots.every(entry => path.resolve(entry.indexRoot) === path.resolve(modeRoots[0].indexRoot))) {
    return [{ mode: 'all', indexRoot: modeRoots[0].indexRoot }];
  }
  return modeRoots;
};

/**
 * Build memoized resolver for per-build sqlite input/output directories.
 *
 * Path resolution is cached by absolute `indexRoot` to avoid repeated path
 * composition for multi-mode stage4 loops.
 *
 * @param {{root:string,userConfig:object,getIndexDir:function}} input
 * @returns {(indexRoot:string|null)=>({codeDir:string,proseDir:string,extractedProseDir:string,recordsDir:string,sqliteOut:string}|null)}
 */
export const createSqliteDirResolver = ({ root, userConfig, getIndexDir }) => {
  const cache = new Map();
  return (indexRoot) => {
    if (!indexRoot) return null;
    const resolvedRoot = path.resolve(indexRoot);
    const cached = cache.get(resolvedRoot);
    if (cached) return cached;
    const resolved = {
      codeDir: getIndexDir(root, 'code', userConfig, { indexRoot: resolvedRoot }),
      proseDir: getIndexDir(root, 'prose', userConfig, { indexRoot: resolvedRoot }),
      extractedProseDir: getIndexDir(root, 'extracted-prose', userConfig, { indexRoot: resolvedRoot }),
      recordsDir: getIndexDir(root, 'records', userConfig, { indexRoot: resolvedRoot }),
      sqliteOut: path.join(resolvedRoot, 'index-sqlite')
    };
    cache.set(resolvedRoot, resolved);
    return resolved;
  };
};

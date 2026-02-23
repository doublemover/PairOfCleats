import path from 'node:path';
import { areAllPrimaryModesRequested } from './modes.js';

export const resolveSqliteModeList = (sqliteModes) => (
  areAllPrimaryModesRequested(sqliteModes) ? ['all'] : sqliteModes
);

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

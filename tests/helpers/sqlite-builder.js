import { buildSqliteIndex } from '../../src/integrations/core/index.js';
import { getCurrentBuildInfo, loadUserConfig } from '../../tools/shared/dict-utils.js';

export const resolveSqliteIndexRoot = (repoRoot, mode = null, explicitIndexRoot = null) => {
  if (explicitIndexRoot) return explicitIndexRoot;
  const userConfig = loadUserConfig(repoRoot);
  const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: mode || undefined });
  if (!buildInfo?.activeRoot) {
    throw new Error('Missing index root for sqlite build. Ensure build_index has completed first.');
  }
  return buildInfo.activeRoot;
};

export const runSqliteBuild = async (repoRoot, options = {}) => {
  const mode = options.mode || 'all';
  const indexRoot = resolveSqliteIndexRoot(repoRoot, mode, options.indexRoot || null);
  return buildSqliteIndex(repoRoot, {
    mode,
    incremental: options.incremental === true,
    compact: options.compact === true,
    out: options.out || null,
    indexRoot,
    codeDir: options.codeDir || null,
    proseDir: options.proseDir || null,
    extractedProseDir: options.extractedProseDir || null,
    recordsDir: options.recordsDir || null,
    validateMode: options.validateMode ?? options.validate,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true,
    logger: options.logger || null
  });
};

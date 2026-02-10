import { getRepoRoot } from '../../../shared/dict-utils.js';
import { buildSqliteIndex as runBuildSqliteIndex } from '../../../storage/sqlite/build/runner.js';

/**
 * Build or update SQLite indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(repoRoot, options = {}) {
  const root = getRepoRoot(repoRoot);
  return runBuildSqliteIndex({
    root,
    ...options,
    mode: options.mode,
    incremental: options.incremental === true,
    compact: options.compact === true,
    out: options.out || null,
    indexRoot: options.indexRoot || null,
    codeDir: options.codeDir || null,
    proseDir: options.proseDir || null,
    extractedProseDir: options.extractedProseDir || null,
    recordsDir: options.recordsDir || null,
    validateMode: options.validateMode ?? options.validate,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true,
    logger: options.logger || null
  });
}

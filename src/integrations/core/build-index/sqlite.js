import { getRepoRoot } from '../../../../tools/dict-utils.js';
import { runBuildSqliteIndex } from '../../../../tools/build-sqlite-index.js';

/**
 * Build or update SQLite indexes for a repo.
 * @param {string} repoRoot
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(repoRoot, options = {}) {
  const root = getRepoRoot(repoRoot);
  const rawArgs = Array.isArray(options.args) ? options.args.slice() : [];
  if (!options.args) {
    if (options.mode) rawArgs.push('--mode', String(options.mode));
    if (options.incremental) rawArgs.push('--incremental');
    if (options.compact) rawArgs.push('--compact');
    if (options.out) rawArgs.push('--out', String(options.out));
    if (options.codeDir) rawArgs.push('--code-dir', String(options.codeDir));
    if (options.proseDir) rawArgs.push('--prose-dir', String(options.proseDir));
    if (options.extractedProseDir) rawArgs.push('--extracted-prose-dir', String(options.extractedProseDir));
    if (options.recordsDir) rawArgs.push('--records-dir', String(options.recordsDir));
  }
  return runBuildSqliteIndex(rawArgs, {
    root,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true,
    logger: options.logger || null
  });
}

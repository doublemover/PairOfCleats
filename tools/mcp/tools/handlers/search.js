import { search as coreSearch } from '../../../../src/integrations/core/index.js';
import { createError, ERROR_CODES } from '../../../../src/shared/error-codes.js';
import { getRepoCaches, refreshRepoCaches, resolveRepoPath } from '../../repo.js';
import { buildMcpSearchArgs } from '../search-args.js';

/**
 * Handle the MCP search tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function runSearch(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  if (context.signal?.aborted) {
    throw createError(ERROR_CODES.CANCELLED, 'Request cancelled.');
  }
  const query = String(args.query || '').trim();
  if (!query) throw createError(ERROR_CODES.INVALID_REQUEST, 'Query is required.');

  const searchArgs = buildMcpSearchArgs({ ...args, repoPath });

  const caches = getRepoCaches(repoPath);
  await refreshRepoCaches(repoPath);
  return await coreSearch(repoPath, {
    args: searchArgs,
    query,
    emitOutput: false,
    exitOnError: false,
    indexCache: caches.indexCache,
    sqliteCache: caches.sqliteCache,
    signal: context.signal
  });
}

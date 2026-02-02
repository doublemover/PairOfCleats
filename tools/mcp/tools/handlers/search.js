import { search as coreSearch } from '../../../../src/integrations/core/index.js';
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
    throw new Error('Request cancelled.');
  }
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Query is required.');

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

import path from 'node:path';
import { runSearchCli } from '../../retrieval/cli.js';
import { buildSearchArgs } from './args.js';
import { attachObservability, normalizeObservability } from '../../shared/observability.js';

/**
 * Execute a search for a repo.
 * @param {string} repoRoot
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function search(repoRoot, params = {}) {
  const rootOverride = repoRoot
    ? path.resolve(repoRoot)
    : (params.root ? path.resolve(params.root) : null);
  const observability = normalizeObservability(params.observability, {
    surface: 'search',
    operation: 'search',
    context: {
      repoRoot: rootOverride || null,
      query: typeof params.query === 'string' ? params.query : '',
      output: params.output || null
    }
  });
  const rawArgs = Array.isArray(params.args) ? params.args.slice() : buildSearchArgs(params);
  const query = typeof params.query === 'string' ? params.query : '';
  if (query) rawArgs.push('--', query);
  const result = await runSearchCli(rawArgs, {
    root: rootOverride || undefined,
    emitOutput: params.emitOutput === true,
    exitOnError: params.exitOnError === true,
    indexCache: params.indexCache,
    sqliteCache: params.sqliteCache,
    signal: params.signal || null,
    scoreMode: params.scoreMode ?? null
  });
  return attachObservability(result, observability);
}

import { runSearchCli, INTERNAL_EXACT_SEARCH_MODE } from '../../retrieval/cli.js';
import { buildCoreSearchInvocation } from './search-invocation.js';
import { INTERNAL_SEARCH_POLICY } from '../../retrieval/cli/effective-plan.js';
import { attachObservability, normalizeObservability } from '../../shared/observability.js';
import { INTERNAL_QUERY_CACHE_BYPASS } from '../../retrieval/query-cache-experiment.js';
import { INTERNAL_ADMITTED_GENERATION } from '../../index/as-of.js';

/**
 * Execute a search for a repo.
 * @param {string} repoRoot
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function search(repoRoot, params = {}) {
  const { root: rootOverride, rawArgs } = buildCoreSearchInvocation(repoRoot, params);
  const observability = normalizeObservability(params.observability, {
    surface: 'search',
    operation: 'search',
    context: {
      repoRoot: rootOverride || null,
      query: typeof params.query === 'string' ? params.query : '',
      output: params.output || null
    }
  });
  const result = await runSearchCli(rawArgs, {
    root: rootOverride || undefined,
    emitOutput: params.emitOutput === true,
    exitOnError: params.exitOnError === true,
    indexCache: params.indexCache,
    sqliteCache: params.sqliteCache,
    signal: params.signal || null,
    scoreMode: params.scoreMode ?? null,
    generationContext: params.generationContext || null,
    [INTERNAL_EXACT_SEARCH_MODE]: params[INTERNAL_EXACT_SEARCH_MODE],
    [INTERNAL_SEARCH_POLICY]: params[INTERNAL_SEARCH_POLICY],
    [INTERNAL_QUERY_CACHE_BYPASS]: params[INTERNAL_QUERY_CACHE_BYPASS],
    [INTERNAL_ADMITTED_GENERATION]: params[INTERNAL_ADMITTED_GENERATION]
  });
  return attachObservability(result, observability);
}

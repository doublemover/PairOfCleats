import { configStatus, indexStatus } from './repo.js';
import { cacheGc, cleanArtifacts, reportArtifacts } from './tools/handlers/artifacts.js';
import { runBootstrap } from './tools/handlers/bootstrap.js';
import { downloadDictionaries, downloadExtensions, downloadModels, verifyExtensions } from './tools/handlers/downloads.js';
import { buildIndex, buildSqliteIndex, compactSqliteIndex } from './tools/handlers/indexing.js';
import { runSearch, runWorkspaceSearch } from './tools/handlers/search.js';
import { triageContextPack, triageDecision, triageIngest } from './tools/handlers/triage.js';
import { createError, ERROR_CODES } from '../../src/shared/error-codes.js';
import { getTestEnvConfig } from '../../src/shared/env.js';
import { normalizeMetaFilters } from '../shared/search-request.js';

const parseTestDelayMs = () => {
  const testEnv = getTestEnvConfig();
  if (!testEnv.testing) return null;
  const parsed = Number(testEnv.mcpDelayMs);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const delayWithAbort = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(createError(ERROR_CODES.CANCELLED, 'Request cancelled.'));
    return;
  }
  const timer = setTimeout(resolve, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(createError(ERROR_CODES.CANCELLED, 'Request cancelled.'));
  };
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }
});

/**
 * Normalize meta filters into CLI-friendly key/value strings.
 * @param {any} meta
 * @returns {string[]|null}
 */
export { normalizeMetaFilters };

export {
  buildIndex,
  runSearch,
  downloadModels,
  downloadDictionaries,
  downloadExtensions,
  verifyExtensions,
  buildSqliteIndex,
  compactSqliteIndex,
  cacheGc,
  cleanArtifacts,
  runBootstrap,
  reportArtifacts,
  triageIngest,
  triageDecision,
  triageContextPack
};

export const TOOL_HANDLERS = new Map([
  ['index_status', indexStatus],
  ['config_status', configStatus],
  ['build_index', buildIndex],
  ['search', runSearch],
  ['search_workspace', runWorkspaceSearch],
  ['download_models', downloadModels],
  ['download_dictionaries', downloadDictionaries],
  ['download_extensions', downloadExtensions],
  ['verify_extensions', verifyExtensions],
  ['build_sqlite_index', buildSqliteIndex],
  ['compact_sqlite_index', compactSqliteIndex],
  ['cache_gc', cacheGc],
  ['clean_artifacts', cleanArtifacts],
  ['bootstrap', runBootstrap],
  ['report_artifacts', reportArtifacts],
  ['triage_ingest', triageIngest],
  ['triage_decision', triageDecision],
  ['triage_context_pack', triageContextPack]
]);

/**
 * Dispatch an MCP tool call by name.
 * @param {string} name
 * @param {object} args
 * @returns {Promise<any>}
 */
export async function handleToolCall(name, args, context = {}) {
  const handler = TOOL_HANDLERS.get(name);
  if (!handler) {
    throw createError(ERROR_CODES.NOT_FOUND, `Unknown tool: ${name}`);
  }
  const delayMs = parseTestDelayMs();
  if (delayMs) {
    if (typeof context.progress === 'function') {
      for (let i = 0; i < 5; i += 1) {
        context.progress({ message: `test-progress-${i}`, phase: 'progress' });
      }
    }
    await delayWithAbort(delayMs, context.signal);
  }
  return await handler(args, context);
}

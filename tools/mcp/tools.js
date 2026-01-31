import { configStatus, indexStatus } from './repo.js';
import { cacheGc, cleanArtifacts, reportArtifacts } from './tools/handlers/artifacts.js';
import { runBootstrap } from './tools/handlers/bootstrap.js';
import { downloadDictionaries, downloadExtensions, downloadModels, verifyExtensions } from './tools/handlers/downloads.js';
import { buildIndex, buildSqliteIndex, compactSqliteIndex } from './tools/handlers/indexing.js';
import { runSearch } from './tools/handlers/search.js';
import { triageContextPack, triageDecision, triageIngest } from './tools/handlers/triage.js';
import { normalizeMetaFilters } from './tools/helpers.js';

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
    throw new Error(`Unknown tool: ${name}`);
  }
  return await handler(args, context);
}

import { resolveAutoSqliteEligibility } from './auto-thresholds.js';
import { resolveRunSearchBackendSelection } from './backend-selection.js';
import { initializeBackendContext } from './backend-context-setup.js';

/**
 * Resolve backend policy and initialize sqlite/lmdb runtime context.
 *
 * @param {object} [input]
 * @param {object} input.selectionInput
 * @param {object} input.contextInput
 * @param {{
 *   resolveAutoSqliteEligibility?:(input:object)=>object,
 *   resolveRunSearchBackendSelection?:(input:object)=>Promise<object>|object,
 *   initializeBackendContext?:(input:object)=>Promise<object>
 * }} [input.dependencies]
 * @returns {Promise<object>}
 */
export async function resolveRunSearchBackendContext({
  selectionInput = {},
  contextInput = {},
  dependencies = {}
} = {}) {
  const resolveAutoSqliteEligibilityImpl = dependencies.resolveAutoSqliteEligibility || resolveAutoSqliteEligibility;
  const resolveRunSearchBackendSelectionImpl = (
    dependencies.resolveRunSearchBackendSelection || resolveRunSearchBackendSelection
  );
  const initializeBackendContextImpl = dependencies.initializeBackendContext || initializeBackendContext;

  const {
    backendArg,
    sqliteAvailable,
    needsSqlite,
    sqliteAutoChunkThreshold,
    sqliteAutoArtifactBytes,
    runCode,
    runProse,
    runExtractedProse,
    resolveSearchIndexDir
  } = selectionInput;

  const autoSqliteEligibility = resolveAutoSqliteEligibilityImpl({
    backendArg,
    sqliteAvailable,
    needsSqlite,
    sqliteAutoChunkThreshold,
    sqliteAutoArtifactBytes,
    runCode,
    runProse,
    runExtractedProse,
    resolveSearchIndexDir
  });

  const backendSelection = await resolveRunSearchBackendSelectionImpl({
    ...selectionInput,
    autoBackendRequested: autoSqliteEligibility.autoBackendRequested,
    autoSqliteAllowed: autoSqliteEligibility.autoSqliteAllowed,
    autoSqliteReason: autoSqliteEligibility.autoSqliteReason
  });

  if (backendSelection?.error) {
    return {
      error: backendSelection.error
    };
  }

  const {
    backendPolicy,
    useSqliteSelection,
    useLmdbSelection,
    sqliteFtsEnabled,
    backendForcedSqlite,
    backendForcedLmdb,
    backendForcedTantivy
  } = backendSelection;

  const backendContextPayload = await initializeBackendContextImpl({
    ...contextInput,
    backendPolicy,
    useSqliteSelection,
    useLmdbSelection,
    sqliteFtsEnabled,
    backendForcedSqlite,
    backendForcedLmdb,
    backendForcedTantivy
  });

  return {
    autoSqliteEligibility,
    backendSelection,
    backendPolicy,
    useSqliteSelection,
    useLmdbSelection,
    sqliteFtsEnabled,
    backendForcedSqlite,
    backendForcedLmdb,
    backendForcedTantivy,
    ...backendContextPayload
  };
}

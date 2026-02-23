import {
  resolveLmdbPaths,
  resolveSqlitePaths
} from '../../../../tools/shared/dict-utils.js';
import { resolveSingleRootForModes } from '../../../index/as-of.js';
import { pathExists } from '../../../shared/files.js';
import { hasLmdbStore } from '../index-loader.js';
import { isLmdbReady, isSqliteReady } from '../index-state.js';
import { loadSearchIndexStates } from './startup-index.js';
import { resolveRunSearchProfilePolicy } from './profile-policy.js';

/**
 * Build sqlite path-probe plan for requested modes only.
 *
 * Orchestration detail: this intentionally uses `needsExtractedProse` (what the
 * request may load) instead of `requiresExtractedProse` (hard mode requirement)
 * so mixed/search-mode side paths do not trigger unnecessary filesystem probes.
 *
 * @param {{
 *   sqliteRootsMixed?:boolean,
 *   needsCode?:boolean,
 *   needsProse?:boolean,
 *   needsExtractedProse?:boolean,
 *   sqlitePaths?:{codePath?:string,prosePath?:string,extractedProsePath?:string}
 * }} [input]
 * @returns {{codePath:string|null,prosePath:string|null,extractedProsePath:string|null}}
 */
export const buildRunSearchSqlitePathProbePlan = ({
  sqliteRootsMixed = false,
  needsCode = false,
  needsProse = false,
  needsExtractedProse = false,
  sqlitePaths = {}
} = {}) => ({
  codePath: !sqliteRootsMixed && needsCode ? sqlitePaths.codePath || null : null,
  prosePath: !sqliteRootsMixed && needsProse ? sqlitePaths.prosePath || null : null,
  extractedProsePath: !sqliteRootsMixed && needsExtractedProse
    ? sqlitePaths.extractedProsePath || null
    : null
});

/**
 * Probe sqlite path existence from a precomputed plan.
 *
 * @param {{
 *   probePlan:{codePath:string|null,prosePath:string|null,extractedProsePath:string|null},
 *   pathExists:(targetPath:string)=>Promise<boolean>
 * }} input
 * @returns {Promise<{code:boolean,prose:boolean,extractedProse:boolean}>}
 */
export const probeRunSearchSqlitePathExistence = async ({
  probePlan,
  pathExists
}) => {
  const probe = (targetPath) => (
    targetPath ? pathExists(targetPath) : Promise.resolve(false)
  );
  const [code, prose, extractedProse] = await Promise.all([
    probe(probePlan.codePath),
    probe(probePlan.prosePath),
    probe(probePlan.extractedProsePath)
  ]);
  return { code, prose, extractedProse };
};

/**
 * Resolve mode profile policy plus sqlite/lmdb availability for run-search.
 *
 * This helper centralizes readiness checks and performs sqlite path existence
 * probes in parallel only for requested modes to reduce startup latency on
 * cold filesystems.
 *
 * @param {object} [input]
 * @param {string} input.rootDir
 * @param {object} [input.userConfig]
 * @param {boolean} [input.runCode]
 * @param {boolean} [input.runProse]
 * @param {boolean} [input.runExtractedProse]
 * @param {boolean} [input.runRecords]
 * @param {string} [input.searchMode]
 * @param {object|null} [input.asOfContext]
 * @param {object|null} [input.indexResolveOptions]
 * @param {(warning:string)=>void} [input.addProfileWarning]
 * @param {boolean} [input.allowSparseFallback]
 * @param {boolean} [input.allowUnsafeMix]
 * @param {boolean} [input.annFlagPresent]
 * @param {boolean} [input.annEnabled]
 * @param {string|null} [input.scoreMode]
 * @param {{
 *   resolveSingleRootForModes?:(indexBaseRootByMode:object|null,modes:string[])=>{root:string|null,mixed:boolean},
 *   resolveLmdbPaths?:(rootDir:string,userConfig?:object,options?:object)=>object,
 *   resolveSqlitePaths?:(rootDir:string,userConfig?:object,options?:object)=>object,
 *   pathExists?:(targetPath:string)=>Promise<boolean>,
 *   hasLmdbStore?:(targetPath:string)=>boolean,
 *   isLmdbReady?:(state:object|null)=>boolean,
 *   isSqliteReady?:(state:object|null)=>boolean,
 *   loadSearchIndexStates?:(input:object)=>object,
 *   resolveRunSearchProfilePolicy?:(input:object)=>object
 * }} [input.dependencies]
 * @returns {Promise<object>}
 */
export async function resolveRunSearchIndexAvailability({
  rootDir,
  userConfig,
  runCode = false,
  runProse = false,
  runExtractedProse = false,
  runRecords = false,
  searchMode = 'mixed',
  asOfContext = null,
  indexResolveOptions = null,
  addProfileWarning = null,
  allowSparseFallback = false,
  allowUnsafeMix = false,
  annFlagPresent = false,
  annEnabled = false,
  scoreMode = null,
  dependencies = {}
} = {}) {
  const resolveSingleRootForModesImpl = dependencies.resolveSingleRootForModes || resolveSingleRootForModes;
  const resolveLmdbPathsImpl = dependencies.resolveLmdbPaths || resolveLmdbPaths;
  const resolveSqlitePathsImpl = dependencies.resolveSqlitePaths || resolveSqlitePaths;
  const pathExistsImpl = dependencies.pathExists || pathExists;
  const hasLmdbStoreImpl = dependencies.hasLmdbStore || hasLmdbStore;
  const isLmdbReadyImpl = dependencies.isLmdbReady || isLmdbReady;
  const isSqliteReadyImpl = dependencies.isSqliteReady || isSqliteReady;
  const loadSearchIndexStatesImpl = dependencies.loadSearchIndexStates || loadSearchIndexStates;
  const resolveRunSearchProfilePolicyImpl = (
    dependencies.resolveRunSearchProfilePolicy || resolveRunSearchProfilePolicy
  );

  const needsCode = runCode;
  const needsProse = runProse;
  const needsExtractedProse = runExtractedProse;
  const requiresExtractedProse = searchMode === 'extracted-prose';
  const dbModeSelection = [];
  if (needsCode) dbModeSelection.push('code');
  if (needsProse) dbModeSelection.push('prose');
  if (needsExtractedProse) dbModeSelection.push('extracted-prose');

  const strictIndexBaseRootByMode = asOfContext?.strict ? asOfContext.indexBaseRootByMode : null;
  const sqliteRootSelection = resolveSingleRootForModesImpl(strictIndexBaseRootByMode, dbModeSelection);
  const lmdbRootSelection = resolveSingleRootForModesImpl(strictIndexBaseRootByMode, dbModeSelection);
  const sqliteRootsMixed = Boolean(asOfContext?.strict && dbModeSelection.length > 1 && sqliteRootSelection.mixed);
  const lmdbRootsMixed = Boolean(asOfContext?.strict && dbModeSelection.length > 1 && lmdbRootSelection.mixed);

  const lmdbPaths = resolveLmdbPathsImpl(
    rootDir,
    userConfig,
    lmdbRootSelection.root ? { indexRoot: lmdbRootSelection.root } : {}
  );
  const sqlitePaths = resolveSqlitePathsImpl(
    rootDir,
    userConfig,
    sqliteRootSelection.root ? { indexRoot: sqliteRootSelection.root } : {}
  );

  const loadedIndexStates = loadSearchIndexStatesImpl({
    rootDir,
    userConfig,
    runCode: needsCode,
    runProse: needsProse,
    runExtractedProse: needsExtractedProse,
    runRecords,
    indexResolveOptions,
    addProfileWarning
  });
  const sqliteStateCode = loadedIndexStates.code;
  const sqliteStateProse = loadedIndexStates.prose;
  const sqliteStateExtractedProse = loadedIndexStates.extractedProse;
  const sqliteStateRecords = loadedIndexStates.records;
  const indexStateByMode = {
    code: sqliteStateCode,
    prose: sqliteStateProse,
    'extracted-prose': sqliteStateExtractedProse,
    records: sqliteStateRecords
  };
  const profileResolution = resolveRunSearchProfilePolicyImpl({
    runCode,
    runProse,
    runRecords,
    runExtractedProse,
    requiresExtractedProse,
    indexStateByMode,
    allowSparseFallback,
    allowUnsafeMix,
    annFlagPresent,
    annEnabled,
    scoreMode
  });
  if (profileResolution.error) {
    return { error: profileResolution.error };
  }
  if (typeof addProfileWarning === 'function') {
    for (const warning of profileResolution.warnings || []) {
      addProfileWarning(warning);
    }
  }

  const sqliteCodePath = sqlitePaths.codePath;
  const sqliteProsePath = sqlitePaths.prosePath;
  const sqliteExtractedProsePath = sqlitePaths.extractedProsePath;
  const sqliteProbePlan = buildRunSearchSqlitePathProbePlan({
    sqliteRootsMixed,
    needsCode,
    needsProse,
    needsExtractedProse,
    sqlitePaths
  });
  const sqlitePathExistence = await probeRunSearchSqlitePathExistence({
    probePlan: sqliteProbePlan,
    pathExists: pathExistsImpl
  });
  const sqliteCodePathExists = sqlitePathExistence.code;
  const sqliteProsePathExists = sqlitePathExistence.prose;
  const sqliteExtractedPathExists = sqlitePathExistence.extractedProse;

  const sqliteCodeAvailable = sqliteCodePathExists && isSqliteReadyImpl(sqliteStateCode);
  const sqliteProseAvailable = sqliteProsePathExists && isSqliteReadyImpl(sqliteStateProse);
  const sqliteExtractedProseAvailable = !sqliteRootsMixed
    && sqliteExtractedPathExists
    && isSqliteReadyImpl(sqliteStateExtractedProse);
  const sqliteAvailable = (!needsCode || sqliteCodeAvailable)
    && (!needsProse || sqliteProseAvailable)
    && (!requiresExtractedProse || sqliteExtractedProseAvailable);
  const loadExtractedProseSqlite = needsExtractedProse && sqliteExtractedProseAvailable;

  const lmdbCodePath = lmdbPaths.codePath;
  const lmdbProsePath = lmdbPaths.prosePath;
  const lmdbStateCode = sqliteStateCode;
  const lmdbStateProse = sqliteStateProse;
  const lmdbCodeAvailable = !lmdbRootsMixed && hasLmdbStoreImpl(lmdbCodePath) && isLmdbReadyImpl(lmdbStateCode);
  const lmdbProseAvailable = !lmdbRootsMixed && hasLmdbStoreImpl(lmdbProsePath) && isLmdbReadyImpl(lmdbStateProse);
  const lmdbAvailable = !needsExtractedProse
    && (!needsCode || lmdbCodeAvailable)
    && (!needsProse || lmdbProseAvailable);

  return {
    selectedModes: profileResolution.selectedModes,
    profilePolicyByMode: profileResolution.profilePolicyByMode,
    vectorOnlyModes: profileResolution.vectorOnlyModes,
    annEnabledEffective: profileResolution.annEnabledEffective,
    sqliteRootsMixed,
    lmdbRootsMixed,
    sqlitePaths,
    lmdbPaths,
    sqliteStates: {
      code: sqliteStateCode,
      prose: sqliteStateProse,
      'extracted-prose': sqliteStateExtractedProse,
      records: sqliteStateRecords
    },
    lmdbStates: {
      code: lmdbStateCode,
      prose: lmdbStateProse
    },
    sqliteAvailability: {
      all: sqliteAvailable,
      code: sqliteCodeAvailable,
      prose: sqliteProseAvailable,
      extractedProse: sqliteExtractedProseAvailable
    },
    lmdbAvailability: {
      all: lmdbAvailable,
      code: lmdbCodeAvailable,
      prose: lmdbProseAvailable
    },
    loadExtractedProseSqlite
  };
}

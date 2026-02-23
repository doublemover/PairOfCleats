import { createWarningCollector } from './shared.js';
import { resolveRunSearchModeNeeds } from './backend-bootstrap-input.js';

/**
 * Resolve mode needs + profile/index availability while keeping ANN flag state in sync.
 *
 * @param {object} input
 * @param {boolean} input.runCode
 * @param {boolean} input.runProse
 * @param {boolean} input.runExtractedProseRaw
 * @param {boolean} input.runRecords
 * @param {string} input.searchMode
 * @param {boolean} input.commentsEnabled
 * @param {string} input.rootDir
 * @param {object} input.userConfig
 * @param {object|null} input.asOfContext
 * @param {object} input.indexResolveOptions
 * @param {boolean} input.allowSparseFallback
 * @param {boolean} input.allowUnsafeMix
 * @param {boolean} input.annFlagPresent
 * @param {boolean} input.annEnabled
 * @param {string} input.scoreMode
 * @param {boolean} input.emitOutput
 * @param {{enabled?:boolean}} input.vectorExtension
 * @param {{setAnn:(state:string)=>void}} input.telemetry
 * @param {(input:object)=>Promise<object>} input.resolveIndexAvailability
 * @param {(line:string)=>void} [input.warn]
 * @returns {Promise<{error?:Error,modeNeeds:{requiresExtractedProse:boolean,joinComments:boolean},requiresExtractedProse:boolean,joinComments:boolean,annEnabledEffective:boolean,vectorAnnEnabled:boolean,profileWarnings:string[],addProfileWarning:(warning:string)=>void,syncAnnFlags:()=>void,profileAndAvailability?:object}>}
 */
export async function resolveRunSearchModeProfileAvailability({
  runCode,
  runProse,
  runExtractedProseRaw,
  runRecords,
  searchMode,
  commentsEnabled,
  rootDir,
  userConfig,
  asOfContext,
  indexResolveOptions,
  allowSparseFallback,
  allowUnsafeMix,
  annFlagPresent,
  annEnabled,
  scoreMode,
  emitOutput,
  vectorExtension,
  telemetry,
  resolveIndexAvailability,
  warn = (line) => console.warn(line)
}) {
  const modeNeeds = resolveRunSearchModeNeeds({
    runCode,
    runProse,
    runExtractedProse: runExtractedProseRaw,
    searchMode,
    commentsEnabled
  });
  const { requiresExtractedProse, joinComments } = modeNeeds;

  let annEnabledEffective = annEnabled;
  let vectorAnnEnabled = false;
  const warningCollector = createWarningCollector();
  const profileWarnings = warningCollector.warnings;
  const addProfileWarning = warningCollector.add;

  const syncAnnFlags = () => {
    vectorAnnEnabled = annEnabledEffective && vectorExtension.enabled === true;
    telemetry.setAnn(annEnabledEffective ? 'on' : 'off');
  };

  const profileAndAvailability = await resolveIndexAvailability({
    rootDir,
    userConfig,
    runCode,
    runProse,
    runExtractedProse: runExtractedProseRaw,
    runRecords,
    searchMode,
    asOfContext,
    indexResolveOptions,
    addProfileWarning,
    allowSparseFallback,
    allowUnsafeMix,
    annFlagPresent,
    annEnabled: annEnabledEffective,
    scoreMode
  });

  if (profileAndAvailability.error) {
    return {
      error: profileAndAvailability.error,
      modeNeeds,
      requiresExtractedProse,
      joinComments,
      annEnabledEffective,
      vectorAnnEnabled,
      profileWarnings,
      addProfileWarning,
      syncAnnFlags
    };
  }

  annEnabledEffective = profileAndAvailability.annEnabledEffective;
  syncAnnFlags();

  if (emitOutput && profileWarnings.length) {
    for (const warning of profileWarnings) {
      warn(`[search] ${warning}`);
    }
  }

  return {
    modeNeeds,
    requiresExtractedProse,
    joinComments,
    annEnabledEffective,
    vectorAnnEnabled,
    profileWarnings,
    addProfileWarning,
    syncAnnFlags,
    profileAndAvailability
  };
}

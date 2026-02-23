import { ERROR_CODES } from '../../../shared/error-codes.js';
import { resolveAsOfContext } from '../../../index/as-of.js';
import { resolveIndexDir } from '../../cli-index.js';
import { hasIndexMetaAsync } from '../index-loader.js';
import { loadIndexState } from '../index-state.js';

/**
 * Build the mode list used to resolve strict `--as-of` index roots.
 *
 * @param {{runCode:boolean,runProse:boolean,runRecords:boolean,searchMode:string}} input
 * @returns {string[]}
 */
const buildAsOfRequestedModes = ({ runCode, runProse, runRecords, searchMode }) => {
  const requested = [];
  if (runCode) requested.push('code');
  if (runProse) requested.push('prose');
  if (runRecords) requested.push('records');
  if ((searchMode === 'extracted-prose' || searchMode === 'all') && !requested.includes('extracted-prose')) {
    requested.push('extracted-prose');
  }
  return requested;
};

/**
 * Resolve `--as-of` index targeting and validate strict mode metadata presence.
 *
 * @param {{
 *   rootDir:string,
 *   userConfig:object,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runRecords:boolean,
 *   searchMode:string,
 *   asOf:string|null|undefined,
 *   snapshot:string|null|undefined
 * }} input
 * @returns {Promise<{
 *   asOfContext:object|null,
 *   indexResolveOptions:object,
 *   resolveSearchIndexDir:(mode:string)=>string,
 *   strictIndexMetaByMode:Map<string,boolean>,
 *   error:{message:string,code:string}|null
 * }>}
 */
export const resolveStartupIndexResolution = async ({
  rootDir,
  userConfig,
  runCode,
  runProse,
  runRecords,
  searchMode,
  asOf,
  snapshot
}) => {
  const asOfRequestedModes = buildAsOfRequestedModes({
    runCode,
    runProse,
    runRecords,
    searchMode
  });
  let asOfContext = null;
  try {
    asOfContext = resolveAsOfContext({
      repoRoot: rootDir,
      userConfig,
      requestedModes: asOfRequestedModes,
      asOf,
      snapshot,
      preferFrozen: true,
      allowMissingModesForLatest: true
    });
  } catch (err) {
    return {
      asOfContext: null,
      indexResolveOptions: {},
      resolveSearchIndexDir: () => null,
      strictIndexMetaByMode: new Map(),
      error: {
        message: err?.message || 'Invalid --as-of value.',
        code: err?.code || ERROR_CODES.INVALID_REQUEST
      }
    };
  }
  const indexResolveOptions = asOfContext?.strict
    ? {
      indexDirByMode: asOfContext.indexDirByMode,
      indexBaseRootByMode: asOfContext.indexBaseRootByMode,
      explicitRef: true
    }
    : {};
  const resolvedIndexDirByMode = new Map();
  const resolveSearchIndexDir = (mode) => {
    if (resolvedIndexDirByMode.has(mode)) return resolvedIndexDirByMode.get(mode);
    const resolved = resolveIndexDir(rootDir, mode, userConfig, indexResolveOptions);
    resolvedIndexDirByMode.set(mode, resolved);
    return resolved;
  };
  const strictIndexMetaByMode = new Map();
  if (asOfContext?.strict) {
    const strictChecks = await Promise.all(
      asOfRequestedModes.map(async (mode) => {
        let modeDir = null;
        try {
          modeDir = resolveSearchIndexDir(mode);
        } catch (err) {
          return { mode, modeDir: null, hasMeta: false, error: err };
        }
        const hasMeta = await hasIndexMetaAsync(modeDir);
        strictIndexMetaByMode.set(mode, hasMeta);
        return { mode, modeDir, hasMeta, error: null };
      })
    );
    for (const check of strictChecks) {
      if (check?.error) {
        return {
          asOfContext,
          indexResolveOptions,
          resolveSearchIndexDir,
          strictIndexMetaByMode,
          error: {
            message: check.error?.message || `[search] ${check.mode} index is unavailable for --as-of ${asOfContext.ref}.`,
            code: check.error?.code || ERROR_CODES.NO_INDEX
          }
        };
      }
      if (!check.hasMeta) {
        return {
          asOfContext,
          indexResolveOptions,
          resolveSearchIndexDir,
          strictIndexMetaByMode,
          error: {
            message: `[search] ${check.mode} index not found at ${check.modeDir} for --as-of ${asOfContext.ref}.`,
            code: ERROR_CODES.NO_INDEX
          }
        };
      }
    }
  }
  return {
    asOfContext,
    indexResolveOptions,
    resolveSearchIndexDir,
    strictIndexMetaByMode,
    error: null
  };
};

/**
 * Load per-mode index state records with shared warning propagation.
 *
 * @param {{
 *   rootDir:string,
 *   userConfig:object,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runExtractedProse:boolean,
 *   runRecords:boolean,
 *   indexResolveOptions:object,
 *   addProfileWarning:(line:string)=>void
 * }} input
 * @returns {{
 *   code:object|null,
 *   prose:object|null,
 *   extractedProse:object|null,
 *   records:object|null
 * }}
 */
export const loadSearchIndexStates = ({
  rootDir,
  userConfig,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  indexResolveOptions,
  addProfileWarning
}) => {
  const loadModeState = (mode, enabled) => {
    if (!enabled) return null;
    return loadIndexState(rootDir, userConfig, mode, {
      resolveOptions: indexResolveOptions,
      onCompatibilityWarning: addProfileWarning
    });
  };
  return {
    code: loadModeState('code', runCode),
    prose: loadModeState('prose', runProse),
    extractedProse: loadModeState('extracted-prose', runExtractedProse),
    records: loadModeState('records', runRecords)
  };
};

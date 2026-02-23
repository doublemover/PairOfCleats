import { buildIgnoreMatcher } from '../ignore.js';
import { resolveRuntimeDictionaries } from './dictionaries.js';

/**
 * Resolve dictionaries and ignore matcher while preserving startup ordering.
 *
 * Sequencing contract:
 * - Start ignore matcher loading first to overlap IO with dictionary loading.
 * - Await dictionary resolution before ignore resolution to preserve stable
 *   init-log ordering (`dictionaries` logs before `ignore rules` timing).
 * - Surface ignore matcher errors only after dictionaries complete so side
 *   effects and logs remain consistent with historical startup behavior.
 *
 * @param {{
 *   root:string,
 *   userConfig:object,
 *   generatedPolicy:object,
 *   workerPoolConfig:object,
 *   daemonSession:object|null,
 *   log:(line:string)=>void,
 *   logInit:(label:string,startedAt:number)=>void
 * }} input
 * @returns {Promise<object>}
 */
export const resolveRuntimeDictionaryIgnoreState = async ({
  root,
  userConfig,
  generatedPolicy,
  workerPoolConfig,
  daemonSession,
  log,
  logInit
}) => {
  const ignoreRulesStartedAt = Date.now();
  const ignoreRulesPromise = buildIgnoreMatcher({ root, userConfig, generatedPolicy })
    .then((value) => ({ value, error: null }), (error) => ({ value: null, error }));
  const dictionaryState = await resolveRuntimeDictionaries({
    root,
    userConfig,
    workerPoolConfig,
    daemonSession,
    log,
    logInit
  });
  const ignoreRulesResult = await ignoreRulesPromise;
  if (ignoreRulesResult.error) throw ignoreRulesResult.error;
  logInit('ignore rules', ignoreRulesStartedAt);
  const {
    ignoreMatcher,
    config: ignoreConfig,
    ignoreFiles,
    warnings: ignoreWarnings
  } = ignoreRulesResult.value;
  return {
    ...dictionaryState,
    ignoreMatcher,
    ignoreConfig,
    ignoreFiles,
    ignoreWarnings
  };
};

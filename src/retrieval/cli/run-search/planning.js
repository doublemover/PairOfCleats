import {
  applyAdaptiveDictConfig,
  getDictConfig
} from '../../../../tools/shared/dict-utils.js';
import { getIndexSignature } from '../../cli-index.js';
import { loadDictionary } from '../../cli-dictionary.js';
import { resolveIndexedFileCount } from '../options.js';
import { buildQueryPlan } from '../query-plan.js';
import { compileFilterPredicates } from '../../output/filters.js';
import {
  buildQueryPlanCacheKey,
  buildQueryPlanConfigSignature,
  buildQueryPlanIndexSignature,
  createQueryPlanEntry
} from '../../query-plan-cache.js';
import {
  DEFAULT_CODE_DICT_LANGUAGES,
  normalizeCodeDictLanguages
} from '../../../shared/code-dictionaries.js';

const BASE_CODE_DICT_LANGUAGES = Object.freeze(
  Array.from(normalizeCodeDictLanguages(DEFAULT_CODE_DICT_LANGUAGES))
);
const EMPTY_LANGUAGE_LIST = Object.freeze([]);

const resolveCodeDictLanguageList = (langFilter) => {
  if (!Array.isArray(langFilter) || !langFilter.length) {
    return BASE_CODE_DICT_LANGUAGES;
  }
  const filtered = normalizeCodeDictLanguages(langFilter);
  if (!filtered.size) return BASE_CODE_DICT_LANGUAGES;
  const selected = [];
  for (const language of BASE_CODE_DICT_LANGUAGES) {
    if (filtered.has(language)) selected.push(language);
  }
  return selected;
};

/**
 * Build dictionary and query plan with cache invalidation.
 *
 * Ordering is subtle and must remain stable:
 * 1) compute config signature and reset stale cache entries first;
 * 2) then compute index signature and lookup cache key;
 * 3) only then read/write the entry.
 * Reordering these steps can mix plans across incompatible settings.
 *
 * @param {{
 *   stageTracker:{mark:()=>number,record:(name:string,start:number,meta:object)=>void},
 *   throwIfAborted?:()=>void,
 *   rootDir:string,
 *   userConfig:object,
 *   metricsDir:string,
 *   query:string,
 *   argv:Record<string, any>,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runExtractedProse:boolean,
 *   runRecords:boolean,
 *   langFilter:string[]|null,
 *   queryPlanCache:object|null,
 *   planInput:object,
 *   fileChargramN:number,
 *   indexSignatureInput:object
 * }} input
 * @returns {Promise<{queryPlan:object,planIndexSignaturePayload:string|null}>}
 */
export const resolveDictionaryAndQueryPlan = async ({
  stageTracker,
  throwIfAborted,
  rootDir,
  userConfig,
  metricsDir,
  query,
  argv,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  langFilter,
  queryPlanCache,
  planInput,
  fileChargramN,
  indexSignatureInput
}) => {
  const dictConfig = applyAdaptiveDictConfig(
    getDictConfig(rootDir, userConfig),
    resolveIndexedFileCount(metricsDir, {
      runCode,
      runProse,
      runExtractedProse,
      runRecords
    })
  );
  const codeDictLanguages = runCode ? resolveCodeDictLanguageList(langFilter) : EMPTY_LANGUAGE_LIST;
  const includeCode = runCode && codeDictLanguages.length > 0;

  const dictStart = stageTracker.mark();
  const { dict } = await loadDictionary(rootDir, dictConfig, {
    includeCode,
    codeDictLanguages
  });
  stageTracker.record('startup.dictionary', dictStart, { mode: 'all' });
  if (typeof throwIfAborted === 'function') throwIfAborted();

  const planStart = stageTracker.mark();
  const planConfigSignature = queryPlanCache?.enabled !== false
    ? buildQueryPlanConfigSignature({
      dictConfig,
      dictSize: dict?.size ?? null,
      ...planInput
    })
    : null;
  if (planConfigSignature && typeof queryPlanCache?.resetIfConfigChanged === 'function') {
    queryPlanCache.resetIfConfigChanged(planConfigSignature);
  }

  const planIndexSignaturePayload = planConfigSignature
    ? await getIndexSignature(indexSignatureInput)
    : null;
  const planIndexSignature = planConfigSignature
    ? buildQueryPlanIndexSignature(planIndexSignaturePayload)
    : null;
  const planCacheKeyInfo = planConfigSignature
    ? buildQueryPlanCacheKey({
      query,
      configSignature: planConfigSignature,
      indexSignature: planIndexSignature
    })
    : null;
  const cachedPlanEntry = planCacheKeyInfo
    ? queryPlanCache?.get?.(planCacheKeyInfo.key, {
      configSignature: planConfigSignature,
      indexSignature: planIndexSignature
    })
    : null;

  const parseStart = stageTracker.mark();
  const queryPlan = cachedPlanEntry?.plan || buildQueryPlan({
    query,
    argv,
    dict,
    dictConfig,
    ...planInput
  });
  if (!queryPlan.filterPredicates) {
    queryPlan.filterPredicates = compileFilterPredicates(queryPlan.filters, { fileChargramN });
  }
  stageTracker.record('parse', parseStart, { mode: 'all' });

  if (!cachedPlanEntry && planCacheKeyInfo && planConfigSignature && typeof queryPlanCache?.set === 'function') {
    queryPlanCache.set(
      planCacheKeyInfo.key,
      createQueryPlanEntry({
        plan: queryPlan,
        configSignature: planConfigSignature,
        indexSignature: planIndexSignature,
        keyPayload: planCacheKeyInfo.payload
      })
    );
  }
  stageTracker.record('startup.query-plan', planStart, { mode: 'all' });

  return {
    queryPlan,
    planIndexSignaturePayload
  };
};

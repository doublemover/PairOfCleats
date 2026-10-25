import { createHash } from 'node:crypto';
import { stableStringify, stableStringifyForSignature } from '../../shared/stable-json.js';
import { resolveRunConfig } from './resolve-run-config.js';
import { resolveFieldWeightsPolicy } from '../query-intent.js';
import { resolveGraphRankingPolicy } from '../pipeline/graph-ranking-policy.js';
import { DEFAULT_CODE_DICT_LANGUAGES, normalizeCodeDictLanguages } from '../../shared/code-dictionaries.js';

export const INTERNAL_SEARCH_POLICY = Symbol('captured-search-policy');
const captures = new WeakMap();
const operationalKeys = new Set(['queryCacheEnabled', 'queryCacheMaxEntries', 'queryCacheTtlMs',
  'queryCacheStrategy', 'queryCachePrewarm', 'queryCachePrewarmMaxEntries', 'queryCacheMemoryFreshMs']);

/** Reuse the runtime projection, not a second copy of its option names. Raw
 * config/credentials stay private; only resolved result-affecting policy hashes. */
const resolveCanonicalSearchPolicy = ({ scoreModeOverride = null,
  normalized, userConfig, policy, modelConfig, dictConfig, useStubEmbeddings }) => {
  const runtime = resolveRunConfig({ normalized, scoreModeOverride });
  for (const key of operationalKeys) delete runtime[key];
  runtime.fieldWeightsConfig = resolveFieldWeightsPolicy(runtime.fieldWeightsConfig);
  runtime.graphRankingConfig = resolveGraphRankingPolicy(runtime.graphRankingConfig);
  const canonical = { version: 1, runtime, model: modelConfig,
    dictionary: dictConfig, useStubEmbeddings,
    codeDictLanguages: [...normalizeCodeDictLanguages(userConfig?.indexing?.codeDictLanguages ?? DEFAULT_CODE_DICT_LANGUAGES)].sort(),
    adaptiveProviders: userConfig?.retrieval?.ann?.adaptiveProviders !== false,
    backendDefault: runtime.backendArg ? null : policy?.retrieval?.backend || 'sqlite', vectorOnly: policy?.vectorOnly === true };
  return canonical;
};

export const resolveEffectiveSearchPlanIdentity = input => 'eqp1-' + createHash('sha256')
  .update(stableStringifyForSignature(resolveCanonicalSearchPolicy(input))).digest('hex');

// Query input keeps its invocation identity above; system consistency describes
// the unchanged result policy across different selected evaluation queries.
export const resolveObservedSearchSystemIdentity = input => {
  const canonical = resolveCanonicalSearchPolicy(input);
  delete canonical.runtime.query;
  return 'esp1-' + createHash('sha256').update(stableStringifyForSignature(canonical)).digest('hex');
};

/** Storage selection is not a score unit. Preserve the complete resolved model,
 * dictionary and ranking policy; actual provider/formula and source identities
 * are independently bound by the ranking/output owners. */
export const resolveEffectiveScorePolicyIdentity = input => {
  const canonical = resolveCanonicalSearchPolicy(input);
  delete canonical.runtime.backendArg;
  delete canonical.backendDefault;
  return 'sqp1-' + createHash('sha256').update(stableStringifyForSignature(canonical)).digest('hex');
};

export const captureEffectiveSearchPlan = ({ rootDir, rawArgs, exactMode = null, scoreModeOverride = null,
  normalized, userConfig, policy, modelConfig, dictConfig, useStubEmbeddings }) => {
  const identity = resolveEffectiveSearchPlanIdentity({ normalized, userConfig, policy, modelConfig, dictConfig,
    useStubEmbeddings, scoreModeOverride });
  const token = Object.freeze({ identity });
  captures.set(token, { rootDir, args: stableStringify(rawArgs), exactMode, scoreModeOverride,
    // Complete capability reporting is lazy and unrelated to query policy.
    // Do not enumerate/clone that getter while capturing the consumed policy.
    data: structuredClone({ normalized, userConfig, policy: { quality: policy?.quality, retrieval: policy?.retrieval },
      modelConfig, dictConfig, useStubEmbeddings, identity }) });
  return token;
};

/** A JSON lookalike cannot supply execution authority; bind all invocation inputs. */
export const consumeEffectiveSearchPlan = (token, { rootDir, rawArgs, exactMode = null, scoreModeOverride = null }) => {
  if (token == null) return null;
  const capture = captures.get(token);
  if (!capture || capture.rootDir !== rootDir || capture.args !== stableStringify(rawArgs)
    || capture.exactMode !== exactMode || capture.scoreModeOverride !== scoreModeOverride) {
    throw Object.assign(new Error('Search policy capture does not match this invocation.'), { code: 'ERR_SEARCH_POLICY_IDENTITY' });
  }
  return structuredClone(capture.data);
};

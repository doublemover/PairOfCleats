import { isPlainObject, mergeConfig } from '../../../shared/config.js';

const DEFAULT_AUTO_POLICY_PROFILE = Object.freeze({ id: 'default', enabled: false });
const SUPPORTED_EMBEDDING_MODES = new Set(['auto', 'inline', 'service', 'stub', 'off']);

/**
 * Apply auto-policy runtime overrides to indexing config.
 *
 * Sequencing contract:
 * 1. Huge-repo policy overrides merge first so downstream policy layers see the
 *    same expanded baseline.
 * 2. Concurrency/embedding/worker-pool overrides merge next.
 * 3. The final huge-repo marker merge runs last so later phases can gate on a
 *    stable `indexingConfig.hugeRepoProfile.enabled` value.
 *
 * @param {{indexingConfig?:object,autoPolicy?:object|null}} [input]
 * @returns {{
 *   indexingConfig:object,
 *   autoPolicyProfile:{id:string,enabled:boolean}|object,
 *   hugeRepoProfileEnabled:boolean
 * }}
 */
export const applyAutoPolicyIndexingConfig = ({ indexingConfig = {}, autoPolicy = null } = {}) => {
  let nextIndexingConfig = indexingConfig;
  const policyConcurrency = autoPolicy?.indexing?.concurrency || null;
  const policyEmbeddings = autoPolicy?.indexing?.embeddings || null;
  const policyWorkerPool = autoPolicy?.runtime?.workerPool || null;
  const autoPolicyProfile = isPlainObject(autoPolicy?.profile)
    ? autoPolicy.profile
    : { ...DEFAULT_AUTO_POLICY_PROFILE };
  const policyHugeRepoProfile = isPlainObject(autoPolicy?.indexing?.hugeRepoProfile)
    ? autoPolicy.indexing.hugeRepoProfile
    : null;
  const explicitHugeRepoProfile = isPlainObject(nextIndexingConfig?.hugeRepoProfile)
    ? nextIndexingConfig.hugeRepoProfile
    : {};
  const hugeRepoProfileEnabled = typeof explicitHugeRepoProfile.enabled === 'boolean'
    ? explicitHugeRepoProfile.enabled
    : policyHugeRepoProfile?.enabled === true;

  if (hugeRepoProfileEnabled && isPlainObject(policyHugeRepoProfile?.overrides)) {
    nextIndexingConfig = mergeConfig(nextIndexingConfig, policyHugeRepoProfile.overrides);
  }
  if (policyConcurrency) {
    nextIndexingConfig = mergeConfig(nextIndexingConfig, {
      concurrency: policyConcurrency.files,
      importConcurrency: policyConcurrency.imports,
      ioConcurrencyCap: policyConcurrency.io
    });
  }
  if (policyEmbeddings && typeof policyEmbeddings.enabled === 'boolean') {
    nextIndexingConfig = mergeConfig(nextIndexingConfig, {
      embeddings: { enabled: policyEmbeddings.enabled }
    });
  }
  if (policyWorkerPool) {
    nextIndexingConfig = mergeConfig(nextIndexingConfig, {
      workerPool: {
        enabled: policyWorkerPool.enabled !== false ? 'auto' : false,
        maxWorkers: policyWorkerPool.maxThreads
      }
    });
  }
  if (hugeRepoProfileEnabled) {
    nextIndexingConfig = mergeConfig(nextIndexingConfig, {
      hugeRepoProfile: {
        enabled: true,
        id: autoPolicyProfile.id || 'huge-repo'
      }
    });
  }
  return {
    indexingConfig: nextIndexingConfig,
    autoPolicyProfile,
    hugeRepoProfileEnabled
  };
};

/**
 * Resolve baseline embedding plan toggles before stage/profile overrides.
 *
 * @param {object} [indexingConfig]
 * @returns {{baseEmbeddingMode:string,baseEmbeddingsPlanned:boolean}}
 */
export const resolveBaseEmbeddingPlan = (indexingConfig = {}) => {
  const baseEmbeddingsConfig = indexingConfig?.embeddings && typeof indexingConfig.embeddings === 'object'
    ? indexingConfig.embeddings
    : {};
  const baseEmbeddingModeRaw = typeof baseEmbeddingsConfig.mode === 'string'
    ? baseEmbeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseEmbeddingMode = SUPPORTED_EMBEDDING_MODES.has(baseEmbeddingModeRaw)
    ? baseEmbeddingModeRaw
    : 'auto';
  return {
    baseEmbeddingMode,
    baseEmbeddingsPlanned: baseEmbeddingsConfig.enabled !== false && baseEmbeddingMode !== 'off'
  };
};

export const buildAnalysisPolicy = ({
  toolingEnabled,
  typeInferenceEnabled,
  typeInferenceCrossFileEnabled,
  riskAnalysisEnabled,
  riskAnalysisCrossFileEnabled,
  riskInterproceduralEnabled,
  riskInterproceduralSummaryOnly,
  gitBlameEnabled
}) => ({
  metadata: { enabled: true },
  risk: {
    enabled: riskAnalysisEnabled,
    crossFile: riskAnalysisCrossFileEnabled,
    interprocedural: riskInterproceduralEnabled,
    interproceduralSummaryOnly: riskInterproceduralSummaryOnly
  },
  git: {
    enabled: gitBlameEnabled,
    blame: gitBlameEnabled,
    churn: true
  },
  typeInference: {
    local: { enabled: typeInferenceEnabled },
    crossFile: { enabled: typeInferenceCrossFileEnabled },
    tooling: { enabled: typeInferenceCrossFileEnabled && toolingEnabled }
  }
});

/**
 * Build lexicon runtime config from indexing + auto-policy inputs.
 *
 * @param {object} input
 * @param {object} [input.indexingConfig]
 * @param {object|null} [input.autoPolicy]
 * @returns {object}
 */
export const buildLexiconConfig = ({ indexingConfig = {}, autoPolicy = null } = {}) => {
  const rawLexiconConfig = indexingConfig.lexicon && typeof indexingConfig.lexicon === 'object'
    ? indexingConfig.lexicon
    : {};
  const policyQualityValue = typeof autoPolicy?.quality?.value === 'string'
    ? autoPolicy.quality.value
    : null;
  const rawLexiconRelations = rawLexiconConfig.relations && typeof rawLexiconConfig.relations === 'object'
    ? rawLexiconConfig.relations
    : {};
  const rawLexiconDrop = rawLexiconRelations.drop && typeof rawLexiconRelations.drop === 'object'
    ? rawLexiconRelations.drop
    : {};
  const lexiconConfig = {
    enabled: rawLexiconConfig.enabled !== false,
    relations: {
      enabled: typeof rawLexiconRelations.enabled === 'boolean'
        ? rawLexiconRelations.enabled
        : policyQualityValue === 'max',
      stableDedupe: rawLexiconRelations.stableDedupe === true,
      drop: {
        keywords: rawLexiconDrop.keywords !== false,
        literals: rawLexiconDrop.literals !== false,
        builtins: rawLexiconDrop.builtins === true,
        types: rawLexiconDrop.types === true
      }
    }
  };
  if (rawLexiconConfig.languageOverrides && typeof rawLexiconConfig.languageOverrides === 'object') {
    lexiconConfig.languageOverrides = rawLexiconConfig.languageOverrides;
  }
  return lexiconConfig;
};

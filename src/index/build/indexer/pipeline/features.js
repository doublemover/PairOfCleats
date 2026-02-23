import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';

/**
 * Resolve effective analysis feature flags with policy overrides.
 * Runtime toggles provide defaults; explicit policy booleans take precedence.
 *
 * @param {object} runtime
 * @returns {{gitBlame:boolean,typeInference:boolean,typeInferenceCrossFile:boolean,riskAnalysis:boolean,riskAnalysisCrossFile:boolean}}
 */
export const resolveAnalysisFlags = (runtime) => {
  const policy = runtime.analysisPolicy || {};
  return {
    gitBlame: typeof policy?.git?.blame === 'boolean' ? policy.git.blame : runtime.gitBlameEnabled,
    typeInference: typeof policy?.typeInference?.local?.enabled === 'boolean'
      ? policy.typeInference.local.enabled
      : runtime.typeInferenceEnabled,
    typeInferenceCrossFile: typeof policy?.typeInference?.crossFile?.enabled === 'boolean'
      ? policy.typeInference.crossFile.enabled
      : runtime.typeInferenceCrossFileEnabled,
    riskAnalysis: typeof policy?.risk?.enabled === 'boolean' ? policy.risk.enabled : runtime.riskAnalysisEnabled,
    riskAnalysisCrossFile: typeof policy?.risk?.crossFile === 'boolean'
      ? policy.risk.crossFile
      : runtime.riskAnalysisCrossFileEnabled
  };
};

/**
 * Vector-only builds can proceed when embeddings are either immediately
 * available (`embeddingEnabled`) or deferred to service queueing
 * (`embeddingService`).
 *
 * @param {object} runtime
 * @returns {boolean}
 */
export const hasVectorEmbeddingBuildCapability = (runtime) => (
  runtime?.embeddingEnabled === true || runtime?.embeddingService === true
);

/**
 * Resolve vector-only profile shortcut policy for downstream stages.
 *
 * @param {object} runtime
 * @returns {{profileId:string,enabled:boolean,disableImportGraph:boolean,disableCrossFileInference:boolean}}
 */
export const resolveVectorOnlyShortcutPolicy = (runtime) => {
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const config = runtime?.indexingConfig?.vectorOnly && typeof runtime.indexingConfig.vectorOnly === 'object'
    ? runtime.indexingConfig.vectorOnly
    : {};
  return {
    profileId,
    enabled: vectorOnly,
    disableImportGraph: vectorOnly ? config.disableImportGraph !== false : false,
    disableCrossFileInference: vectorOnly ? config.disableCrossFileInference !== false : false
  };
};

/**
 * Build the effective feature toggle set for a mode from runtime settings,
 * analysis policy flags, and index profile behavior.
 *
 * @param {object} runtime
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @returns {object}
 */
export const buildFeatureSettings = (runtime, mode) => {
  const analysisFlags = resolveAnalysisFlags(runtime);
  const profileId = runtime?.profile?.id || runtime?.indexingConfig?.profile || 'default';
  const vectorOnly = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtime);
  return {
    profileId,
    // Query-AST filtering depends on per-chunk tokens even for vector_only retrieval.
    // Keep tokenization enabled while still disabling sparse postings artifacts.
    tokenize: true,
    postings: !vectorOnly,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    gitBlame: analysisFlags.gitBlame,
    pythonAst: runtime.languageOptions?.pythonAst?.enabled !== false && mode === 'code',
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    typeInference: analysisFlags.typeInference && mode === 'code',
    riskAnalysis: analysisFlags.riskAnalysis && mode === 'code',
    lint: runtime.lintEnabled && mode === 'code',
    complexity: runtime.complexityEnabled && mode === 'code',
    astDataflow: runtime.astDataflowEnabled && mode === 'code',
    controlFlow: runtime.controlFlowEnabled && mode === 'code',
    typeInferenceCrossFile: analysisFlags.typeInferenceCrossFile && mode === 'code',
    riskAnalysisCrossFile: analysisFlags.riskAnalysisCrossFile && mode === 'code',
    vectorOnlyShortcuts: vectorOnlyShortcuts.enabled
      ? {
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
      }
      : null
  };
};

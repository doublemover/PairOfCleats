import { sha1 } from '../../../shared/hash.js';

export const buildTokenizationKey = (runtime, mode) => {
  const commentsConfig = runtime.commentsConfig || {};
  const payload = {
    mode,
    dictConfig: runtime.dictConfig || {},
    postingsConfig: runtime.postingsConfig || {},
    dictSignature: runtime.dictSignature || null,
    segmentsConfig: runtime.segmentsConfig || {},
    commentsConfig: {
      ...commentsConfig,
      licensePattern: commentsConfig.licensePattern?.source || null,
      generatedPattern: commentsConfig.generatedPattern?.source || null,
      linterPattern: commentsConfig.linterPattern?.source || null
    }
  };
  return sha1(JSON.stringify(payload));
};

export const buildIncrementalSignature = (runtime, mode, tokenizationKey) => {
  const languageOptions = runtime.languageOptions || {};
  const payload = {
    mode,
    tokenizationKey,
    features: {
      astDataflowEnabled: runtime.astDataflowEnabled,
      controlFlowEnabled: runtime.controlFlowEnabled,
      lintEnabled: runtime.lintEnabled,
      complexityEnabled: runtime.complexityEnabled,
      riskAnalysisEnabled: runtime.riskAnalysisEnabled,
      riskAnalysisCrossFileEnabled: runtime.riskAnalysisCrossFileEnabled,
      typeInferenceEnabled: runtime.typeInferenceEnabled,
      typeInferenceCrossFileEnabled: runtime.typeInferenceCrossFileEnabled,
      gitBlameEnabled: runtime.gitBlameEnabled
    },
    riskRules: runtime.indexingConfig?.riskRules || null,
    riskCaps: runtime.indexingConfig?.riskCaps || null,
    parsers: {
      javascript: languageOptions.javascript?.parser || null,
      javascriptFlow: languageOptions.javascript?.flow || null,
      typescript: languageOptions.typescript?.parser || null,
      typescriptImportsOnly: languageOptions.typescript?.importsOnly === true
    },
    treeSitter: languageOptions.treeSitter
      ? {
        enabled: languageOptions.treeSitter.enabled !== false,
        languages: languageOptions.treeSitter.languages || {},
        configChunking: languageOptions.treeSitter.configChunking === true,
        maxBytes: languageOptions.treeSitter.maxBytes ?? null,
        maxLines: languageOptions.treeSitter.maxLines ?? null,
        maxParseMs: languageOptions.treeSitter.maxParseMs ?? null,
        byLanguage: languageOptions.treeSitter.byLanguage || {}
      }
      : { enabled: false },
    importScan: runtime.indexingConfig?.importScan ?? null,
    yamlChunking: languageOptions.yamlChunking || null,
    kotlin: languageOptions.kotlin || null,
    embeddings: {
      enabled: runtime.embeddingEnabled || runtime.embeddingService,
      mode: runtime.embeddingMode,
      service: runtime.embeddingService === true,
      batchSize: runtime.embeddingBatchSize
    },
    fileCaps: runtime.fileCaps,
    fileScan: runtime.fileScan,
    incrementalBundleFormat: runtime.incrementalBundleFormat || null
  };
  return sha1(JSON.stringify(payload));
};

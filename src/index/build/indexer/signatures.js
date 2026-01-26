import { ARTIFACT_SCHEMA_HASH } from '../../../contracts/registry.js';
import { sha1 } from '../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';

export { ARTIFACT_SCHEMA_HASH };

export const SIGNATURE_VERSION = 2;

const normalizeRegex = (value) => (value instanceof RegExp ? value : (value || null));

export const buildIncrementalSignatureSummary = (payload, mode = null, tokenizationKey = null) => {
  const resolvedPayload = mode != null
    ? buildIncrementalSignaturePayload(payload, mode, tokenizationKey)
    : payload;
  if (!resolvedPayload || typeof resolvedPayload !== 'object') return {};
  const summary = {};
  for (const key of Object.keys(resolvedPayload).sort()) {
    summary[key] = sha1(stableStringifyForSignature(resolvedPayload[key]));
  }
  return summary;
};

export const buildIncrementalSignaturePayload = (runtime, mode, tokenizationKey) => {
  const languageOptions = runtime.languageOptions || {};
  const derivedSchemaVersion = runtime.toolInfo?.version || null;
  const analysisPolicy = runtime.analysisPolicy || {};
  const riskAnalysisEnabled = typeof analysisPolicy?.risk?.enabled === 'boolean'
    ? analysisPolicy.risk.enabled
    : runtime.riskAnalysisEnabled;
  const riskAnalysisCrossFileEnabled = typeof analysisPolicy?.risk?.crossFile === 'boolean'
    ? analysisPolicy.risk.crossFile
    : runtime.riskAnalysisCrossFileEnabled;
  const typeInferenceEnabled = typeof analysisPolicy?.typeInference?.local?.enabled === 'boolean'
    ? analysisPolicy.typeInference.local.enabled
    : runtime.typeInferenceEnabled;
  const typeInferenceCrossFileEnabled = typeof analysisPolicy?.typeInference?.crossFile?.enabled === 'boolean'
    ? analysisPolicy.typeInference.crossFile.enabled
    : runtime.typeInferenceCrossFileEnabled;
  const gitBlameEnabled = typeof analysisPolicy?.git?.blame === 'boolean'
    ? analysisPolicy.git.blame
    : runtime.gitBlameEnabled;
  return {
    signatureVersion: SIGNATURE_VERSION,
    mode,
    tokenizationKey,
    cacheSchemaVersion: derivedSchemaVersion,
    artifactSchemaHash: ARTIFACT_SCHEMA_HASH,
    features: {
      astDataflowEnabled: runtime.astDataflowEnabled,
      controlFlowEnabled: runtime.controlFlowEnabled,
      lintEnabled: runtime.lintEnabled,
      complexityEnabled: runtime.complexityEnabled,
      riskAnalysisEnabled,
      riskAnalysisCrossFileEnabled,
      typeInferenceEnabled,
      typeInferenceCrossFileEnabled,
      gitBlameEnabled
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
      batchSize: runtime.embeddingBatchSize,
      identityKey: runtime.embeddingIdentityKey || null
    },
    fileCaps: runtime.fileCaps,
    fileScan: runtime.fileScan,
    incrementalBundleFormat: runtime.incrementalBundleFormat || null
  };
};

export const buildTokenizationKey = (runtime, mode) => {
  const commentsConfig = runtime.commentsConfig || {};
  const dictConfig = runtime.dictConfig || {};
  const { dir: _dictDir, ...dictConfigPayload } = dictConfig;
  const payload = {
    signatureVersion: SIGNATURE_VERSION,
    mode,
    dictConfig: dictConfigPayload,
    postingsConfig: runtime.postingsConfig || {},
    dictSignature: runtime.dictSignature || null,
    segmentsConfig: runtime.segmentsConfig || {},
    commentsConfig: {
      ...commentsConfig,
      licensePattern: normalizeRegex(commentsConfig.licensePattern),
      generatedPattern: normalizeRegex(commentsConfig.generatedPattern),
      linterPattern: normalizeRegex(commentsConfig.linterPattern)
    }
  };
  return sha1(stableStringifyForSignature(payload));
};

export const buildIncrementalSignature = (runtime, mode, tokenizationKey) => {
  const payload = buildIncrementalSignaturePayload(runtime, mode, tokenizationKey);
  return sha1(stableStringifyForSignature(payload));
};

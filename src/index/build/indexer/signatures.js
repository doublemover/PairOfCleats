import { IMPORT_EXTRACTION_VERSION, importExtractionRuntimeVersions } from '../../../shared/import-extraction.js';
import { sqlRelationParserVersion } from '../../../lang/sql/version.js';
import { resolveCrossFileFidelity } from '../../cross-file-fidelity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { SCORING_ANALYZER_VERSION } from '../../../shared/tokenize-identifiers.js';
import { TEXT_ANALYZER_VERSION } from '../../../shared/text-analyzer.js';
import { ARTIFACT_SCHEMA_HASH } from '../../../contracts/registry.js';
import { CHUNK_ID_ALGO_VERSION } from '../../../contracts/compatibility.js';
import {
  INDEX_PROFILE_DEFAULT,
  INDEX_PROFILE_SCHEMA_VERSION,
  normalizeIndexProfileId
} from '../../../contracts/index-profile.js';
import { sha1 } from '../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { MAX_JSON_BYTES } from '../../../shared/artifact-io/constants.js';
import { MODULE_EXPORTS_VERSION } from '../../../lang/js-ts-exports.js';
import { TREE_SITTER_CHUNK_VERSION } from '../../../lang/tree-sitter/config.js';
import { MINHASH_HASH_IDENTITY } from '../../minhash.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../semantic/analysis-versions.js';
import { DOCX_STRUCTURAL_EXTRACTION_VERSION, PDF_TEXT_EXTRACTION_VERSION } from '../../extractors/common.js';
import { getRiskRulesPolicyReceipt } from '../../risk-rule-receipt.js';
import { lintPolicyDependency } from '../../lint-policy.js';
import { GENERATED_ARTIFACT_POLICY_VERSION } from '../../../shared/generated-artifact-observation.js';
import { COMMENT_CLASSIFICATION_VERSION } from '../../comments-policy.js';

export { ARTIFACT_SCHEMA_HASH };

// v14 binds capped discovery to its deterministic accepted-source ordering.
export const SIGNATURE_VERSION = 14;

const normalizeRegex = (value) => (value instanceof RegExp ? value : (value || null));

/**
 * Build hashed per-field summary for incremental signature payload.
 *
 * @param {object} payload
 * @param {string|null} [mode]
 * @param {string|null} [tokenizationKey]
 * @returns {Record<string,string>}
 */
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

/**
 * Build full incremental signature payload from runtime + mode settings.
 *
 * @param {object} runtime
 * @param {string} mode
 * @param {string|null} tokenizationKey
 * @returns {object}
 */
export const buildIncrementalSignaturePayload = (runtime, mode, tokenizationKey) => {
  const languageOptions = runtime.languageOptions || {};
  const indexingConfig = runtime.indexingConfig || {};
  const derivedSchemaVersion = runtime.toolInfo?.version || null;
  const analysisPolicy = runtime.analysisPolicy || {};
  const riskAnalysisEnabled = typeof analysisPolicy?.risk?.enabled === 'boolean'
    ? analysisPolicy.risk.enabled
    : runtime.riskAnalysisEnabled;
  const riskAnalysisCrossFileEnabled = typeof analysisPolicy?.risk?.crossFile === 'boolean'
    ? analysisPolicy.risk.crossFile
    : runtime.riskAnalysisCrossFileEnabled;
  const riskInterproceduralEnabled = typeof analysisPolicy?.risk?.interprocedural === 'boolean'
    ? analysisPolicy.risk.interprocedural
    : runtime.riskInterproceduralEnabled;
  const riskInterproceduralSummaryOnly = typeof analysisPolicy?.risk?.interproceduralSummaryOnly === 'boolean'
    ? analysisPolicy.risk.interproceduralSummaryOnly
    : runtime.riskInterproceduralConfig?.summaryOnly === true;
  const modeRiskInterproceduralEnabled = mode === 'code' && riskInterproceduralEnabled === true;
  const modeRiskInterproceduralSummaryOnly = modeRiskInterproceduralEnabled && riskInterproceduralSummaryOnly === true;
  const typeInferenceEnabled = typeof analysisPolicy?.typeInference?.local?.enabled === 'boolean'
    ? analysisPolicy.typeInference.local.enabled
    : runtime.typeInferenceEnabled;
  const typeInferenceCrossFileEnabled = typeof analysisPolicy?.typeInference?.crossFile?.enabled === 'boolean'
    ? analysisPolicy.typeInference.crossFile.enabled
    : runtime.typeInferenceCrossFileEnabled;
  const gitBlameEnabled = typeof analysisPolicy?.git?.blame === 'boolean'
    ? analysisPolicy.git.blame
    : runtime.gitBlameEnabled;
  const scmHead = runtime.repoProvenance?.head || null;
  const scmSignature = runtime.repoProvenance
    ? {
      provider: runtime.repoProvenance.provider || null,
      head: {
        commitId: scmHead?.commitId || runtime.repoProvenance?.commit || null,
        changeId: scmHead?.changeId || null,
        operationId: scmHead?.operationId || null
      }
    }
    : null;
  const runtimeProfile = runtime.profile && typeof runtime.profile === 'object'
    ? runtime.profile
    : {};
  return {
    signatureVersion: SIGNATURE_VERSION,
    literalAnalyzer: TEXT_ANALYZER_VERSION,
    moduleExportsProducer: MODULE_EXPORTS_VERSION,
    nativeChunkProducer: TREE_SITTER_CHUNK_VERSION,
    discoverySelectionProducer: SEMANTIC_ANALYSIS_VERSIONS.discoverySelection,
    minhashHashIdentity: MINHASH_HASH_IDENTITY,
    mode,
    tokenizationKey,
    cacheSchemaVersion: derivedSchemaVersion,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    artifactSchemaHash: ARTIFACT_SCHEMA_HASH,
    features: {
      astDataflowEnabled: runtime.astDataflowEnabled,
      controlFlowEnabled: runtime.controlFlowEnabled,
      lintEnabled: runtime.lintEnabled,
      ...(runtime.lintEnabled !== false ? { lintProjectionProducer: SEMANTIC_ANALYSIS_VERSIONS.lintProjection,
        lintPolicy: lintPolicyDependency(runtime.root, runtime.lintPolicy) } : {}),
      complexityEnabled: runtime.complexityEnabled,
      complexityAnalyzer: '2',
      riskAnalysisEnabled,
      riskAnalysisCrossFileEnabled,
      riskInterproceduralEnabled: modeRiskInterproceduralEnabled,
      riskInterproceduralSummaryOnly: modeRiskInterproceduralSummaryOnly,
      typeInferenceEnabled,
      typeInferenceCrossFileEnabled,
      crossFileFidelity: resolveCrossFileFidelity(indexingConfig.crossFileFidelity),
      gitBlameEnabled
    },
    riskInterproceduralConfig: runtime.riskInterproceduralConfig
      ? {
        ...runtime.riskInterproceduralConfig,
        enabled: modeRiskInterproceduralEnabled,
        summaryOnly: modeRiskInterproceduralSummaryOnly
      }
      : null,
    riskRules: indexingConfig.riskRules || null,
    riskRegex: indexingConfig.riskRegex || null,
    riskPolicyReceipt: getRiskRulesPolicyReceipt(runtime.riskConfig?.rules),
    riskCaps: indexingConfig.riskCaps || null,
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
    lexicon: languageOptions.lexicon
      ? {
        enabled: languageOptions.lexicon.enabled !== false,
        relations: languageOptions.lexicon.relations || null,
        languageOverrides: languageOptions.lexicon.languageOverrides || null
      }
      : { enabled: true },
    importScan: indexingConfig.importScan ?? null,
    yamlChunking: languageOptions.yamlChunking || null,
    kotlin: languageOptions.kotlin || null,
    chunkIdAlgoVersion: CHUNK_ID_ALGO_VERSION,
    profile: {
      id: normalizeIndexProfileId(
        runtimeProfile.id ?? indexingConfig.profile,
        INDEX_PROFILE_DEFAULT
      ),
      schemaVersion: Number.isFinite(Number(runtimeProfile.schemaVersion))
        ? Math.max(1, Math.floor(Number(runtimeProfile.schemaVersion)))
        : INDEX_PROFILE_SCHEMA_VERSION
    },
    scm: scmSignature,
    embeddings: {
      enabled: runtime.embeddingEnabled || runtime.embeddingService,
      mode: runtime.embeddingMode,
      service: runtime.embeddingService === true,
      batchSize: runtime.embeddingBatchSize,
      identityKey: runtime.embeddingIdentityKey || null
    },
    fileCaps: runtime.fileCaps,
    fileScan: runtime.fileScan,
    incrementalBundleFormat: runtime.incrementalBundleFormat || null,
    artifacts: {
      maxJsonBytes: MAX_JSON_BYTES,
      formats: indexingConfig.artifacts || null,
      byteBudgets: indexingConfig.byteBudgets || indexingConfig.byteBudget || null,
      indexer: indexingConfig.indexer || null
    },
    ...(mode === 'extracted-prose' ? { documentExtraction: runtime.documentExtractionAdmission
      || { enabled: indexingConfig.documentExtraction?.enabled === true, qualified: false } } : {})
  };
};

/**
 * Build tokenization key used in incremental signature inputs.
 *
 * @param {object} runtime
 * @param {string} mode
 * @returns {string}
 */
export const buildTokenizationKey = (runtime, mode) => {
  const commentsConfig = runtime.commentsConfig || {};
  const dictConfig = runtime.dictConfig || {};
  const { dir: _dictDir, ...dictConfigPayload } = dictConfig;
  const payload = {
    signatureVersion: SIGNATURE_VERSION,
    scoringAnalyzer: SCORING_ANALYZER_VERSION,
    minhashHashIdentity: MINHASH_HASH_IDENTITY,
    mode,
    dictConfig: dictConfigPayload,
    postingsConfig: runtime.postingsConfig || {},
    dictSignature: runtime.dictSignature || null,
    segmentsConfig: runtime.segmentsConfig || {},
    commentsConfig: {
      ...commentsConfig,
      classificationVersion: COMMENT_CLASSIFICATION_VERSION,
      licensePattern: normalizeRegex(commentsConfig.licensePattern),
      generatedPattern: normalizeRegex(commentsConfig.generatedPattern),
      linterPattern: normalizeRegex(commentsConfig.linterPattern)
    }
  };
  return sha1(stableStringifyForSignature(payload));
};

/**
 * Build stable incremental signature hash for current runtime/mode.
 *
 * @param {object} runtime
 * @param {string} mode
 * @param {string|null} tokenizationKey
 * @returns {string}
 */
export const buildIncrementalSignature = (runtime, mode, tokenizationKey) => {
  const { artifacts: _artifacts, ...bundleDependencies } = buildDependencySignatures(runtime, mode, tokenizationKey);
  return sha1(stableStringifyForSignature(bundleDependencies));
};

/** Dependency identities separate cached per-file content from output-only settings. */
export const buildDependencySignatures = (runtime, mode, tokenizationKey) => {
  const payload = buildIncrementalSignaturePayload(runtime, mode, tokenizationKey);
  const hash = value => sha1(stableStringifyForSignature(value));
  const parse = {
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    signatureVersion: SIGNATURE_VERSION, mode, cacheSchemaVersion: payload.cacheSchemaVersion, artifactSchemaHash: payload.artifactSchemaHash,
    parsers: payload.parsers, treeSitter: payload.treeSitter, yamlChunking: payload.yamlChunking,
    ...(mode === 'prose' || mode === 'extracted-prose' ? { sourceOutlineProducer: SEMANTIC_ANALYSIS_VERSIONS.sourceOutline } : {}),
    moduleExportsProducer: payload.moduleExportsProducer, nativeChunkProducer: payload.nativeChunkProducer,
    ...(mode === 'code' ? { javascriptRelationsProducer: SEMANTIC_ANALYSIS_VERSIONS.javascriptRelations, flowMetadataProducer: SEMANTIC_ANALYSIS_VERSIONS.flowMetadata, importExtractionProducer: IMPORT_EXTRACTION_VERSION, importExtractionRuntime: importExtractionRuntimeVersions(),
      sqlRelationsProducer: SEMANTIC_ANALYSIS_VERSIONS.sqlRelations, sqlRelationsParser: sqlRelationParserVersion() } : {}),
    kotlin: payload.kotlin, chunkIdAlgoVersion: payload.chunkIdAlgoVersion,
    ...(mode === 'extracted-prose' ? { docxStructuralExtractionVersion: DOCX_STRUCTURAL_EXTRACTION_VERSION,
      pdfTextExtractionVersion: PDF_TEXT_EXTRACTION_VERSION } : {}),
    ...(mode === 'records' ? { recordsProducer: SEMANTIC_ANALYSIS_VERSIONS.recordsProducer } : {}),
    fileCaps: payload.fileCaps, fileScan: payload.fileScan,
    segments: runtime.segmentsConfig || {}, comments: { classificationVersion: COMMENT_CLASSIFICATION_VERSION,
      config: runtime.commentsConfig || {} }
  };
  const lexical = { mode, tokenizationKey, literalAnalyzer: payload.literalAnalyzer, lexicon: payload.lexicon, profile: payload.profile };
  const enrichment = {
    features: payload.features, riskInterproceduralConfig: payload.riskInterproceduralConfig,
    riskRules: payload.riskRules, riskRegex: payload.riskRegex, riskPolicyReceipt: payload.riskPolicyReceipt,
    riskCaps: payload.riskCaps, importScan: payload.importScan,
    scm: payload.features.gitBlameEnabled ? payload.scm : payload.scm ? {provider: payload.scm.provider} : null
  };
  const { batchSize: _batchSize, ...embeddings } = payload.embeddings;
  const artifacts = {
    discoverySelectionProducer: payload.discoverySelectionProducer,
    pieceAssemblyProducer: SEMANTIC_ANALYSIS_VERSIONS.pieceAssembly,
    artifactSchemaHash: payload.artifactSchemaHash, artifacts: payload.artifacts,
    incrementalBundleFormat: payload.incrementalBundleFormat, profile: payload.profile
  };
  return {
    parse: hash(parse), lexical: hash(lexical), enrichment: hash(enrichment),
    embeddings: hash(embeddings), artifacts: hash(artifacts),
    ...(mode !== 'records' ? { sourceAdmission: hash({ generatedArtifactPolicy: GENERATED_ARTIFACT_POLICY_VERSION }) } : {}),
    ...(mode === 'extracted-prose' ? { documentExtraction: hash(payload.documentExtraction) } : {})
  };
};

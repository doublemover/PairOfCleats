import { writeIndexArtifacts } from '../../artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../contracts/versioning.js';
import { serializeRiskRulesBundle } from '../../../risk-rules.js';
import { finalizePerfProfile } from '../../perf-profile.js';
import { finalizeMetaV2 } from '../../../metadata-v2.js';
import { log } from '../../../../shared/progress.js';

export const writeIndexArtifactsForMode = async ({
  runtime,
  mode,
  outDir,
  state,
  postings,
  timing,
  entries,
  perfProfile,
  graphRelations,
  shardSummary
}) => {
  const metaDebug = runtime?.argv?.verbose === true || runtime?.verboseCache === true;
  const metaCheck = finalizeMetaV2({
    chunks: state.chunks,
    toolInfo: runtime.toolInfo,
    analysisPolicy: runtime.analysisPolicy,
    debug: metaDebug,
    onMismatch: ({ chunk }) => {
      const id = chunk?.chunkId || chunk?.metaV2?.chunkId || 'unknown';
      const file = chunk?.file || 'unknown';
      log(`[metaV2] finalize mismatch for ${file} (${id})`);
    }
  });
  if (metaDebug && metaCheck?.mismatches) {
    log(`[metaV2] ${metaCheck.mismatches} mismatch(es) detected during finalization.`);
  }
  const finalizedPerfProfile = finalizePerfProfile(perfProfile);
  const riskRules = serializeRiskRulesBundle(runtime.riskConfig?.rules);
  const riskInterproceduralEnabled = typeof runtime.analysisPolicy?.risk?.interprocedural === 'boolean'
    ? runtime.analysisPolicy.risk.interprocedural
    : runtime.riskInterproceduralEnabled;
  const riskInterproceduralSummaryOnly = typeof runtime.analysisPolicy?.risk?.interproceduralSummaryOnly === 'boolean'
    ? runtime.analysisPolicy.risk.interproceduralSummaryOnly
    : runtime.riskInterproceduralConfig?.summaryOnly === true;
  const riskInterproceduralEmitArtifacts = runtime.riskInterproceduralConfig?.emitArtifacts || null;
  await writeIndexArtifacts({
    outDir,
    mode,
    state,
    postings,
    postingsConfig: runtime.postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    dictSummary: runtime.dictSummary,
    timing,
    root: runtime.root,
    userConfig: runtime.userConfig,
    incrementalEnabled: runtime.incrementalEnabled,
    fileCounts: { candidates: entries.length },
    perfProfile: finalizedPerfProfile,
    graphRelations,
    indexState: {
      generatedAt: new Date().toISOString(),
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: runtime.compatibilityKey || null,
      buildId: runtime.buildId || null,
      repoId: runtime.repoId || null,
      mode,
      stage: runtime.stage || null,
      embeddings: {
        enabled: runtime.embeddingEnabled || runtime.embeddingService,
        ready: runtime.embeddingEnabled,
        pending: (runtime.embeddingEnabled || runtime.embeddingService) && !runtime.embeddingEnabled,
        mode: runtime.embeddingMode,
        service: runtime.embeddingService === true,
        embeddingIdentity: runtime.embeddingIdentity || null,
        embeddingIdentityKey: runtime.embeddingIdentityKey || null,
        lastError: null
      },
      features: {
        treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
        lint: runtime.lintEnabled,
        complexity: runtime.complexityEnabled,
        riskAnalysis: typeof runtime.analysisPolicy?.risk?.enabled === 'boolean'
          ? runtime.analysisPolicy.risk.enabled
          : runtime.riskAnalysisEnabled,
        riskAnalysisCrossFile: typeof runtime.analysisPolicy?.risk?.crossFile === 'boolean'
          ? runtime.analysisPolicy.risk.crossFile
          : runtime.riskAnalysisCrossFileEnabled,
        typeInference: typeof runtime.analysisPolicy?.typeInference?.local?.enabled === 'boolean'
          ? runtime.analysisPolicy.typeInference.local.enabled
          : runtime.typeInferenceEnabled,
        typeInferenceCrossFile: typeof runtime.analysisPolicy?.typeInference?.crossFile?.enabled === 'boolean'
          ? runtime.analysisPolicy.typeInference.crossFile.enabled
          : runtime.typeInferenceCrossFileEnabled,
        gitBlame: typeof runtime.analysisPolicy?.git?.blame === 'boolean'
          ? runtime.analysisPolicy.git.blame
          : runtime.gitBlameEnabled
      },
      shards: runtime.shards?.enabled
        ? { enabled: true, plan: shardSummary }
        : { enabled: false },
      enrichment: (runtime.twoStage?.enabled || runtime.stage)
        ? {
          enabled: true,
          pending: runtime.stage === 'stage1',
          stage: runtime.stage || null
        }
        : { enabled: false },
      riskInterprocedural: {
        enabled: riskInterproceduralEnabled === true,
        summaryOnly: riskInterproceduralSummaryOnly === true,
        emitArtifacts: riskInterproceduralEmitArtifacts
      },
      riskRules: riskRules || null
    }
  });
  return finalizedPerfProfile;
};

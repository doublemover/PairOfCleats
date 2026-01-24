import { writeIndexArtifacts } from '../../artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../contracts/versioning.js';
import { finalizePerfProfile } from '../../perf-profile.js';

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
  const finalizedPerfProfile = finalizePerfProfile(perfProfile);
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
        mode: runtime.embeddingMode,
        service: runtime.embeddingService === true
      },
      features: {
        treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
        lint: runtime.lintEnabled,
        complexity: runtime.complexityEnabled,
        riskAnalysis: runtime.riskAnalysisEnabled,
        riskAnalysisCrossFile: runtime.riskAnalysisCrossFileEnabled,
        typeInference: runtime.typeInferenceEnabled,
        typeInferenceCrossFile: runtime.typeInferenceCrossFileEnabled,
        gitBlame: runtime.gitBlameEnabled
      },
      shards: runtime.shards?.enabled
        ? { enabled: true, plan: shardSummary }
        : { enabled: false },
      enrichment: runtime.twoStage?.enabled
        ? {
          enabled: true,
          pending: runtime.stage === 'stage1',
          stage: runtime.stage || null
        }
        : { enabled: false }
    }
  });
  return finalizedPerfProfile;
};

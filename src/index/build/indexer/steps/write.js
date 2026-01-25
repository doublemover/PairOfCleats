import { writeIndexArtifacts } from '../../artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../contracts/versioning.js';
import { serializeRiskRulesBundle } from '../../../risk-rules.js';
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
  const riskRules = serializeRiskRulesBundle(runtime.riskConfig?.rules);
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
      riskRules: riskRules || null
    }
  });
  return finalizedPerfProfile;
};

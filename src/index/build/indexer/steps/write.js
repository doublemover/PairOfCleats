import { writeIndexArtifacts } from '../../artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../contracts/versioning.js';
import {
  buildIndexProfileState,
} from '../../../../contracts/index-profile.js';
import { buildIndexStateArtifactsBlock } from '../../index-state-profile.js';
import { serializeRiskRulesBundle } from '../../../risk-rules.js';
import { finalizePerfProfile } from '../../perf-profile.js';
import { finalizeMetaV2 } from '../../../metadata-v2.js';
import { log } from '../../../../shared/progress.js';
import { computeInterproceduralRisk } from '../../../risk-interprocedural/engine.js';
import { getTokenIdCollisionSummary } from '../../state.js';

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
  shardSummary,
  stageCheckpoints
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
  const modeRiskInterproceduralEnabled = mode === 'code' && riskInterproceduralEnabled === true;
  const modeRiskInterproceduralSummaryOnly = modeRiskInterproceduralEnabled
    && riskInterproceduralSummaryOnly === true;
  const riskInterproceduralEmitArtifacts = mode === 'code'
    ? (runtime.riskInterproceduralConfig?.emitArtifacts || null)
    : null;
  const tokenIdCollisions = getTokenIdCollisionSummary(state);
  const profile = buildIndexProfileState(runtime.profile?.id || runtime.indexingConfig?.profile);
  const artifacts = buildIndexStateArtifactsBlock({
    profileId: profile.id,
    mode,
    embeddingsEnabled: runtime.embeddingEnabled || runtime.embeddingService,
    postingsConfig: runtime.postingsConfig
  });
  if (mode === 'code') {
    try {
      const result = computeInterproceduralRisk({
        chunks: state.chunks,
        summaries: state.riskSummaries,
        runtime,
        mode,
        log,
        summaryTimingMs: state.riskSummaryTimingMs
      });
      state.riskFlows = result.flowRows || [];
      state.riskInterproceduralStats = result.stats || null;
      state.riskFlowCallSiteIds = result.callSiteIdsReferenced || null;
      if (state.riskSummaryStats?.summariesDroppedBySize) {
        const count = state.riskSummaryStats.summariesDroppedBySize;
        if (count > 0 && state.riskInterproceduralStats) {
          state.riskInterproceduralStats.droppedRecords = state.riskInterproceduralStats.droppedRecords || [];
          state.riskInterproceduralStats.droppedRecords.push({
            artifact: 'risk_summaries',
            count,
            reasons: [{ reason: 'rowTooLarge', count }]
          });
        }
      }
    } catch (err) {
      const fallbackMaxCallSitesPerEdge = Number.isFinite(
        Number(runtime.riskInterproceduralConfig?.caps?.maxCallSitesPerEdge)
      )
        ? Math.max(1, Math.floor(Number(runtime.riskInterproceduralConfig.caps.maxCallSitesPerEdge)))
        : null;
      state.riskFlows = [];
      state.riskFlowCallSiteIds = null;
      state.riskInterproceduralStats = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode,
        status: 'error',
        reason: err?.message || 'risk interprocedural error',
        effectiveConfig: runtime.riskInterproceduralConfig || null,
        counts: {
          chunksConsidered: state.riskSummaries?.length || 0,
          summariesEmitted: state.riskSummaries?.length || 0,
          sourceRoots: 0,
          resolvedEdges: 0,
          flowsEmitted: 0,
          risksWithFlows: 0,
          uniqueCallSitesReferenced: 0
        },
        callSiteSampling: {
          strategy: 'firstN',
          maxCallSitesPerEdge: fallbackMaxCallSitesPerEdge,
          order: 'file,startLine,startCol,endLine,endCol,calleeNormalized,calleeRaw,callSiteId'
        },
        capsHit: [],
        timingMs: {
          summaries: Number.isFinite(state.riskSummaryTimingMs) ? state.riskSummaryTimingMs : 0,
          propagation: 0,
          io: 0,
          total: Number.isFinite(state.riskSummaryTimingMs) ? state.riskSummaryTimingMs : 0
        },
        artifacts: {}
      };
    }
  }
  await writeIndexArtifacts({
    scheduler: runtime.scheduler,
    buildRoot: runtime.buildRoot,
    outDir,
    mode,
    state,
    postings,
    stageCheckpoints,
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
    riskInterproceduralEmitArtifacts,
    repoProvenance: runtime.repoProvenance,
    indexState: {
      generatedAt: new Date().toISOString(),
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      profile,
      compatibilityKey: runtime.compatibilityKey || null,
      cohortKey: runtime.cohortKeys?.[mode] || runtime.compatibilityKey || null,
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
          : runtime.gitBlameEnabled,
        vectorOnlyShortcuts: state.vectorOnlyShortcuts || null
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
        enabled: modeRiskInterproceduralEnabled === true,
        summaryOnly: modeRiskInterproceduralSummaryOnly === true,
        emitArtifacts: riskInterproceduralEmitArtifacts
      },
      riskRules: riskRules || null,
      artifacts,
      extensions: {
        tokenIdCollisions
      }
    }
  });
  return finalizedPerfProfile;
};

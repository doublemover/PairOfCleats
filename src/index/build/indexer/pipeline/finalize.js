import { writeSchedulerAutoTuneProfile } from '../../runtime/scheduler-autotune-profile.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  evaluateResourceGrowth,
  formatResourceGrowthWarning,
  readIndexArtifactBytes
} from '../../../../shared/ops-resource-visibility.js';
import { enqueueEmbeddingJob } from '../embedding-queue.js';

/**
 * Finalize one successful pipeline mode run after orchestration completes.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const finalizePipelineModeRun = async ({
  mode,
  runtime,
  runtimeRef,
  outDir,
  indexSizeBaselineBytes,
  effectiveAbortSignal,
  stagePlan,
  getSchedulerStats,
  log,
  cacheReporter,
  crashLogger
}) => {
  const indexSizeCurrentBytes = await readIndexArtifactBytes(outDir);
  const indexGrowth = evaluateResourceGrowth({
    baselineBytes: indexSizeBaselineBytes,
    currentBytes: indexSizeCurrentBytes,
    ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
    deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
  });
  if (indexGrowth.abnormal) {
    log(formatResourceGrowthWarning({
      code: RESOURCE_WARNING_CODES.INDEX_SIZE_GROWTH_ABNORMAL,
      component: 'indexing',
      metric: `${mode}.artifact_bytes`,
      growth: indexGrowth,
      nextAction: 'Review indexing inputs or profile artifact bloat before release.'
    }));
  }
  if (effectiveAbortSignal?.aborted) {
    throw effectiveAbortSignal.reason || new Error('Pipeline run aborted');
  }
  if (runtimeRef?.overallProgress?.advance) {
    const finalStage = stagePlan[stagePlan.length - 1];
    runtimeRef.overallProgress.advance({ message: `${mode} ${finalStage.label}` });
  }
  await writeSchedulerAutoTuneProfile({
    repoCacheRoot: runtimeRef.repoCacheRoot,
    schedulerStats: getSchedulerStats(),
    schedulerConfig: runtimeRef.schedulerConfig,
    buildId: runtimeRef.buildId,
    log
  });
  await enqueueEmbeddingJob({ runtime: runtimeRef, mode, indexDir: outDir, abortSignal: effectiveAbortSignal });
  crashLogger.updatePhase('done');
  cacheReporter.report();
};

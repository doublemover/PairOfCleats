/**
 * Finalize the stage1 processing result, update timing/state surfaces, enforce
 * ordering integrity, and return the stable process-files result payload.
 *
 * @param {object} input
 * @returns {object}
 */
export const finalizeStage1ProcessingResult = async ({
  mode,
  log,
  logLine = null,
  logLexiconFilterAggregate,
  timing,
  state,
  shardSummary,
  shardPlan,
  shardExecutionMeta,
  stallRecovery = null,
  checkpoint,
  processStart,
  buildStageTimingBreakdownPayload,
  buildExtractedProseLowYieldBailoutSummary,
  extractedProseLowYieldBailout,
  stage1WindowPlannerConfig,
  stage1WindowReplanIntervalMs,
  stage1WindowReplanMinSeqAdvance,
  stage1WindowReplanAttemptCount,
  stage1WindowReplanChangedCount,
  stage1LastWindowTelemetry,
  stage1SeqWindows,
  resolveStage1WindowSnapshot,
  expectedOrderIndices,
  getStage1ProgressSnapshot,
  orderedAppender,
  resolveStage1OrderingIntegrity,
  startOrderIndex,
  orderIndexToRel,
  postingsQueue,
  tokenizationStats
}) => {
  await checkpoint?.finish?.();
  timing.processMs = Date.now() - processStart;
  const stageTimingBreakdownPayload = buildStageTimingBreakdownPayload();
  const extractedProseLowYieldSummary = buildExtractedProseLowYieldBailoutSummary(extractedProseLowYieldBailout);
  const watchdogNearThresholdSummary = stageTimingBreakdownPayload?.watchdog?.nearThreshold;
  if (watchdogNearThresholdSummary?.anomaly) {
    const ratioPct = (watchdogNearThresholdSummary.nearThresholdRatio * 100).toFixed(1);
    const lowerPct = (watchdogNearThresholdSummary.lowerFraction * 100).toFixed(0);
    const upperPct = (watchdogNearThresholdSummary.upperFraction * 100).toFixed(0);
    const suggestedSlowFileMs = Number(watchdogNearThresholdSummary.suggestedSlowFileMs);
    const suggestionText = Number.isFinite(suggestedSlowFileMs) && suggestedSlowFileMs > 0
      ? `consider stage1.watchdog.slowFileMs=${Math.floor(suggestedSlowFileMs)}`
      : 'consider raising stage1.watchdog.slowFileMs';
    const message = `[watchdog] near-threshold anomaly: ${watchdogNearThresholdSummary.nearThresholdCount}`
      + `/${watchdogNearThresholdSummary.sampleCount} files (${ratioPct}%) in ${lowerPct}-${upperPct}% window; `
      + `${suggestionText}.`;
    if (typeof logLine === 'function') {
      logLine(message, {
        kind: 'warning',
        mode,
        stage: 'processing',
        watchdog: {
          nearThreshold: watchdogNearThresholdSummary
        }
      });
    } else {
      log(message);
    }
  }
  const windowSummary = {
    config: stage1WindowPlannerConfig,
    replan: {
      intervalMs: stage1WindowReplanIntervalMs,
      minSeqAdvance: stage1WindowReplanMinSeqAdvance,
      attempts: stage1WindowReplanAttemptCount,
      changed: stage1WindowReplanChangedCount,
      lastTelemetry: stage1LastWindowTelemetry
    },
    windows: stage1SeqWindows.map((window) => ({
      windowId: window.windowId,
      startSeq: window.startSeq,
      endSeq: window.endSeq,
      entryCount: window.entryCount,
      predictedCost: window.predictedCost,
      predictedBytes: window.predictedBytes
    })),
    active: resolveStage1WindowSnapshot().activeWindows
  };
  if (timing && typeof timing === 'object') {
    timing.stageTimingBreakdown = stageTimingBreakdownPayload;
    timing.extractedProseLowYieldBailout = extractedProseLowYieldSummary;
    timing.shards = shardExecutionMeta;
    timing.stage1Windows = windowSummary;
    timing.watchdog = {
      ...(timing.watchdog && typeof timing.watchdog === 'object' ? timing.watchdog : {}),
      queueDelayMs: stageTimingBreakdownPayload?.watchdog?.queueDelayMs || null,
      nearThreshold: stageTimingBreakdownPayload?.watchdog?.nearThreshold || null,
      stallRecovery
    };
  }
  if (state && typeof state === 'object') {
    state.extractedProseLowYieldBailout = extractedProseLowYieldSummary;
    state.shardExecution = shardExecutionMeta;
    state.stage1Windows = windowSummary;
  }
  const stage1ProgressSnapshot = getStage1ProgressSnapshot();
  const orderedFinalSnapshot = typeof orderedAppender.snapshot === 'function'
    ? orderedAppender.snapshot()
    : null;
  const orderingIntegrity = resolveStage1OrderingIntegrity({
    expectedOrderIndices,
    completedOrderIndices: stage1ProgressSnapshot.completedOrderIndices,
    progressCount: stage1ProgressSnapshot.count,
    progressTotal: stage1ProgressSnapshot.total,
    terminalCount: orderedFinalSnapshot?.terminalCount,
    committedCount: orderedFinalSnapshot?.committedCount,
    totalSeqCount: orderedFinalSnapshot?.totalSeqCount
  });
  if (!orderingIntegrity.ok) {
    const missingPreview = orderingIntegrity.missingIndices
      .slice(0, 12)
      .map((index) => `${index}:${orderIndexToRel.get(index) || 'unknown'}`);
    const missingSuffix = orderingIntegrity.missingCount > missingPreview.length
      ? ` (+${orderingIntegrity.missingCount - missingPreview.length} more)`
      : '';
    const err = new Error(
      `[stage1] ordering integrity violation: missing ${orderingIntegrity.missingCount}/`
        + `${orderingIntegrity.expectedCount} expected order indices `
        + `(progress=${orderingIntegrity.progressCount}/${orderingIntegrity.progressTotal}) `
        + `${missingPreview.join(', ')}${missingSuffix}`
    );
    err.code = 'STAGE1_ORDERING_INTEGRITY';
    err.meta = {
      orderingIntegrity: {
        ...orderingIntegrity,
        missingPreview
      }
    };
    throw err;
  }
  if (orderedFinalSnapshot) {
    const nextCommitSeq = Number(orderedFinalSnapshot.nextCommitSeq);
    const expectedTerminal = Number(orderedFinalSnapshot.totalSeqCount) || 0;
    const expectedNextCommitSeq = Number.isFinite(startOrderIndex)
      ? (startOrderIndex + expectedTerminal)
      : nextCommitSeq;
    if (!Number.isFinite(nextCommitSeq) || nextCommitSeq < startOrderIndex || nextCommitSeq > expectedNextCommitSeq) {
      const err = new Error(
        `[stage1] commit cursor invariant violation: nextCommitSeq=${nextCommitSeq} expected<=${expectedNextCommitSeq}`
      );
      err.code = 'STAGE1_COMMIT_CURSOR_INVARIANT';
      err.meta = {
        orderedSnapshot: orderedFinalSnapshot,
        startOrderIndex,
        expectedOrderCount: expectedOrderIndices.length
      };
      throw err;
    }
  }
  const postingsQueueStats = postingsQueue?.stats ? postingsQueue.stats() : null;
  if (postingsQueueStats) {
    if (timing) timing.postingsQueue = postingsQueueStats;
    if (state) state.postingsQueueStats = postingsQueueStats;
  }
  logLexiconFilterAggregate({ state, logFn: log });
  return {
    tokenizationStats,
    shardSummary,
    shardPlan,
    shardExecution: shardExecutionMeta,
    postingsQueueStats,
    extractedProseLowYieldBailout: extractedProseLowYieldSummary
  };
};

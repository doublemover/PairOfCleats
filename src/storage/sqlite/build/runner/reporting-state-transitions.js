import {
  setSqliteModeBuildReadyState,
  setSqliteModeFailedState,
  setSqliteModeIncrementalReadyState,
  setSqliteModeRunningState,
  setSqliteModeSkippedEmptyState,
  setSqliteModeVectorMissingState
} from './state.js';

const resolveStageRows = (counts) => ({
  code: counts.code || 0,
  prose: counts.prose || 0,
  extractedProse: counts['extracted-prose'] || 0,
  records: counts.records || 0
});

/**
 * Create a mode-scoped reporter that owns checkpoint payloads and sqlite state transitions.
 *
 * Keeping this logic centralized ensures execution code does not drift log wording,
 * stage metadata shape, or state transition order.
 *
 * @param {object} input
 * @returns {object}
 */
export const createModeReporter = ({
  mode,
  modeLabel,
  outputPath,
  root,
  userConfig,
  indexRoot,
  schemaVersion,
  threadLimits,
  stageCheckpoints,
  emitOutput,
  logger
}) => {
  const { log, error } = logger;
  const baseStatePayload = {
    root,
    userConfig,
    indexRoot,
    mode,
    path: outputPath,
    schemaVersion,
    threadLimits
  };

  return {
    logBuildStart() {
      if (!emitOutput) return;
      log(`${modeLabel} build start`, {
        fileOnlyLine: `${modeLabel} building ${mode} index -> ${outputPath}`
      });
    },
    async setRunningState() {
      await setSqliteModeRunningState(baseStatePayload);
    },
    recordStartCheckpoint(extra) {
      stageCheckpoints.record({
        stage: 'stage4',
        step: 'start',
        extra
      });
    },
    async reportSkippedEmpty({ zeroStateManifestPath, existingRows, denseCount }) {
      stageCheckpoints.record({
        stage: 'stage4',
        step: `skip-empty-${mode}`,
        extra: {
          modeArtifactsRows: 0,
          mode,
          existingRows,
          denseCount,
          zeroStateManifestPath
        }
      });
      await setSqliteModeSkippedEmptyState({
        ...baseStatePayload,
        zeroStateManifestPath
      });
      if (!emitOutput) return;
      if (mode === 'records') {
        log(`${modeLabel} skipping records sqlite rebuild (artifacts empty; zero-state).`);
        return;
      }
      log(`${modeLabel} skipping sqlite rebuild (artifacts empty; zero-state).`);
    },
    async reportIncrementalReady({ counts, outputBytes, durationMs, sqliteStats }) {
      stageCheckpoints.record({
        stage: 'stage4',
        step: 'incremental-update',
        extra: {
          outputBytes,
          batchSize: sqliteStats.batchSize ?? null,
          transactionRows: sqliteStats.transactionBoundaries?.rowsPerTransaction ?? null,
          transactionFiles: sqliteStats.transactionBoundaries?.filesPerTransaction ?? null,
          walPressure: sqliteStats.transactionBoundaries?.walPressure ?? null,
          validationMs: sqliteStats.validationMs ?? null,
          pragmas: sqliteStats.pragmas ?? null,
          rows: resolveStageRows(counts)
        }
      });
      await setSqliteModeIncrementalReadyState({
        ...baseStatePayload,
        bytes: outputBytes,
        elapsedMs: durationMs,
        stats: sqliteStats
      });
      if (!emitOutput) return;
      const summaryLine = (
        `${modeLabel} incremental update applied (${counts.code || 0} code, ` +
        `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
      );
      log(summaryLine, {
        fileOnlyLine:
          `${modeLabel} sqlite incremental update applied at ${outputPath} (${counts.code || 0} code, ` +
          `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
      });
    },
    async reportBuildReady({ counts, outputBytes, inputBytes, durationMs, note, sqliteStats }) {
      stageCheckpoints.record({
        stage: 'stage4',
        step: 'build',
        extra: {
          inputBytes,
          outputBytes,
          batchSize: sqliteStats.batchSize ?? null,
          transactionRows: sqliteStats.transactionBoundaries?.rowsPerTransaction ?? null,
          transactionFiles: sqliteStats.transactionBoundaries?.filesPerTransaction ?? null,
          walPressure: sqliteStats.transactionBoundaries?.walPressure ?? null,
          validationMs: sqliteStats.validationMs ?? null,
          pragmas: sqliteStats.pragmas ?? null,
          rows: resolveStageRows(counts)
        }
      });
      await setSqliteModeBuildReadyState({
        ...baseStatePayload,
        bytes: outputBytes,
        inputBytes,
        elapsedMs: durationMs,
        note,
        stats: sqliteStats
      });
      if (!emitOutput) return;
      const summaryLine = (
        `${modeLabel} index built (${counts.code || 0} code, ` +
        `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
      );
      log(summaryLine, {
        fileOnlyLine:
          `${modeLabel} ${mode} index built at ${outputPath} (${counts.code || 0} code, ` +
          `${counts.prose || 0} prose, ${counts['extracted-prose'] || 0} extracted-prose).`
      });
    },
    async setVectorMissingState() {
      await setSqliteModeVectorMissingState(baseStatePayload);
    },
    async reportFailure({ errorMessage, err }) {
      stageCheckpoints.record({
        stage: 'stage4',
        step: 'error',
        label: errorMessage
      });
      await setSqliteModeFailedState({
        ...baseStatePayload,
        error: errorMessage
      });
      if (!emitOutput) return;
      error(`${modeLabel} failed: ${errorMessage}`);
      if (err?.stack) {
        error(err.stack);
      }
    }
  };
};

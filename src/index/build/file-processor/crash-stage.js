/**
 * Reuse file-stage trace points for an optional in-memory progress observer.
 * Observer failures never change indexing outcomes. No event history is kept.
 * Existing crash-file updates and trace IO remain gated by crashLogger.enabled.
 *
 * @param {object} input
 * @returns {Function}
 */
export const createCrashStageUpdater = ({
  crashLogger,
  mode,
  buildStage,
  fileIndex,
  relKey,
  onStage = null,
  updateFile = true
}) => (substage, extra = {}) => {
  if (typeof onStage === 'function') {
    try { onStage(substage); } catch {}
  }
  if (!crashLogger?.enabled) return;
  const entry = {
    phase: 'processing',
    mode,
    stage: buildStage || null,
    fileIndex: Number.isFinite(fileIndex) ? fileIndex : null,
    file: relKey,
    substage,
    ...extra
  };
  if (updateFile) crashLogger.updateFile(entry);
  if (typeof crashLogger.traceFileStage === 'function') {
    crashLogger.traceFileStage(entry);
  }
};

export const createFileProcessorCrashStageUpdater = (context = {}) => createCrashStageUpdater({
  crashLogger: context.crashLogger,
  mode: context.mode,
  buildStage: context.buildStage,
  fileIndex: context.fileIndex,
  relKey: context.relKey,
  onStage: context.onStage
});

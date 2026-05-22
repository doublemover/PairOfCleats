export const createCrashStageUpdater = ({
  crashLogger,
  mode,
  buildStage,
  fileIndex,
  relKey
}) => (substage, extra = {}) => {
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
  crashLogger.updateFile(entry);
  if (typeof crashLogger.traceFileStage === 'function') {
    crashLogger.traceFileStage(entry);
  }
};

export const createFileProcessorCrashStageUpdater = (context = {}) => createCrashStageUpdater({
  crashLogger: context.crashLogger,
  mode: context.mode,
  buildStage: context.buildStage,
  fileIndex: context.fileIndex,
  relKey: context.relKey
});

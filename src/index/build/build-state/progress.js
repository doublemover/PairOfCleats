export const createBuildCheckpointTracker = ({
  buildRoot,
  mode,
  totalFiles,
  batchSize = 1000,
  intervalMs = 120000,
  updateBuildState
} = {}) => {
  if (!buildRoot || !mode || typeof updateBuildState !== 'function') {
    return { tick() {}, finish() {} };
  }

  let processed = 0;
  let lastAt = Date.now();
  let lastFlushedProcessed = null;

  const flush = ({ force = false } = {}) => {
    if (!force && lastFlushedProcessed === processed) return;
    const now = new Date().toISOString();
    void updateBuildState(buildRoot, {
      progress: {
        [mode]: {
          processedFiles: processed,
          totalFiles: Number.isFinite(totalFiles) ? totalFiles : null,
          updatedAt: now
        }
      }
    }).catch(() => {});
    lastAt = Date.now();
    lastFlushedProcessed = processed;
  };

  return {
    tick() {
      processed += 1;
      const now = Date.now();
      if (processed % batchSize === 0 || now - lastAt >= intervalMs) {
        flush();
      }
    },
    finish() {
      flush({ force: true });
    }
  };
};

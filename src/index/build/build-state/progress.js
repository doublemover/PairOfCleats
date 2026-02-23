/**
 * Create batched progress checkpoint writer for long-running stage processing.
 *
 * @param {object} input
 * @returns {{tick:()=>void,finish:()=>void}}
 */
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

  /**
   * Persist batched progress snapshot to build-state.
   *
   * Flush is best-effort and non-blocking so stage workers never stall on
   * state-file IO.
   *
   * @param {{force?:boolean}} [input]
   * @returns {void}
   */
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

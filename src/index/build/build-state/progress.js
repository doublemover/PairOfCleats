import path from 'node:path';
import { logLine } from '../../../shared/progress.js';
import { BUILD_STATE_DURABILITY_CLASS, resolveBuildStateDurabilityClass } from './durability.js';

/**
 * Create batched progress checkpoint writer for long-running stage processing.
 *
 * @param {object} input
 * @returns {{tick:()=>void,finish:()=>Promise<void>}}
 */
export const createBuildCheckpointTracker = ({
  buildRoot,
  mode,
  totalFiles,
  batchSize = 1000,
  intervalMs = 120000,
  updateBuildStateOutcome,
  durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT
} = {}) => {
  if (!buildRoot || !mode || typeof updateBuildStateOutcome !== 'function') {
    return { tick() {}, async finish() {} };
  }

  let processed = 0;
  let lastAt = Date.now();
  let lastFlushedProcessed = null;
  let flushInFlight = null;
  let flushQueued = false;
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);

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
    if (!force && lastFlushedProcessed === processed) return Promise.resolve();
    if (flushInFlight) {
      flushQueued = true;
      return flushInFlight;
    }
    flushInFlight = (async () => {
      do {
        flushQueued = false;
        const nowIso = new Date().toISOString();
        const snapshotProcessed = processed;
        const snapshotTotal = Number.isFinite(totalFiles) ? totalFiles : null;
        try {
          const outcome = await updateBuildStateOutcome(buildRoot, {
            progress: {
              [mode]: {
                processedFiles: snapshotProcessed,
                totalFiles: snapshotTotal,
                updatedAt: nowIso
              }
            }
          }, {
            durabilityClass: resolvedDurabilityClass
          });
          if (outcome?.status === 'timed_out') {
            logLine(
              `[build_state] progress write timed out for ${path.resolve(buildRoot)} (${mode}); checkpoint write remains best-effort.`,
              {
                kind: 'warning',
                buildState: {
                  event: 'progress-write-timeout',
                  buildRoot: path.resolve(buildRoot),
                  mode,
                  timeoutMs: outcome?.timeoutMs ?? null,
                  elapsedMs: outcome?.elapsedMs ?? null,
                  processedFiles: snapshotProcessed,
                  totalFiles: snapshotTotal
                }
              }
            );
          } else {
            lastFlushedProcessed = snapshotProcessed;
          }
        } catch (error) {
          logLine(
            `[build_state] progress write failed for ${path.resolve(buildRoot)} (${mode}): ${error?.message || String(error)}`,
            {
              kind: 'warning',
              buildState: {
                event: 'progress-write-failed',
                buildRoot: path.resolve(buildRoot),
                mode
              }
            }
          );
        }
        lastAt = Date.now();
      } while (flushQueued);
    })().finally(() => {
      flushInFlight = null;
    });
    return flushInFlight;
  };

  return {
    tick() {
      processed += 1;
      const now = Date.now();
      if (processed % batchSize === 0 || now - lastAt >= intervalMs) {
        void flush();
      }
    },
    async finish() {
      await flush({ force: true });
    }
  };
};

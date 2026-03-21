import path from 'node:path';
import { logLine } from '../../../shared/progress.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';
import { BUILD_STATE_DURABILITY_CLASS, resolveBuildStateDurabilityClass } from './durability.js';

const HEARTBEAT_MIN_INTERVAL_MS = 5000;
const HEARTBEAT_LAG_WARNING_MIN_MS = 45000;

export const startHeartbeat = ({
  buildRoot,
  stage,
  intervalMs = 30000,
  updateBuildStateOutcome,
  durabilityClass = BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT,
  flushBuildState,
  buildRootExists
} = {}) => {
  if (!buildRoot) return () => {};
  const lifecycle = createLifecycleRegistry({
    name: `build-state-heartbeat:${path.basename(path.resolve(buildRoot))}`
  });
  let lastWrite = 0;
  let active = true;
  let timer = null;
  let stopPromise = null;
  let lastLagWarningAtMs = 0;
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  const stop = () => {
    if (stopPromise) return stopPromise;
    if (!active) return Promise.resolve();
    active = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    stopPromise = (async () => {
      const resolvedBuildRoot = path.resolve(buildRoot);
      try {
        const lifecycleCloseResult = await runBuildCleanupWithTimeout({
          label: 'build-state.heartbeat.lifecycle.close',
          cleanup: () => lifecycle.close()
        });
        if (lifecycleCloseResult?.timedOut) {
          logLine(
            `[build_state] heartbeat lifecycle close timed out for ${resolvedBuildRoot}; continuing shutdown.`,
            {
              kind: 'warning',
              buildState: {
                event: 'heartbeat-lifecycle-close-timeout',
                buildRoot: resolvedBuildRoot,
                elapsedMs: lifecycleCloseResult?.elapsedMs ?? null
              }
            }
          );
        }
      } catch (error) {
        logLine(
          `[build_state] heartbeat lifecycle close failed for ${resolvedBuildRoot}: ${error?.message || String(error)}`,
          {
            kind: 'warning',
            buildState: {
              event: 'heartbeat-lifecycle-close-failed',
              buildRoot: resolvedBuildRoot
            }
          }
        );
      }
      try {
        const flushResult = await runBuildCleanupWithTimeout({
          label: 'build-state.heartbeat.flush',
          cleanup: () => flushBuildState(buildRoot)
        });
        if (flushResult?.timedOut) {
          logLine(
            `[build_state] heartbeat final flush timed out for ${resolvedBuildRoot}; continuing shutdown.`,
            {
              kind: 'warning',
              buildState: {
                event: 'heartbeat-flush-timeout',
                buildRoot: resolvedBuildRoot,
                elapsedMs: flushResult?.elapsedMs ?? null
              }
            }
          );
        }
      } catch (error) {
        logLine(
          `[build_state] heartbeat final flush failed for ${resolvedBuildRoot}: ${error?.message || String(error)}`,
          {
            kind: 'warning',
            buildState: {
              event: 'heartbeat-flush-failed',
              buildRoot: resolvedBuildRoot
            }
          }
        );
      }
    })();
    return stopPromise;
  };
  const tick = async () => {
    if (!active) return;
    if (!(await buildRootExists(buildRoot))) {
      void stop();
      return;
    }
    const nowMs = Date.now();
    if (nowMs - lastWrite < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastWrite = nowMs;
    const now = new Date().toISOString();
    const writeTask = updateBuildStateOutcome(buildRoot, {
      heartbeat: {
        stage: stage || null,
        lastHeartbeatAt: now
      }
    }, {
      durabilityClass: resolvedDurabilityClass,
      waitForFlush: false
    }).then((outcome) => {
      const pendingLagMs = Number.isFinite(Number(outcome?.pendingLagMs))
        ? Math.max(0, Math.floor(Number(outcome.pendingLagMs)))
        : 0;
      const lagWarningThresholdMs = Math.max(
        HEARTBEAT_LAG_WARNING_MIN_MS,
        Math.max(HEARTBEAT_MIN_INTERVAL_MS, Math.floor(Number(intervalMs) || 0)) * 2
      );
      if (outcome?.queued && pendingLagMs >= lagWarningThresholdMs) {
        const nowMs = Date.now();
        if (nowMs - lastLagWarningAtMs >= lagWarningThresholdMs) {
          lastLagWarningAtMs = nowMs;
          logLine(
            `[build_state] heartbeat durability lag ${pendingLagMs}ms for ${path.resolve(buildRoot)}; continuing with coalesced best-effort updates.`,
            {
              kind: 'warning',
              buildState: {
                event: 'heartbeat-write-lag',
                buildRoot: path.resolve(buildRoot),
                stage: stage || null,
                lagMs: pendingLagMs,
                pendingSinceMs: outcome?.pendingSinceMs ?? null,
                pendingPatchBytes: outcome?.pendingPatchBytes ?? null,
                pendingWaiterCount: outcome?.pendingWaiterCount ?? null,
                coalescedPatches: outcome?.coalescedPatches ?? null,
                lastFlushDurationMs: outcome?.lastFlushDurationMs ?? null
              }
            }
          );
        }
      }
      if (outcome?.status !== 'timed_out') return;
      logLine(
        `[build_state] heartbeat write timed out for ${path.resolve(buildRoot)}; heartbeat remains best-effort.`,
        {
          kind: 'warning',
          buildState: {
            event: 'heartbeat-write-timeout',
            buildRoot: path.resolve(buildRoot),
            stage: stage || null,
            timeoutMs: outcome?.timeoutMs ?? null,
            elapsedMs: outcome?.elapsedMs ?? null
          }
        }
      );
    }).catch((error) => {
      logLine(
        `[build_state] heartbeat write failed for ${path.resolve(buildRoot)}: ${error?.message || String(error)}`,
        {
          kind: 'warning',
          buildState: {
            event: 'heartbeat-write-failed',
            buildRoot: path.resolve(buildRoot),
            stage: stage || null
          }
        }
      );
    });
    lifecycle.registerPromise(writeTask, { label: 'build-state-heartbeat-write' });
  };
  const queueTick = () => {
    if (!active || lifecycle.isClosed()) return;
    lifecycle.registerPromise(tick(), { label: 'build-state-heartbeat-tick' });
  };
  queueTick();
  timer = setInterval(() => {
    queueTick();
  }, intervalMs);
  timer.unref?.();
  lifecycle.registerTimer(timer, { label: 'build-state-heartbeat-interval' });
  return stop;
};

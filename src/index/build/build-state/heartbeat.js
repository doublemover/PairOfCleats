import path from 'node:path';
import { logLine } from '../../../shared/progress.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';
import { BUILD_STATE_DURABILITY_CLASS, resolveBuildStateDurabilityClass } from './durability.js';

const HEARTBEAT_MIN_INTERVAL_MS = 5000;

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
  const resolvedDurabilityClass = resolveBuildStateDurabilityClass(durabilityClass);
  const stop = () => {
    if (!active) return;
    active = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    void runBuildCleanupWithTimeout({
      label: 'build-state.heartbeat.lifecycle.close',
      cleanup: () => lifecycle.close()
    }).catch(() => {});
    void runBuildCleanupWithTimeout({
      label: 'build-state.heartbeat.flush',
      cleanup: () => flushBuildState(buildRoot)
    }).catch(() => {});
  };
  const tick = async () => {
    if (!active) return;
    if (!(await buildRootExists(buildRoot))) {
      stop();
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
      durabilityClass: resolvedDurabilityClass
    }).then((outcome) => {
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
  lifecycle.registerTimer(timer, { label: 'build-state-heartbeat-interval' });
  return stop;
};

import path from 'node:path';
import { logLine } from '../../../shared/progress.js';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';
import { runBuildCleanupWithTimeout } from '../cleanup-timeout.js';

const HEARTBEAT_MIN_INTERVAL_MS = 5000;

export const startHeartbeat = ({
  buildRoot,
  stage,
  intervalMs = 30000,
  updateBuildStateOutcome,
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
    void flushBuildState(buildRoot);
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
    }).catch(() => {});
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

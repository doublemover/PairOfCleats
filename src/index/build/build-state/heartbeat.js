import path from 'node:path';
import { createLifecycleRegistry } from '../../../shared/lifecycle/registry.js';

const HEARTBEAT_MIN_INTERVAL_MS = 5000;

export const startHeartbeat = ({
  buildRoot,
  stage,
  intervalMs = 30000,
  updateBuildState,
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
    void lifecycle.close().catch(() => {});
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
    const writeTask = updateBuildState(buildRoot, {
      heartbeat: {
        stage: stage || null,
        lastHeartbeatAt: now
      }
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

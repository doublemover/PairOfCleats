export const updatePerfStats = ({ perfStats, now, frameMs, budgetMs, fpsState, heapUsed, intervalValid = true }) => {
  const stats = perfStats || {};
  const valid=intervalValid&&Number.isFinite(frameMs)&&frameMs>=0;
  stats.callbackIntervalMs = valid ? Math.round(frameMs * 100) / 100 : null;
  stats.frameMs = stats.callbackIntervalMs; // Historical field: callback interval, never GPU/frame time.
  stats.gpuMs = null;
  stats.overBudget = valid && frameMs > budgetMs;
  if (valid && frameMs > budgetMs * 1.5) {
    stats.slowCallbacks = (stats.slowCallbacks || 0) + 1;
  }
  if (Number.isFinite(heapUsed)) stats.heapUsed = heapUsed;

  const nextState = fpsState || { start: now, frames: 0 };
  if(!valid){nextState.start=now;nextState.frames=0;stats.fps=null;return {stats,fpsState:nextState};}
  nextState.frames += 1;
  const elapsed = now - nextState.start;
  if (elapsed >= 1000) {
    stats.fps = Math.round((nextState.frames / elapsed) * 1000);
    nextState.start = now;
    nextState.frames = 0;
  }

  return { stats, fpsState: nextState };
};

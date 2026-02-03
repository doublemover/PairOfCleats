export const updatePerfStats = ({ perfStats, now, frameMs, budgetMs, fpsState, heapUsed }) => {
  const stats = perfStats || {};
  stats.frameMs = Math.round(frameMs * 100) / 100;
  stats.overBudget = frameMs > budgetMs;
  if (frameMs > budgetMs * 1.5) {
    stats.droppedFrames = (stats.droppedFrames || 0) + 1;
  }
  if (Number.isFinite(heapUsed)) stats.heapUsed = heapUsed;

  const nextState = fpsState || { start: now, frames: 0 };
  nextState.frames += 1;
  const elapsed = now - nextState.start;
  if (elapsed >= 1000) {
    stats.fps = Math.round((nextState.frames / elapsed) * 1000);
    nextState.start = now;
    nextState.frames = 0;
  }

  return { stats, fpsState: nextState };
};

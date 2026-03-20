import {
  buildActiveWriteTelemetrySnapshot,
  createWriteHeartbeatController,
  resolveActiveWritePhaseLabel
} from '../artifacts/write-telemetry.js';

export const createArtifactWriteTelemetryContext = ({
  telemetry = null,
  activeWrites,
  activeWriteBytes,
  activeWriteMeta,
  formatBytes,
  writeProgressHeartbeatMs,
  normalizedWriteStallThresholds,
  stageCheckpoints,
  logLine,
  showProgress,
  writeProgressMeta,
  getCompletedWrites,
  getTotalWrites,
  getLastWriteLabel,
  setLastWriteLabel,
  getLastWriteLog,
  setLastWriteLog,
  writeLogIntervalMs
} = {}) => {
  const updateWriteInFlightTelemetry = () => {
    if (!telemetry || typeof telemetry.setInFlightBytes !== 'function') return;
    let bytes = 0;
    for (const value of activeWriteBytes.values()) {
      if (Number.isFinite(value) && value > 0) bytes += value;
    }
    telemetry.setInFlightBytes('artifacts.write', {
      bytes,
      count: activeWrites.size
    });
  };

  const getLongestWriteStallSeconds = () => {
    if (!activeWrites.size) return 0;
    const now = Date.now();
    let longest = 0;
    for (const startedAt of activeWrites.values()) {
      const elapsed = Math.max(0, now - (Number(startedAt) || now));
      if (elapsed > longest) longest = elapsed;
    }
    return Math.max(0, Math.round(longest / 1000));
  };

  const updateActiveWriteMeta = (label, patch = {}) => {
    if (!label) return;
    const existing = activeWriteMeta.get(label) || {};
    activeWriteMeta.set(label, {
      ...existing,
      ...patch
    });
  };

  const getActiveWriteTelemetrySnapshot = () => buildActiveWriteTelemetrySnapshot({
    activeWrites,
    activeWriteBytes,
    activeWriteMeta,
    limit: 3,
    formatBytes
  });

  const writeHeartbeat = createWriteHeartbeatController({
    writeProgressHeartbeatMs,
    activeWrites,
    activeWriteBytes,
    activeWriteMeta,
    getCompletedWrites,
    getTotalWrites,
    normalizedWriteStallThresholds,
    stageCheckpoints,
    logLine,
    formatBytes
  });

  const runTrackedArtifactCloseout = async (name, fn) => {
    const closeoutName = String(name || 'task').trim() || 'task';
    const closeoutLabel = `closeout/${closeoutName}`;
    activeWrites.set(closeoutLabel, Date.now());
    activeWriteBytes.set(closeoutLabel, 0);
    updateActiveWriteMeta(closeoutLabel, {
      phase: resolveActiveWritePhaseLabel(closeoutLabel),
      lane: 'closeout'
    });
    updateWriteInFlightTelemetry();
    try {
      return await fn();
    } finally {
      activeWrites.delete(closeoutLabel);
      activeWriteBytes.delete(closeoutLabel);
      activeWriteMeta.delete(closeoutLabel);
      updateWriteInFlightTelemetry();
      writeHeartbeat.clearLabelAlerts(closeoutLabel);
    }
  };

  const logWriteProgress = (label) => {
    const completedWrites = (Number(getCompletedWrites()) || 0) + 1;
    if (label) setLastWriteLabel(label);
    showProgress('Artifacts', completedWrites, getTotalWrites(), {
      ...writeProgressMeta,
      message: label || null
    });
    const now = Date.now();
    const totalWrites = Number(getTotalWrites()) || 0;
    if (completedWrites === totalWrites || completedWrites === 1 || (now - getLastWriteLog()) >= writeLogIntervalMs) {
      setLastWriteLog(now);
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = getLastWriteLabel() ? ` | ${getLastWriteLabel()}` : '';
      logLine(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`, { kind: 'status' });
    }
    return completedWrites;
  };

  return {
    getActiveWriteTelemetrySnapshot,
    getLongestWriteStallSeconds,
    logWriteProgress,
    runTrackedArtifactCloseout,
    updateActiveWriteMeta,
    updateWriteInFlightTelemetry,
    writeHeartbeat
  };
};

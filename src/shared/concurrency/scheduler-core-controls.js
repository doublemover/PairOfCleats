/**
 * Apply runtime token pool limit overrides.
 *
 * @param {object} input
 * @param {object} [input.limits]
 * @param {number} input.cpuTokens
 * @param {number} input.ioTokens
 * @param {number} input.memoryTokens
 * @param {{cpu:{total:number},io:{total:number},mem:{total:number}}} input.tokens
 * @returns {{cpuTokens:number,ioTokens:number,memoryTokens:number}}
 */
export const applySchedulerTokenLimits = ({
  limits = {},
  cpuTokens,
  ioTokens,
  memoryTokens,
  tokens
}) => {
  let nextCpuTokens = cpuTokens;
  let nextIoTokens = ioTokens;
  let nextMemoryTokens = memoryTokens;

  if (Number.isFinite(Number(limits.cpuTokens))) {
    nextCpuTokens = Math.max(1, Math.floor(Number(limits.cpuTokens)));
  }
  if (Number.isFinite(Number(limits.ioTokens))) {
    nextIoTokens = Math.max(1, Math.floor(Number(limits.ioTokens)));
  }
  if (Number.isFinite(Number(limits.memoryTokens))) {
    nextMemoryTokens = Math.max(1, Math.floor(Number(limits.memoryTokens)));
  }

  tokens.cpu.total = nextCpuTokens;
  tokens.io.total = nextIoTokens;
  tokens.mem.total = nextMemoryTokens;

  return {
    cpuTokens: nextCpuTokens,
    ioTokens: nextIoTokens,
    memoryTokens: nextMemoryTokens
  };
};

/**
 * Apply telemetry option overrides with existing-value fallback.
 *
 * @param {object} input
 * @param {object} [input.options]
 * @param {string} input.telemetryStage
 * @param {(stage:string,fallback:string)=>string} input.normalizeTelemetryStage
 * @param {boolean} input.queueDepthSnapshotsEnabled
 * @param {number} input.traceIntervalMs
 * @param {number} input.queueDepthSnapshotIntervalMs
 * @returns {{telemetryStage:string,queueDepthSnapshotsEnabled:boolean,traceIntervalMs:number,queueDepthSnapshotIntervalMs:number}}
 */
export const applySchedulerTelemetryOptions = ({
  options = {},
  telemetryStage,
  normalizeTelemetryStage,
  queueDepthSnapshotsEnabled,
  traceIntervalMs,
  queueDepthSnapshotIntervalMs
}) => {
  let nextTelemetryStage = telemetryStage;
  let nextQueueDepthSnapshotsEnabled = queueDepthSnapshotsEnabled;
  let nextTraceIntervalMs = traceIntervalMs;
  let nextQueueDepthSnapshotIntervalMs = queueDepthSnapshotIntervalMs;

  if (typeof options?.stage === 'string') {
    nextTelemetryStage = normalizeTelemetryStage(options.stage, telemetryStage);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'queueDepthSnapshotsEnabled')) {
    nextQueueDepthSnapshotsEnabled = options.queueDepthSnapshotsEnabled === true;
  }
  if (Number.isFinite(Number(options?.traceIntervalMs))) {
    nextTraceIntervalMs = Math.max(100, Math.floor(Number(options.traceIntervalMs)));
  }
  if (Number.isFinite(Number(options?.queueDepthSnapshotIntervalMs))) {
    nextQueueDepthSnapshotIntervalMs = Math.max(1000, Math.floor(Number(options.queueDepthSnapshotIntervalMs)));
  }

  return {
    telemetryStage: nextTelemetryStage,
    queueDepthSnapshotsEnabled: nextQueueDepthSnapshotsEnabled,
    traceIntervalMs: nextTraceIntervalMs,
    queueDepthSnapshotIntervalMs: nextQueueDepthSnapshotIntervalMs
  };
};

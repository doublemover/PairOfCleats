import { buildSchedulerStatsSnapshot } from '../scheduler-core-stats.js';
import { createSchedulerTelemetryCapture } from '../scheduler-core-telemetry-capture.js';
import { createAdaptiveSchedulerController } from './adaptive-controller.js';
import { createSchedulerCoreConfig } from './config.js';
import { createSchedulerDispatch } from './dispatch.js';
import { createSchedulerQueueLifecycle } from './queue-lifecycle.js';
import { createSchedulerShutdown } from './shutdown.js';

/**
 * Create a build scheduler that coordinates CPU/IO/memory tokens across queues.
 * This is intentionally generic and can be wired into Stage1/2/4 and embeddings.
 * @param {{enabled?:boolean,lowResourceMode?:boolean,cpuTokens?:number,ioTokens?:number,memoryTokens?:number,starvationMs?:number,maxInFlightBytes?:number,queues?:Record<string,{priority?:number,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number}>,traceMaxSamples?:number,queueDepthSnapshotMaxSamples?:number,traceIntervalMs?:number,queueDepthSnapshotIntervalMs?:number,queueDepthSnapshotsEnabled?:boolean,writeBackpressure?:{enabled?:boolean,writeQueue?:string,producerQueues?:string[],pendingThreshold?:number,pendingBytesThreshold?:number,oldestWaitMsThreshold?:number},requireSignals?:boolean,requiredSignalQueues?:string[]}} input
 * @returns {{schedule:(queueName:string,tokens?:{cpu?:number,io?:number,mem?:number,bytes?:number,signal?:AbortSignal|null}|AbortSignal|null,fn?:()=>Promise<any>)=>Promise<any>,stats:()=>any,shutdown:(input?:{awaitRunning?:boolean,timeoutMs?:number})=>Promise<void|Array<PromiseSettledResult<any>>>|void,setLimits:(limits:{cpuTokens?:number,ioTokens?:number,memoryTokens?:number})=>void,setTelemetryOptions:(options:{stage?:string,queueDepthSnapshotsEnabled?:boolean,queueDepthSnapshotIntervalMs?:number,traceIntervalMs?:number})=>void}}
 */
export function createBuildScheduler(input = {}) {
  const config = createSchedulerCoreConfig(input);
  const state = {
    tokens: config.createTokenState(),
    shuttingDown: false,
    runningTasks: new Set(),
    globalInFlightBytes: 0,
    telemetryStage: config.telemetryStage,
    traceIntervalMs: config.traceIntervalMs,
    queueDepthSnapshotIntervalMs: config.queueDepthSnapshotIntervalMs,
    queueDepthSnapshotsEnabled: config.queueDepthSnapshotsEnabled,
    lastMemorySignals: null,
    lastSystemSignals: null,
    lastAdaptiveAt: 0,
    adaptiveCurrentIntervalMs: config.adaptiveMinIntervalMs,
    adaptiveMode: 'steady',
    smoothedUtilization: null,
    smoothedPendingPressure: null,
    smoothedStarvation: null,
    burstModeUntilMs: 0,
    adaptiveDecisionId: 0
  };

  const queueLifecycle = createSchedulerQueueLifecycle({ config });
  const cloneTokenState = () => ({
    cpu: { ...state.tokens.cpu },
    io: { ...state.tokens.io },
    mem: { ...state.tokens.mem }
  });
  const telemetryCapture = createSchedulerTelemetryCapture({
    nowMs: config.nowMs,
    startedAtMs: config.startedAtMs,
    queueOrder: config.queueOrder,
    normalizeByteCount: config.normalizeByteCount,
    evaluateWriteBackpressure: queueLifecycle.evaluateWriteBackpressure,
    writeBackpressureState: config.writeBackpressureState,
    cloneTokenState,
    traceMaxSamples: config.traceMaxSamples,
    queueDepthSnapshotMaxSamples: config.queueDepthSnapshotMaxSamples,
    getStage: () => state.telemetryStage,
    getTraceIntervalMs: () => state.traceIntervalMs,
    getQueueDepthSnapshotIntervalMs: () => state.queueDepthSnapshotIntervalMs,
    isQueueDepthSnapshotsEnabled: () => state.queueDepthSnapshotsEnabled
  });
  const {
    captureSchedulingTrace,
    captureQueueDepthSnapshot,
    captureTelemetryIfDue
  } = telemetryCapture;
  const adaptiveController = createAdaptiveSchedulerController({
    config,
    state,
    queueLifecycle
  });
  const telemetryTimer = config.enabled && !config.lowResourceMode
    ? setInterval(() => {
      if (state.shuttingDown) return;
      captureTelemetryIfDue('interval');
    }, config.telemetryTickMs)
    : null;
  telemetryTimer?.unref?.();
  const dispatch = createSchedulerDispatch({
    config,
    state,
    queueLifecycle,
    adaptiveController,
    captureTelemetryIfDue
  });
  const shutdownController = createSchedulerShutdown({
    config,
    state,
    queueLifecycle,
    telemetryTimer,
    captureSchedulingTrace,
    captureQueueDepthSnapshot,
    pump: dispatch.pump
  });

  const stats = () => {
    return buildSchedulerStatsSnapshot({
      captureTelemetryIfDue,
      queueOrder: config.queueOrder,
      nowMs: config.nowMs,
      normalizeByteCount: config.normalizeByteCount,
      counters: config.counters,
      tokens: state.tokens,
      adaptiveSurfaceStates: config.adaptiveSurfaceStates,
      buildAdaptiveSurfaceSnapshotByName: adaptiveController.buildAdaptiveSurfaceSnapshotByName,
      adaptiveEnabled: config.adaptiveEnabled,
      baselineLimits: config.baselineLimits,
      maxLimits: config.maxLimits,
      adaptiveTargetUtilization: config.adaptiveTargetUtilization,
      adaptiveStep: config.adaptiveStep,
      adaptiveMemoryReserveMb: config.adaptiveMemoryReserveMb,
      adaptiveMemoryPerTokenMb: config.adaptiveMemoryPerTokenMb,
      globalMaxInFlightBytes: config.globalMaxInFlightBytes,
      adaptiveCurrentIntervalMs: state.adaptiveCurrentIntervalMs,
      adaptiveMode: state.adaptiveMode,
      smoothedUtilization: state.smoothedUtilization,
      smoothedPendingPressure: state.smoothedPendingPressure,
      smoothedStarvation: state.smoothedStarvation,
      adaptiveSurfaceControllersEnabled: config.adaptiveSurfaceControllersEnabled,
      adaptiveDecisionTrace: config.adaptiveDecisionTrace,
      lastSystemSignals: state.lastSystemSignals,
      evaluateWriteBackpressure: queueLifecycle.evaluateWriteBackpressure,
      writeBackpressure: config.writeBackpressure,
      telemetryStage: state.telemetryStage,
      traceIntervalMs: state.traceIntervalMs,
      queueDepthSnapshotIntervalMs: state.queueDepthSnapshotIntervalMs,
      queueDepthSnapshotsEnabled: state.queueDepthSnapshotsEnabled,
      telemetryCapture
    });
  };

  captureSchedulingTrace({ reason: 'init', force: true });

  return {
    schedule: dispatch.schedule,
    stats,
    shutdown: shutdownController.shutdown,
    setLimits: shutdownController.setLimits,
    registerQueue: queueLifecycle.registerQueue,
    registerQueues: queueLifecycle.registerQueues,
    clearQueue: queueLifecycle.clearQueue,
    setTelemetryOptions: shutdownController.setTelemetryOptions,
    enabled: config.enabled,
    lowResourceMode: config.lowResourceMode
  };
}

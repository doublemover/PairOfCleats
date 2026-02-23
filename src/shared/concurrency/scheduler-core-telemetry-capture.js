import { appendBounded } from './scheduler-telemetry.js';

/**
 * Create trace/snapshot capture helpers bound to live scheduler state.
 *
 * The capture methods intentionally gate expensive queue scans behind interval
 * checks so enqueue/pump paths only pay a lightweight branch on most calls.
 *
 * @param {{
 *   nowMs:()=>number,
 *   startedAtMs:number,
 *   queueOrder:Array<{name:string,pending:Array<any>,pendingBytes:number,running:number,inFlightBytes:number}>,
 *   normalizeByteCount:(value:any)=>number,
 *   evaluateWriteBackpressure:()=>{active?:boolean,reasons?:Array<string>,pending?:number,pendingBytes?:number,oldestWaitMs?:number},
 *   writeBackpressureState:{reasons?:Array<string>},
 *   cloneTokenState:()=>{cpu:Record<string,any>,io:Record<string,any>,mem:Record<string,any>},
 *   traceMaxSamples:number,
 *   queueDepthSnapshotMaxSamples:number,
 *   getStage:()=>string,
 *   getTraceIntervalMs:()=>number,
 *   getQueueDepthSnapshotIntervalMs:()=>number,
 *   isQueueDepthSnapshotsEnabled:()=>boolean
 * }} deps
 * @returns {{
 *   captureSchedulingTrace:(input?:{now?:number,reason?:string,force?:boolean})=>any,
 *   captureQueueDepthSnapshot:(input?:{now?:number,reason?:string,force?:boolean})=>any,
 *   captureTelemetryIfDue:(reason?:string)=>void,
 *   getSchedulingTrace:()=>Array<any>,
 *   getQueueDepthSnapshots:()=>Array<any>
 * }}
 */
export function createSchedulerTelemetryCapture(deps = {}) {
  const nowMs = typeof deps.nowMs === 'function'
    ? deps.nowMs
    : () => Date.now();
  const startedAtMs = Number.isFinite(Number(deps.startedAtMs))
    ? Number(deps.startedAtMs)
    : nowMs();
  const queueOrder = Array.isArray(deps.queueOrder) ? deps.queueOrder : [];
  const normalizeByteCount = typeof deps.normalizeByteCount === 'function'
    ? deps.normalizeByteCount
    : (value) => {
      const parsed = Math.floor(Number(value));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
  const evaluateWriteBackpressure = typeof deps.evaluateWriteBackpressure === 'function'
    ? deps.evaluateWriteBackpressure
    : () => ({ active: false, reasons: [], pending: 0, pendingBytes: 0, oldestWaitMs: 0 });
  const writeBackpressureState = deps.writeBackpressureState && typeof deps.writeBackpressureState === 'object'
    ? deps.writeBackpressureState
    : { reasons: [] };
  const cloneTokenState = typeof deps.cloneTokenState === 'function'
    ? deps.cloneTokenState
    : () => ({ cpu: {}, io: {}, mem: {} });
  const getStage = typeof deps.getStage === 'function'
    ? deps.getStage
    : () => 'init';
  const getTraceIntervalMs = typeof deps.getTraceIntervalMs === 'function'
    ? deps.getTraceIntervalMs
    : () => 1000;
  const getQueueDepthSnapshotIntervalMs = typeof deps.getQueueDepthSnapshotIntervalMs === 'function'
    ? deps.getQueueDepthSnapshotIntervalMs
    : () => 5000;
  const isQueueDepthSnapshotsEnabled = typeof deps.isQueueDepthSnapshotsEnabled === 'function'
    ? deps.isQueueDepthSnapshotsEnabled
    : () => false;
  const traceMaxSamples = Number.isFinite(Number(deps.traceMaxSamples))
    ? Math.max(16, Math.floor(Number(deps.traceMaxSamples)))
    : 512;
  const queueDepthSnapshotMaxSamples = Number.isFinite(Number(deps.queueDepthSnapshotMaxSamples))
    ? Math.max(16, Math.floor(Number(deps.queueDepthSnapshotMaxSamples)))
    : 512;

  const schedulingTrace = [];
  const queueDepthSnapshots = [];
  let lastTraceAtMs = 0;
  let lastQueueDepthSnapshotAtMs = 0;

  /**
   * Aggregate queue depth in one pass over current queue order.
   * This is called only when a sample is emitted to avoid extra hot-path work.
   */
  const buildQueueDepthState = () => {
    const byQueue = {};
    let pending = 0;
    let pendingBytes = 0;
    let running = 0;
    let inFlightBytes = 0;
    for (const queue of queueOrder) {
      const queuePending = queue.pending.length;
      const queuePendingBytes = normalizeByteCount(queue.pendingBytes);
      const queueRunning = queue.running;
      const queueInFlightBytes = normalizeByteCount(queue.inFlightBytes);
      pending += queuePending;
      pendingBytes += queuePendingBytes;
      running += queueRunning;
      inFlightBytes += queueInFlightBytes;
      byQueue[queue.name] = {
        pending: queuePending,
        pendingBytes: queuePendingBytes,
        running: queueRunning,
        inFlightBytes: queueInFlightBytes
      };
    }
    return { byQueue, pending, pendingBytes, running, inFlightBytes };
  };

  const captureSchedulingTrace = ({
    now = nowMs(),
    reason = 'interval',
    force = false
  } = {}) => {
    if (!force && (now - lastTraceAtMs) < getTraceIntervalMs()) return null;
    const queueDepth = buildQueueDepthState();
    const sample = {
      at: new Date(now).toISOString(),
      elapsedMs: Math.max(0, now - startedAtMs),
      stage: getStage(),
      reason,
      tokens: cloneTokenState(),
      activity: {
        pending: queueDepth.pending,
        pendingBytes: queueDepth.pendingBytes,
        running: queueDepth.running,
        inFlightBytes: queueDepth.inFlightBytes
      },
      backpressure: {
        ...evaluateWriteBackpressure(),
        reasons: Array.from(writeBackpressureState.reasons || [])
      },
      queues: queueDepth.byQueue
    };
    lastTraceAtMs = now;
    appendBounded(schedulingTrace, sample, traceMaxSamples);
    return sample;
  };

  const captureQueueDepthSnapshot = ({
    now = nowMs(),
    reason = 'interval',
    force = false
  } = {}) => {
    if (!isQueueDepthSnapshotsEnabled()) return null;
    if (!force && (now - lastQueueDepthSnapshotAtMs) < getQueueDepthSnapshotIntervalMs()) return null;
    const queueDepth = buildQueueDepthState();
    const snapshot = {
      at: new Date(now).toISOString(),
      elapsedMs: Math.max(0, now - startedAtMs),
      stage: getStage(),
      reason,
      pending: queueDepth.pending,
      pendingBytes: queueDepth.pendingBytes,
      running: queueDepth.running,
      inFlightBytes: queueDepth.inFlightBytes,
      queues: queueDepth.byQueue
    };
    lastQueueDepthSnapshotAtMs = now;
    appendBounded(queueDepthSnapshots, snapshot, queueDepthSnapshotMaxSamples);
    return snapshot;
  };

  /**
   * Capture both telemetry streams using a single clock read to keep samples
   * time-aligned and avoid redundant `Date.now()` calls on fast polling loops.
   * @param {string} reason
   */
  const captureTelemetryIfDue = (reason = 'interval') => {
    const now = nowMs();
    captureSchedulingTrace({ now, reason });
    captureQueueDepthSnapshot({ now, reason });
  };

  return {
    captureSchedulingTrace,
    captureQueueDepthSnapshot,
    captureTelemetryIfDue,
    getSchedulingTrace: () => schedulingTrace,
    getQueueDepthSnapshots: () => queueDepthSnapshots
  };
}

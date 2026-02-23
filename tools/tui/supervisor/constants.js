import { PROGRESS_PROTOCOL } from '../../../src/shared/cli/progress-events.js';

/** Protocol identifier for stdin request frames accepted by the supervisor. */
export const SUPERVISOR_PROTOCOL = 'poc.tui@1';

/** Default downstream flow credits granted before explicit `flow:credit` acks. */
export const FLOW_DEFAULT_CREDITS = 512;
/** Upper bound for accepted flow credits from untrusted client input. */
export const FLOW_MAX_CREDITS = 10_000;
/** Maximum number of queued events waiting for downstream flow credits. */
export const FLOW_QUEUE_MAX = 2048;
/** Maximum serialized event size before chunk protocol is used. */
export const FLOW_MAX_EVENT_CHARS = 16 * 1024;
/** Chunk payload size for split `event:chunk` protocol frames. */
export const FLOW_CHUNK_CHARS = 4096;
/** Runtime metrics heartbeat interval. */
export const FLOW_METRICS_INTERVAL_MS = 1000;

/**
 * Events that bypass flow-credit gating so lifecycle state remains observable
 * even when downstream has not replenished credits.
 */
export const CRITICAL_EVENTS = new Set([
  'hello',
  'job:start',
  'job:spawn',
  'job:end',
  'job:artifacts',
  'runtime:metrics'
]);

/**
 * Stable capability contract emitted during the startup `hello` frame.
 *
 * `protocolVersion` intentionally mirrors the shared progress protocol version.
 */
export const SUPERVISOR_CAPABILITIES = Object.freeze({
  protocolVersion: PROGRESS_PROTOCOL,
  supportsCancel: true,
  supportsResultCapture: true,
  supportsFlowControl: true,
  supportsChunking: true
});

/** Watchdog timeout upper bound (1 hour). */
export const WATCHDOG_MAX_MS = 60 * 60 * 1000;
/** Default cooldown between watchdog soft-kick attempts. */
export const WATCHDOG_SOFT_KICK_COOLDOWN_DEFAULT_MS = 10_000;
/** Default number of watchdog soft-kick attempts before hard timeout only. */
export const WATCHDOG_SOFT_KICK_MAX_ATTEMPTS_DEFAULT = 2;

/**
 * Transport-level progress fields to drop when relaying child process progress
 * events through the supervisor stream.
 */
export const PROGRESS_EVENT_DROP_FIELDS = new Set(['proto', 'event', 'ts', 'seq', 'runId', 'jobId']);

export { PROGRESS_PROTOCOL };

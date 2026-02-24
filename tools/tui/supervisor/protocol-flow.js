import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { formatProgressEvent } from '../../../src/shared/cli/progress-events.js';
import { clampInt } from '../../../src/shared/limits.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import {
  CRITICAL_EVENTS,
  FLOW_CHUNK_CHARS,
  FLOW_DEFAULT_CREDITS,
  FLOW_MAX_CREDITS,
  FLOW_MAX_EVENT_CHARS,
  FLOW_QUEUE_MAX,
  PROGRESS_PROTOCOL,
  SUPERVISOR_CAPABILITIES,
  SUPERVISOR_PROTOCOL
} from './constants.js';

const SAFE_RUN_ID_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RUN_ID_MAX_FILENAME_LENGTH = 96;

/**
 * Resolve a deterministic filename-safe token for event-log file names.
 *
 * Logical run IDs are preserved in protocol payloads/metadata, but file names
 * must be path-safe and collision-resistant across arbitrary run ID input.
 *
 * @param {string} runId
 * @returns {string}
 */
const resolveRunIdFilenameToken = (runId) => {
  const value = String(runId || '').trim();
  if (SAFE_RUN_ID_FILENAME_PATTERN.test(value)) return value;
  const normalized = value
    .replace(/[\\/]+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, RUN_ID_MAX_FILENAME_LENGTH);
  const base = normalized || 'run';
  const digest = crypto
    .createHash('sha1')
    .update(value || 'run')
    .digest('hex')
    .slice(0, 10);
  return `${base}-${digest}`;
};

/**
 * Initialize optional JSONL event logging for one supervisor run.
 *
 * Recorder setup is intentionally fail-open: if initialization fails, runtime
 * progress streaming still continues and only durable event logging is disabled.
 *
 * @param {{requestedDir:string,runId:string,supervisorVersion:string,root:string}} input
 * @returns {{eventLogPath:string,write:(entry:object)=>void,finalize:(reason?:string)=>void}|null}
 */
export const createEventLogRecorder = ({ requestedDir, runId, supervisorVersion, root }) => {
  if (!requestedDir) return null;
  const logsDir = path.resolve(requestedDir);
  const runIdFileToken = resolveRunIdFilenameToken(runId);
  const eventLogPath = path.join(logsDir, `${runIdFileToken}.jsonl`);
  const sessionMetaPath = path.join(logsDir, `${runIdFileToken}.meta.json`);
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const meta = {
      schemaVersion: 1,
      runId,
      protocol: PROGRESS_PROTOCOL,
      supervisorProtocol: SUPERVISOR_PROTOCOL,
      supervisorVersion,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      eventLogPath: path.relative(root, eventLogPath).replace(/\\/g, '/')
    };
    fs.writeFileSync(sessionMetaPath, `${stableStringify(meta)}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`[supervisor] failed to initialize event log recorder: ${error?.message || error}\n`);
    return null;
  }
  let closed = false;
  return {
    eventLogPath,
    write(entry) {
      if (closed) return;
      try {
        fs.appendFileSync(eventLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch (error) {
        closed = true;
        process.stderr.write(`[supervisor] disabled event log recorder: ${error?.message || error}\n`);
      }
    },
    finalize(reason = 'shutdown') {
      if (closed) return;
      closed = true;
      try {
        const metaBody = fs.readFileSync(sessionMetaPath, 'utf8');
        const existing = JSON.parse(metaBody);
        const next = {
          ...existing,
          endedAt: new Date().toISOString(),
          endReason: String(reason || 'shutdown').trim() || 'shutdown'
        };
        fs.writeFileSync(sessionMetaPath, `${stableStringify(next)}\n`, 'utf8');
      } catch {}
    }
  };
};

/**
 * Create the outbound supervisor protocol writer with flow-control and chunking.
 *
 * This object centralizes all emission semantics so job, watchdog, and request
 * handlers only express intent (`emit`, `emitLog`) while this module enforces
 * queueing, chunk split, and credit accounting behavior.
 *
 * @param {{
 *  runId:string,
 *  nextSeq:(jobId?:string|null)=>number,
 *  eventLogRecorder:{write:(entry:object)=>void}|null
 * }} input
 * @returns {{
 *  emit:(event:string,payload?:object,options?:{jobId?:string|null,critical?:boolean})=>void,
 *  emitLog:(jobId:string|null,level:'info'|'warn'|'error',message:string,extra?:object)=>void,
 *  emitHello:(input:{supervisorVersion:string})=>void,
 *  emitRuntimeMetrics:()=>void,
 *  addFlowCredits:(value:number)=>number,
 *  buildFlowSnapshot:(input?:{includeChunked?:boolean})=>object
 * }}
 */
export const createFlowController = ({ runId, nextSeq, eventLogRecorder }) => {
  const flow = {
    credits: FLOW_DEFAULT_CREDITS,
    queue: [],
    queueMax: FLOW_QUEUE_MAX,
    maxEventChars: FLOW_MAX_EVENT_CHARS,
    chunkChars: FLOW_CHUNK_CHARS,
    sent: 0,
    dropped: 0,
    coalesced: 0,
    chunked: 0,
    chunkSeq: 0
  };

  /** @returns {string} */
  const nextChunkId = () => {
    flow.chunkSeq += 1;
    return `${runId}-chunk-${flow.chunkSeq}`;
  };

  /**
   * Write one protocol event frame to stdout and optional event log.
   *
   * @param {object} entry
   * @returns {void}
   */
  const writeEvent = (entry) => {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
    eventLogRecorder?.write(entry);
    flow.sent += 1;
  };

  /**
   * Enqueue a flow event with bounded-queue coalescing semantics.
   *
   * When full, progress events for the same job/task replace older entries and
   * log events preferentially evict older log entries before generic FIFO drops.
   *
   * @param {object} entry
   * @returns {void}
   */
  const queueFlowEntry = (entry) => {
    const queue = flow.queue;
    if (queue.length < flow.queueMax) {
      queue.push(entry);
      return;
    }
    if (entry.event === 'task:progress') {
      const replacementIndex = queue.findLastIndex((queued) => (
        queued.event === 'task:progress'
        && queued.jobId === entry.jobId
        && queued.taskId === entry.taskId
      ));
      if (replacementIndex >= 0) {
        queue[replacementIndex] = entry;
        flow.coalesced += 1;
        return;
      }
    }
    if (entry.event === 'log') {
      const dropIndex = queue.findIndex((queued) => queued.event === 'log');
      if (dropIndex >= 0) {
        queue.splice(dropIndex, 1);
        flow.dropped += 1;
      }
    } else {
      queue.shift();
      flow.dropped += 1;
    }
    queue.push(entry);
  };

  /**
   * Flush queued flow entries while per-interval send credits remain.
   *
   * @returns {void}
   */
  const drainFlowQueue = () => {
    while (flow.credits > 0 && flow.queue.length > 0) {
      const next = flow.queue.shift();
      if (!next) break;
      flow.credits -= 1;
      writeEvent(next);
    }
  };

  /**
   * Emit immediately when credits allow, otherwise enqueue for later drain.
   *
   * @param {object} entry
   * @param {{critical?:boolean}} [options]
   * @returns {void}
   */
  const emitEntry = (entry, { critical = false } = {}) => {
    if (critical || flow.credits > 0) {
      if (!critical) {
        flow.credits = Math.max(0, flow.credits - 1);
      }
      writeEvent(entry);
      return;
    }
    queueFlowEntry(entry);
  };

  /**
   * Split oversized serialized events into chunk protocol frames.
   *
   * @param {object} entry
   * @returns {object[]|null}
   */
  const splitEventPayloadIntoChunks = (entry) => {
    const serialized = JSON.stringify(entry);
    if (serialized.length <= flow.maxEventChars || entry.event === 'event:chunk') {
      return null;
    }
    const chunkId = nextChunkId();
    const chunks = [];
    for (let offset = 0; offset < serialized.length; offset += flow.chunkChars) {
      chunks.push(serialized.slice(offset, offset + flow.chunkChars));
    }
    flow.chunked += 1;
    return chunks.map((chunk, index) => formatProgressEvent('event:chunk', {
      runId,
      ...(entry.jobId ? { jobId: entry.jobId } : {}),
      seq: nextSeq(entry.jobId || null),
      chunkId,
      chunkEvent: entry.event,
      chunkIndex: index,
      chunkCount: chunks.length,
      chunk
    }));
  };

  /**
   * Emit one protocol event with chunking and flow-control semantics applied.
   *
   * @param {string} event
   * @param {object} [payload={}]
   * @param {{jobId?:string|null,critical?:boolean}} [options]
   * @returns {void}
   */
  const emit = (event, payload = {}, { jobId = null, critical = false } = {}) => {
    const entry = formatProgressEvent(event, {
      runId,
      ...(jobId ? { jobId } : {}),
      seq: nextSeq(jobId),
      ...payload
    });
    const chunked = splitEventPayloadIntoChunks(entry);
    if (Array.isArray(chunked)) {
      for (const chunkEntry of chunked) {
        emitEntry(chunkEntry, { critical });
      }
      return;
    }
    emitEntry(entry, { critical: critical || CRITICAL_EVENTS.has(event) });
  };

  /**
   * Emit normalized supervisor log event.
   *
   * @param {string|null} jobId
   * @param {'info'|'warn'|'error'} level
   * @param {string} message
   * @param {object} [extra]
   * @returns {void}
   */
  const emitLog = (jobId, level, message, extra = {}) => {
    emit('log', {
      level,
      message,
      ...extra
    }, { jobId });
  };

  /**
   * Build current flow-control counters snapshot.
   *
   * @param {{includeChunked?:boolean}} [input]
   * @returns {object}
   */
  const buildFlowSnapshot = ({ includeChunked = false } = {}) => ({
    credits: flow.credits,
    queueDepth: flow.queue.length,
    sent: flow.sent,
    dropped: flow.dropped,
    coalesced: flow.coalesced,
    ...(includeChunked ? { chunked: flow.chunked } : {})
  });

  /**
   * Add downstream flow credits and drain queued events.
   *
   * @param {number} value
   * @returns {number}
   */
  const addFlowCredits = (value) => {
    const credits = clampInt(value, 0, FLOW_MAX_CREDITS, 0);
    if (credits <= 0) return 0;
    flow.credits = Math.min(FLOW_MAX_CREDITS, flow.credits + credits);
    drainFlowQueue();
    return credits;
  };

  /**
   * Emit periodic runtime metrics heartbeat for supervisor health.
   *
   * @returns {void}
   */
  const emitRuntimeMetrics = () => {
    emit('runtime:metrics', {
      flow: buildFlowSnapshot({ includeChunked: true })
    }, { critical: true });
  };

  /**
   * Emit startup capabilities handshake event.
   *
   * @param {{supervisorVersion:string}} input
   * @returns {void}
   */
  const emitHello = ({ supervisorVersion }) => {
    emit('hello', {
      supervisorVersion,
      capabilities: SUPERVISOR_CAPABILITIES
    }, { critical: true });
  };

  return {
    emit,
    emitLog,
    emitHello,
    emitRuntimeMetrics,
    addFlowCredits,
    buildFlowSnapshot
  };
};

import { types } from 'node:util';

// These are observation budgets, independent of task input/output allowances.
export const WORKER_OBSERVATION_VERSION = 1;
export const WORKER_OBSERVATION_BYTES = 16384;
export const WORKER_OBSERVATION_QUEUE_BYTES = 65536;
export const WORKER_OBSERVATION_QUEUE_EVENTS = 8;
export const WORKER_CONTROL_BYTES = 2048;
const TEXT_BYTES = 2048;

/** Read data properties only. Proxies, getters and custom inspection are never diagnostics. */
export const workerDataProperty = (value, key) => {
  if (value === null || !['object', 'function'].includes(typeof value) || types.isProxy(value)) return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
};

// Scan only the retained prefix; never encode/copy an entire unbounded string.
const prefix = (text, limit) => {
  let end = 0, bytes = 0;
  while (end < text.length) {
    const code = text.codePointAt(end);
    const width = code > 0xffff ? 2 : 1;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > limit) break;
    bytes += size; end += width;
  }
  return { text: text.slice(0, end), bytes, truncated: end !== text.length };
};

const captureText = () => {
  let remaining = TEXT_BYTES, truncatedFields = 0, droppedFields = 0;
  return {
    text(value, limit = 768) {
      if (typeof value !== 'string') { if (value !== undefined && value !== null) droppedFields++; return null; }
      const part = prefix(value, Math.min(limit, remaining));
      remaining -= part.bytes;
      if (part.truncated) truncatedFields++;
      return part.text;
    },
    drop() { droppedFields++; },
    stats: () => ({ retainedTextBytes: TEXT_BYTES - remaining, truncatedFields, droppedFields })
  };
};

/** Bounded first-cause projection, including primitive/falsey throws, without inspecting payloads. */
export const projectWorkerError = error => {
  const capture = captureText(), seen = new Set();
  const visit = (value, depth) => {
    if (value === null || typeof value !== 'object') return {
      thrownType: value === null ? 'null' : typeof value,
      message: capture.text(typeof value === 'string' ? value
        : value === undefined ? 'undefined' : value === null ? 'null'
          : typeof value === 'boolean' || typeof value === 'number' ? String(value) : `[${typeof value}]`)
    };
    if (types.isProxy(value) || seen.has(value)) { capture.drop(); return { message: '[unavailable or cyclic error]' }; }
    seen.add(value);
    const cause = workerDataProperty(value, 'cause');
    const result = {
      name: capture.text(workerDataProperty(value, 'name'), 128) || 'Error',
      code: capture.text(workerDataProperty(value, 'code'), 128),
      message: capture.text(workerDataProperty(value, 'message'), 768) || 'Worker task failed.',
      stack: capture.text(workerDataProperty(value, 'stack'), 1024)
    };
    if (cause !== undefined) {
      if (depth < 2) result.cause = visit(cause, depth + 1);
      else capture.drop();
    }
    return result;
  };
  return { ...visit(error, 0), ...capture.stats() };
};

/** A transportable task error. Arbitrary original objects never become cloned diagnostics. */
export const createWorkerTaskError = (original, label = 'worker') => {
  const detail = projectWorkerError(original);
  const cause = original === null || ['undefined', 'string', 'boolean', 'number'].includes(typeof original)
    ? (typeof original === 'string' ? detail.message : original) : detail;
  const error = new Error(`[${prefix(label, 64).text}] ${detail.message}`, { cause });
  error.name = detail.name || 'Error';
  if (detail.code) error.code = detail.code;
  return error;
};

const runtimeKeys = ['observedAt', 'observationMethod', 'processInstanceId', 'startedAt', 'pid', 'ppid',
  'execPath', 'nodeVersion', 'v8Version', 'platform', 'arch', 'threadId', 'isMainThread',
  'heapSizeLimitBytes', 'heapObservationMethod', 'uvThreadpoolSize', 'uvObservationMethod',
  'heapSizeLimitCeilingBytes', 'resourceLimitAcknowledged', 'limitCheckMethod', 'execution',
  'requestedOldSpaceMb', 'workerAttemptId', 'parentAttemptId', 'buildId'];
const runtimeNested = {
  host: ['logicalCpuCount', 'availableParallelism', 'totalMemoryBytes'],
  resourceLimits: ['maxYoungGenerationSizeMb', 'maxOldGenerationSizeMb', 'codeRangeSizeMb', 'stackSizeMb'],
  startupInputs: ['redacted', 'uvThreadpoolSize', 'observationMethod']
};
const scalar = (value, capture) => typeof value === 'string' ? capture.text(value)
  : value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
const captureRuntime = (value, capture) => {
  const out = {};
  for (const key of runtimeKeys) {
    const field = workerDataProperty(value, key);
    if (field !== undefined) out[key] = scalar(field, capture);
    if (['processInstanceId', 'workerAttemptId', 'parentAttemptId', 'buildId'].includes(key)
      && typeof field === 'string' && out[key] !== field) return null;
  }
  for (const [key, keys] of Object.entries(runtimeNested)) {
    const nested = workerDataProperty(value, key);
    if (nested === null || nested === undefined) { out[key] = null; continue; }
    out[key] = {};
    for (const name of keys) out[key][name] = scalar(workerDataProperty(nested, name), capture);
    if (key === 'startupInputs') {
      const source = workerDataProperty(nested, 'maxOldSpaceMb');
      out[key].maxOldSpaceMb = {};
      for (const name of ['value', 'source', 'detail']) out[key].maxOldSpaceMb[name] = scalar(workerDataProperty(source, name), capture);
      for (const name of ['execArgv', 'nodeOptions']) {
        const args = workerDataProperty(nested, name), entries = [];
        if (Array.isArray(args) && !types.isProxy(args)) {
          for (let i = 0; i < Math.min(args.length, 16); i++) entries.push(capture.text(workerDataProperty(args, String(i)), 128));
          if (args.length > 16) capture.drop();
        }
        out[key][name] = entries;
      }
    }
  }
  return out;
};

const eventTypes = new Set(['worker-task-start', 'worker-task', 'worker-crash', 'worker-runtime']);
export const createWorkerObservation = (event, sequence = 0) => {
  const type = workerDataProperty(event, 'type');
  if (!eventTypes.has(type)) return null;
  const capture = captureText();
  const id = workerDataProperty(event, 'threadId');
  const message = { type: 'worker-observation', version: WORKER_OBSERVATION_VERSION,
    sequence, threadId: Number.isSafeInteger(id) && id > 0 ? id : null, event: { type } };
  for (const key of ['task', 'status', 'label', 'stage']) {
    const field = workerDataProperty(event, key);
    if (field !== undefined) message.event[key] = capture.text(field, 64);
  }
  const duration = workerDataProperty(event, 'durationMs');
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) message.event.durationMs = duration;
  if (type === 'worker-crash') message.event.error = projectWorkerError(workerDataProperty(event, 'error'));
  if (type === 'worker-runtime') {
    message.event.observation = captureRuntime(workerDataProperty(event, 'observation'), capture);
    if (!message.event.observation) return null;
  }
  message.capture = capture.stats();
  if (Buffer.byteLength(JSON.stringify(message)) > WORKER_OBSERVATION_BYTES) return null;
  return message;
};

/** Re-admit at the receiver. Unknown fields are never forwarded or logged. */
export const readWorkerObservation = message => {
  if (workerDataProperty(message, 'type') !== 'worker-observation'
    || workerDataProperty(message, 'version') !== WORKER_OBSERVATION_VERSION) return null;
  const sequence = workerDataProperty(message, 'sequence');
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  const event = workerDataProperty(message, 'event');
  const input = { type: workerDataProperty(event, 'type'), threadId: workerDataProperty(message, 'threadId') };
  for (const key of ['task', 'status', 'label', 'stage', 'durationMs', 'observation']) input[key] = workerDataProperty(event, key);
  if (input.type === 'worker-crash') input.error = workerDataProperty(event, 'error');
  const admitted = createWorkerObservation(input, sequence);
  if (!admitted) return null;
  const counts = source => {
    const result = {};
    for (const key of ['retainedTextBytes', 'truncatedFields', 'droppedFields', 'dropped', 'sendFailures']) {
      const value = workerDataProperty(source, key);
      if (Number.isSafeInteger(value) && value >= 0) result[key] = value;
    }
    return result;
  };
  return { ...admitted.event, threadId: admitted.threadId, sequence,
    diagnosticCapture: counts(workerDataProperty(message, 'capture')),
    diagnosticErrorCapture: counts(workerDataProperty(event, 'error')),
    diagnosticDelivery: counts(workerDataProperty(message, 'delivery')) };
};

/** One unacknowledged frame plus a bounded FIFO. Backpressure never blocks a task. */
export const createWorkerObserver = ({ send }) => {
  const queue = [];
  let sequence = 0, inFlight = null, retainedBytes = 0, peakBytes = 0, dropped = 0, sendFailures = 0, channelFailed = false;
  const flush = () => {
    while (!inFlight && queue.length) {
      const frame = queue.shift();
      inFlight = frame;
      try { send(frame.message, error => {
        if (!error || channelFailed || inFlight !== frame) return;
        channelFailed = true; sendFailures++;
        dropped += queue.length + 1; queue.length = 0; inFlight = null; retainedBytes = 0;
      }); }
      catch {
        if (inFlight === frame) { retainedBytes -= frame.bytes; inFlight = null; }
        sendFailures++; dropped++;
      }
    }
  };
  return {
    emit(event) {
      try {
        if (channelFailed) { dropped++; return; }
        const message = createWorkerObservation(event, ++sequence);
        if (!message) { dropped++; return; }
        let bytes;
        // At most eight owned frames can be evicted. Recompute tiny delivery
        // counters after shedding so the transported counts are exact.
        while (true) {
          message.delivery = { dropped, sendFailures };
          bytes = Buffer.byteLength(JSON.stringify(message));
          if (!queue.length || (queue.length + (inFlight ? 1 : 0) < WORKER_OBSERVATION_QUEUE_EVENTS
            && retainedBytes + bytes <= WORKER_OBSERVATION_QUEUE_BYTES)) break;
          retainedBytes -= queue.shift().bytes; dropped++;
        }
        if (bytes > WORKER_OBSERVATION_BYTES || retainedBytes + bytes > WORKER_OBSERVATION_QUEUE_BYTES) { dropped++; return; }
        queue.push({ message, bytes }); retainedBytes += bytes; peakBytes = Math.max(peakBytes, retainedBytes);
        flush();
      } catch { dropped++; }
    },
    acknowledge(message) {
      if (workerDataProperty(message, 'type') !== 'worker-observation-ack'
        || workerDataProperty(message, 'version') !== WORKER_OBSERVATION_VERSION
        || workerDataProperty(message, 'sequence') !== inFlight?.message.sequence) return;
      retainedBytes -= inFlight.bytes; inFlight = null; flush();
    },
    stats: () => ({ retainedBytes, peakBytes, queuedEvents: queue.length + (inFlight ? 1 : 0), dropped, sendFailures, channelFailed })
  };
};

/** Observation cannot replace a return value or an original (including falsey) throw. */
export const withWorkerTaskObservation = (fn, { observer, threadId, task }) => async input => {
  const startedAt = process.hrtime.bigint();
  const emit = event => { try { observer.emit(event); } catch { /* best effort */ } };
  emit({ type: 'worker-task-start', threadId, task });
  let status = 'error';
  try { const value = await fn(input); status = 'ok'; return value; }
  finally { emit({ type: 'worker-task', threadId, task, status, durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6 }); }
};

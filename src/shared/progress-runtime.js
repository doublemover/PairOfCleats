import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

const createLoggerState = () => ({ lastProgressActive: false, lastProgressWidth: 0,
  logger: null, structuredEnabled: false, logContext: {}, ringMax: 200,
  ringMaxBytes: 2 * 1024 * 1024, ringEvents: [], ringSizes: [], ringBytes: 0,
  progressHandlers: null, metaSerializer: null, ownedDestination: null, closePromise: null });
const defaultLoggerState = createLoggerState();
const loggerScope = new AsyncLocalStorage();
const currentLoggerState = () => loggerScope.getStore() || defaultLoggerState;
const ringMetaMaxBytes = 8 * 1024;
const defaultRedactPaths = [
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'headers.set-cookie',
  'auth',
  'credentials'
];

const normalizeRedact = (value) => {
  if (value === false) return null;
  if (Array.isArray(value)) {
    return value.length ? { paths: value, censor: '[redacted]' } : null;
  }
  if (value && typeof value === 'object') {
    const paths = Array.isArray(value.paths) ? value.paths : [];
    const censor = typeof value.censor === 'string' ? value.censor : '[redacted]';
    const remove = value.remove === true;
    return paths.length ? { paths, censor, remove } : null;
  }
  return { paths: defaultRedactPaths, censor: '[redacted]' };
};

const safeJsonStringify = (value) => {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (typeof val === 'function') return `[Function${val.name ? `: ${val.name}` : ''}]`;
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
};

const truncateUtf8 = (value, maxBytes) => {
  const raw = typeof value === 'string' ? value : String(value || '');
  const size = Buffer.byteLength(raw, 'utf8');
  if (size <= maxBytes) return raw;
  const suffix = '...[truncated]';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const keepBytes = Math.max(0, maxBytes - suffixBytes);
  const slice = Buffer.from(raw, 'utf8').subarray(0, keepBytes);
  return `${slice.toString('utf8')}${suffix}`;
};

const snapshotMeta = (meta) => {
  if (meta == null) return null;
  let encoded = '';
  try {
    encoded = safeJsonStringify(meta);
  } catch {
    encoded = '"[unserializable]"';
  }
  if (!encoded) return null;
  try {
    const state = currentLoggerState();
    state.metaSerializer ||= createMetaSerializer(normalizeRedact());
    encoded = state.metaSerializer(encoded);
  }
  catch { encoded = '"[redaction unavailable]"'; }
  return truncateUtf8(encoded, ringMetaMaxBytes);
};

const normalizeDestinationTarget = (value) => {
  if (!value) return null;
  if (value && typeof value.write === 'function') return value;
  if (value === 'stdout' || value === 1) return 1;
  if (value === 'stderr' || value === 2) return 2;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
};

const resolveDestinationStream = (value) => {
  if (!value) return null;
  if (value && typeof value.write === 'function') return value;
  const target = normalizeDestinationTarget(value);
  if (target == null) return null;
  return pino.destination(target);
};

// Reuse Pino's redaction semantics for immutable ring snapshots, including
// wildcard/bracket paths and remove mode, rather than maintaining another engine.
const createMetaSerializer = redact => {
  if (!redact) return encoded => encoded;
  let output = '';
  const serializer = pino({ level: 'trace', base: null, timestamp: false, redact,
    formatters: { level: () => ({ level: 0 }) } }, { write(value) { output = String(value).trimEnd(); } });
  return encoded => {
    output = ''; serializer.info(JSON.parse(encoded));
    // Pino requires a nonempty level fragment to emit valid JSON. Remove only
    // that leading synthetic fragment; a caller's own level field survives.
    if (output === '{"level":0}') return '{}';
    return output.startsWith('{"level":0,') ? `{${output.slice(11)}` : '"[redaction unavailable]"';
  };
};

export const createLoggerScope = (options = {}) => {
  const state = createLoggerState();
  // Runtime scopes keep their caller's selected display. Later global handler
  // replacement cannot redirect that scope; independent scopes stay isolated.
  if (options.inheritProgressHandlers === true) state.progressHandlers = currentLoggerState().progressHandlers;
  loggerScope.run(state, () => configureLogger(options));
  const run = (fn, ...args) => loggerScope.run(state, fn, ...args);
  return { run, log: (...args) => run(log, ...args), logLine: (...args) => run(logLine, ...args),
    logError: (...args) => run(logError, ...args), showProgress: (...args) => run(showProgress, ...args),
    updateLogContext: (...args) => run(updateLogContext, ...args),
    getRecentLogEvents: () => run(getRecentLogEvents),
    setProgressHandlers: (...args) => run(setProgressHandlers, ...args),
    close: () => {
      if (state.closePromise) return state.closePromise;
      state.closePromise = (async () => {
        if (state.logger) await new Promise((resolve, reject) => state.logger.flush(error => error ? reject(error) : resolve()));
        const destination = state.ownedDestination;
        if (destination && !destination.destroyed && !destination.closed) {
          await new Promise((resolve, reject) => {
            destination.once('error', reject);
            destination.once('close', resolve);
            destination.end();
          });
        }
      })();
      return state.closePromise;
    } };
};

const recordEvent = (level, msg, meta) => {
  const state = currentLoggerState();
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    meta: snapshotMeta({ ...state.logContext, ...(meta || {}) })
  };
  let encoded = '';
  try {
    encoded = JSON.stringify(payload);
  } catch {
    encoded = '{"ts":"[unserializable]","level":"error","msg":"[unserializable]"}';
  }
  const size = Buffer.byteLength(encoded, 'utf8');
  state.ringEvents.push(payload);
  state.ringSizes.push(size);
  state.ringBytes += size;
  while (state.ringEvents.length > state.ringMax || state.ringBytes > state.ringMaxBytes) {
    state.ringBytes -= state.ringSizes.shift() || 0;
    state.ringEvents.shift();
  }
};

export function configureLogger(options = {}) {
  const state = currentLoggerState();
  const enabled = options.enabled === true;
  state.structuredEnabled = enabled;
  if (Number.isFinite(Number(options.ringMax))) state.ringMax = Math.max(1, Math.floor(Number(options.ringMax)));
  if (Number.isFinite(Number(options.ringMaxBytes))) state.ringMaxBytes = Math.max(1024, Math.floor(Number(options.ringMaxBytes)));
  while (state.ringEvents.length > state.ringMax || state.ringBytes > state.ringMaxBytes) {
    state.ringBytes -= state.ringSizes.shift() || 0;
    state.ringEvents.shift();
  }
  const redact = normalizeRedact(options.redact);
  state.metaSerializer = createMetaSerializer(redact);
  state.logContext = options.context && typeof options.context === 'object' ? { ...options.context } : {};
  if (!enabled) { state.logger = null; return; }
  const level = typeof options.level === 'string' && options.level.trim()
    ? options.level.trim().toLowerCase()
    : 'info';
  const destinationTarget = normalizeDestinationTarget(options.destination);
  const resolvedDestination = destinationTarget ?? 2;
  const destinationStream = options.pretty ? null : resolveDestinationStream(resolvedDestination);
  const transport = options.pretty
    ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ...(resolvedDestination != null ? { destination: resolvedDestination } : {})
      }
    })
    : null;
  state.ownedDestination = transport || (destinationTarget && typeof destinationTarget !== 'object'
    && destinationTarget !== 1 && destinationTarget !== 2 && destinationTarget !== 'stdout'
    && destinationTarget !== 'stderr' ? destinationStream : null);
  state.logger = pino({
    level,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(redact ? { redact } : {})
  }, transport || destinationStream || undefined);
  state.logContext = options.context && typeof options.context === 'object'
    ? { ...options.context }
    : {};
}

export function setProgressHandlers(handlers) {
  const state = currentLoggerState();
  const prev = state.progressHandlers;
  state.progressHandlers = handlers && typeof handlers === 'object' ? handlers : null;
  return () => {
    state.progressHandlers = prev;
  };
}

export function updateLogContext(context = {}) {
  const state = currentLoggerState();
  if (!context || typeof context !== 'object') return;
  state.logContext = { ...state.logContext, ...context };
}

export function getRecentLogEvents() {
  const state = currentLoggerState();
  return state.ringEvents.slice();
}

export function isStructuredLogging() {
  const state = currentLoggerState();
  return state.structuredEnabled;
}

function clearProgressLine() {
  const state = currentLoggerState();
  if (!state.lastProgressActive || !process.stderr.isTTY) return;
  const width = Math.max(0, state.lastProgressWidth);
  if (width > 0) {
    process.stderr.write(`\r${' '.repeat(width)}\r`);
  }
  state.lastProgressActive = false;
  state.lastProgressWidth = 0;
}

export function showProgress(step, i, total, meta = null) {
  const state = currentLoggerState();
  if (state.progressHandlers?.showProgress) {
    state.progressHandlers.showProgress(step, i, total, meta);
    return;
  }
  if (state.structuredEnabled) return;
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeIndex = Number.isFinite(i) ? Math.max(0, i) : 0;
  const pct = safeTotal ? ((safeIndex / safeTotal) * 100).toFixed(1) : '0.0';
  const line = `${step} ${safeIndex}/${safeTotal} (${pct}%)`;
  const isTty = process.stderr.isTTY;
  if (isTty) {
    process.stderr.write(`\r${line}\x1b[K`);
    state.lastProgressActive = true;
    state.lastProgressWidth = line.length;
    if (i === total) {
      process.stderr.write('\n');
      state.lastProgressActive = false;
      state.lastProgressWidth = 0;
    }
  } else {
    process.stderr.write(`${line}\n`);
    state.lastProgressActive = false;
    state.lastProgressWidth = 0;
  }
}

export function log(msg, meta = null) {
  const state = currentLoggerState();
  if (state.logger) {
    state.logger.info({ ...state.logContext, ...(meta || {}) }, msg);
    recordEvent('info', msg, meta);
    if (state.progressHandlers?.log) {
      state.progressHandlers.log(msg, meta);
    }
    return;
  }
  recordEvent('info', msg, meta);
  if (state.progressHandlers?.log) {
    state.progressHandlers.log(msg, meta);
    return;
  }
  clearProgressLine();
  process.stderr.write(`\n${msg}\n`);
}

export function logLine(msg, meta = null) {
  const state = currentLoggerState();
  const isStatus = meta && typeof meta === 'object' && meta.kind === 'status';
  if (isStatus && !state.progressHandlers?.logLine && process.stderr.isTTY) {
    recordEvent('info', msg, meta);
    const line = String(msg || '');
    const width = line.length;
    process.stderr.write(`\r${line}\x1b[K`);
    state.lastProgressActive = true;
    state.lastProgressWidth = width;
    if (!line) {
      process.stderr.write('\r');
      state.lastProgressActive = false;
      state.lastProgressWidth = 0;
    }
    return;
  }
  if (state.logger) {
    state.logger.info({ ...state.logContext, ...(meta || {}) }, msg);
    recordEvent('info', msg, meta);
    if (state.progressHandlers?.logLine) {
      state.progressHandlers.logLine(msg, meta);
    }
    return;
  }
  recordEvent('info', msg, meta);
  if (state.progressHandlers?.logLine) {
    state.progressHandlers.logLine(msg, meta);
    return;
  }
  clearProgressLine();
  process.stderr.write(`${msg}\n`);
}

export function logError(msg, meta = null) {
  const state = currentLoggerState();
  if (state.logger) {
    state.logger.error({ ...state.logContext, ...(meta || {}) }, msg);
    recordEvent('error', msg, meta);
    if (state.progressHandlers?.logError) {
      state.progressHandlers.logError(msg, meta);
    }
    return;
  }
  recordEvent('error', msg, meta);
  if (state.progressHandlers?.logError) {
    state.progressHandlers.logError(msg, meta);
    return;
  }
  clearProgressLine();
  process.stderr.write(`\n${msg}\n`);
}

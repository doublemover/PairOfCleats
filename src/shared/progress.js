import pino from 'pino';

/**
 * Write a simple progress line to stderr.
 * @param {string} step
 * @param {number} i
 * @param {number} total
 */
let lastProgressActive = false;
let lastProgressWidth = 0;
let logger = null;
let structuredEnabled = false;
let logContext = {};
let ringMax = 200;
let ringMaxBytes = 2 * 1024 * 1024;
const ringMetaMaxBytes = 8 * 1024;
const ringEvents = [];
const ringSizes = [];
let ringBytes = 0;
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
let progressHandlers = null;

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

const recordEvent = (level, msg, meta) => {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    meta: snapshotMeta(meta)
  };
  let encoded = '';
  try {
    encoded = JSON.stringify(payload);
  } catch {
    encoded = '{"ts":"[unserializable]","level":"error","msg":"[unserializable]"}';
  }
  const size = Buffer.byteLength(encoded, 'utf8');
  ringEvents.push(payload);
  ringSizes.push(size);
  ringBytes += size;
  while (ringEvents.length > ringMax || ringBytes > ringMaxBytes) {
    ringBytes -= ringSizes.shift() || 0;
    ringEvents.shift();
  }
};

export function configureLogger(options = {}) {
  const enabled = options.enabled === true;
  structuredEnabled = enabled;
  if (!enabled) {
    logger = null;
    logContext = options.context && typeof options.context === 'object'
      ? { ...options.context }
      : {};
    return;
  }
  if (Number.isFinite(Number(options.ringMax))) {
    ringMax = Math.max(1, Math.floor(Number(options.ringMax)));
  }
  if (Number.isFinite(Number(options.ringMaxBytes))) {
    ringMaxBytes = Math.max(1024, Math.floor(Number(options.ringMaxBytes)));
  }
  const level = typeof options.level === 'string' && options.level.trim()
    ? options.level.trim().toLowerCase()
    : 'info';
  const redact = normalizeRedact(options.redact);
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
  logger = pino({
    level,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(redact ? { redact } : {})
  }, transport || destinationStream || undefined);
  logContext = options.context && typeof options.context === 'object'
    ? { ...options.context }
    : {};
}

export function setProgressHandlers(handlers) {
  const prev = progressHandlers;
  progressHandlers = handlers && typeof handlers === 'object' ? handlers : null;
  return () => {
    progressHandlers = prev;
  };
}

export function updateLogContext(context = {}) {
  if (!context || typeof context !== 'object') return;
  logContext = { ...logContext, ...context };
}

export function getRecentLogEvents() {
  return ringEvents.slice();
}

export function isStructuredLogging() {
  return structuredEnabled;
}

function clearProgressLine() {
  if (!lastProgressActive || !process.stderr.isTTY) return;
  const width = Math.max(0, lastProgressWidth);
  if (width > 0) {
    process.stderr.write(`\r${' '.repeat(width)}\r`);
  }
  lastProgressActive = false;
  lastProgressWidth = 0;
}

export function showProgress(step, i, total, meta = null) {
  if (progressHandlers?.showProgress) {
    progressHandlers.showProgress(step, i, total, meta);
    return;
  }
  if (structuredEnabled) return;
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeIndex = Number.isFinite(i) ? Math.max(0, i) : 0;
  const pct = safeTotal ? ((safeIndex / safeTotal) * 100).toFixed(1) : '0.0';
  const line = `${step} ${safeIndex}/${safeTotal} (${pct}%)`;
  const isTty = process.stderr.isTTY;
  if (isTty) {
    process.stderr.write(`\r${line}\x1b[K`);
    lastProgressActive = true;
    lastProgressWidth = line.length;
    if (i === total) {
      process.stderr.write('\n');
      lastProgressActive = false;
      lastProgressWidth = 0;
    }
  } else {
    process.stderr.write(`${line}\n`);
    lastProgressActive = false;
    lastProgressWidth = 0;
  }
}

/**
 * Write a log message to stderr.
 * @param {string} msg
 * @param {object} [meta]
 */
export function log(msg, meta = null) {
  if (logger) {
    logger.info({ ...logContext, ...(meta || {}) }, msg);
    recordEvent('info', msg, meta);
    if (progressHandlers?.log) {
      progressHandlers.log(msg, meta);
    }
    return;
  }
  recordEvent('info', msg, meta);
  if (progressHandlers?.log) {
    progressHandlers.log(msg, meta);
    return;
  }
  clearProgressLine();
  process.stderr.write(`\n${msg}\n`);
}

/**
 * Write a single log line to stderr without extra spacing.
 * @param {string} msg
 * @param {object} [meta]
 */
export function logLine(msg, meta = null) {
  const isStatus = meta && typeof meta === 'object' && meta.kind === 'status';
  if (isStatus && !progressHandlers?.logLine && process.stderr.isTTY) {
    recordEvent('info', msg, meta);
    const line = String(msg || '');
    const width = line.length;
    process.stderr.write(`\r${line}\x1b[K`);
    lastProgressActive = true;
    lastProgressWidth = width;
    if (!line) {
      process.stderr.write('\r');
      lastProgressActive = false;
      lastProgressWidth = 0;
    }
    return;
  }
  if (logger) {
    logger.info({ ...logContext, ...(meta || {}) }, msg);
    recordEvent('info', msg, meta);
    if (progressHandlers?.logLine) {
      progressHandlers.logLine(msg, meta);
    }
    return;
  }
  recordEvent('info', msg, meta);
  if (progressHandlers?.logLine) {
    progressHandlers.logLine(msg, meta);
    return;
  }
  clearProgressLine();
  process.stderr.write(`${msg}\n`);
}

/**
 * Write an error log message.
 * @param {string} msg
 * @param {object} [meta]
 */
export function logError(msg, meta = null) {
  if (logger) {
    logger.error({ ...logContext, ...(meta || {}) }, msg);
    recordEvent('error', msg, meta);
    if (progressHandlers?.logError) {
      progressHandlers.logError(msg, meta);
    }
    return;
  }
  recordEvent('error', msg, meta);
  if (progressHandlers?.logError) {
    progressHandlers.logError(msg, meta);
    return;
  }
  clearProgressLine();
  process.stderr.write(`\n${msg}\n`);
}

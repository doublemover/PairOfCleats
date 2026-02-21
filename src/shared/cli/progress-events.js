export const PROGRESS_PROTOCOL = 'poc.progress@2';

export const PROGRESS_EVENTS = new Set([
  'hello',
  'job:start',
  'job:spawn',
  'job:end',
  'job:artifacts',
  'runtime:metrics',
  'event:chunk',
  'task:start',
  'task:progress',
  'task:end',
  'log'
]);

const LEGACY_EVENTS = new Set(['task:start', 'task:progress', 'task:end', 'log']);

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

const isIsoTimestamp = (value) => {
  if (typeof value !== 'string' || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
};

const asEvent = (value) => String(value || '').trim();

export const formatProgressEvent = (event, payload = {}) => {
  const eventName = asEvent(event);
  const base = {
    proto: PROGRESS_PROTOCOL,
    event: eventName,
    ts: new Date().toISOString()
  };
  if (!isRecord(payload)) return base;
  return { ...base, ...payload, proto: PROGRESS_PROTOCOL, event: eventName };
};

export const writeProgressEvent = (stream, event, payload = {}) => {
  if (!stream || typeof stream.write !== 'function') return null;
  const entry = formatProgressEvent(event, payload);
  const line = `${JSON.stringify(entry)}\n`;
  stream.write(line);
  return entry;
};

export const isProgressEvent = (value, { strict = true } = {}) => {
  if (!isRecord(value)) return false;
  const eventName = asEvent(value.event);
  if (!eventName) return false;
  const allowlist = strict ? PROGRESS_EVENTS : new Set([...PROGRESS_EVENTS, ...LEGACY_EVENTS]);
  if (!allowlist.has(eventName)) return false;
  if (!isIsoTimestamp(value.ts)) return false;
  if (strict) {
    return value.proto === PROGRESS_PROTOCOL;
  }
  return value.proto == null || value.proto === PROGRESS_PROTOCOL;
};

export const parseProgressEventLine = (line, { strict = true } = {}) => {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return isProgressEvent(parsed, { strict }) ? parsed : null;
};

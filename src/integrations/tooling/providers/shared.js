import { sleep } from '../../../shared/sleep.js';

const hasIterable = (value) => value != null && typeof value[Symbol.iterator] === 'function';

const toEntryList = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Array.from(value.values());
  if (hasIterable(value)) return Array.from(value);
  if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) return [value];
  return [];
};

export const uniqueTypes = (values) => {
  const out = [];
  const seen = new Set();
  for (const entry of toEntryList(values)) {
    const normalized = typeof entry === 'string' ? entry.trim() : String(entry?.type || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const DEFAULT_MAX_RETURN_CANDIDATES = 5;
const DEFAULT_MAX_PARAM_CANDIDATES = 5;

const normalizeEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const type = entry.trim();
    if (!type) return null;
    return { type, source: null, confidence: null };
  }
  if (!entry.type) return null;
  return {
    type: entry.type,
    source: entry.source || null,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
  };
};

const mergeEntries = (existing, incoming, cap) => {
  const map = new Map();
  const add = (entry) => {
    const normalized = normalizeEntry(entry);
    if (!normalized || !normalized.type) return;
    const key = `${normalized.type}:${normalized.source || ''}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, normalized);
      return;
    }
    const priorConfidence = Number.isFinite(prior.confidence) ? prior.confidence : 0;
    const nextConfidence = Number.isFinite(normalized.confidence) ? normalized.confidence : 0;
    if (nextConfidence > priorConfidence) map.set(key, normalized);
  };
  for (const entry of toEntryList(existing)) add(entry);
  for (const entry of toEntryList(incoming)) add(entry);
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const typeCmp = String(a.type).localeCompare(String(b.type));
    if (typeCmp) return typeCmp;
    const sourceCmp = String(a.source || '').localeCompare(String(b.source || ''));
    if (sourceCmp) return sourceCmp;
    const confA = Number.isFinite(a.confidence) ? a.confidence : 0;
    const confB = Number.isFinite(b.confidence) ? b.confidence : 0;
    return confB - confA;
  });
  if (cap && list.length > cap) return list.slice(0, cap);
  return list;
};

export const createToolingEntry = () => ({
  returns: [],
  params: {},
  signature: '',
  paramNames: []
});

export const mergeToolingEntry = (target, incoming, options = {}) => {
  if (!incoming) return target;
  if (incoming.signature && !target.signature) target.signature = incoming.signature;
  if (incoming.paramNames?.length && (!target.paramNames || !target.paramNames.length)) {
    target.paramNames = incoming.paramNames.slice();
  }
  if (Array.isArray(incoming.returns) && incoming.returns.length) {
    const cap = Number.isFinite(options.maxReturnCandidates)
      ? options.maxReturnCandidates
      : DEFAULT_MAX_RETURN_CANDIDATES;
    target.returns = mergeEntries(target.returns || [], incoming.returns, cap).map((entry) => entry.type);
  }
  if (incoming.params && typeof incoming.params === 'object') {
    if (!target.params || typeof target.params !== 'object') target.params = {};
    for (const [name, types] of Object.entries(incoming.params)) {
      if (!name) continue;
      const incomingTypes = toEntryList(types);
      if (!incomingTypes.length) continue;
      const cap = Number.isFinite(options.maxParamCandidates)
        ? options.maxParamCandidates
        : DEFAULT_MAX_PARAM_CANDIDATES;
      target.params[name] = mergeEntries(target.params[name] || [], incomingTypes, cap).map((entry) => entry.type);
    }
  }
  return target;
};

export const mergeToolingMaps = (base, incoming) => {
  const target = base instanceof Map ? base : new Map();
  const pairs = incoming instanceof Map
    ? incoming.entries()
    : Array.isArray(incoming)
      ? incoming
      : Object.entries(incoming && typeof incoming === 'object' ? incoming : {});
  for (const [key, value] of pairs) {
    if (!target.has(key)) {
      const entry = createToolingEntry();
      mergeToolingEntry(entry, value);
      target.set(key, entry);
      continue;
    }
    mergeToolingEntry(target.get(key), value);
  }
  return target;
};

const FD_PRESSURE_PATTERN = /\b(emfile|enfile|too many open files)\b/i;

const trimWindow = (events, now, windowMs) => {
  while (events.length && (now - events[0]) > windowMs) events.shift();
};

/**
 * Shared runtime health tracker for long-lived tooling subprocess providers.
 * Tracks restart churn, crash-loop quarantine, and transient FD-pressure backoff.
 *
 * @param {{
 *   name?:string,
 *   restartWindowMs?:number,
 *   maxRestartsPerWindow?:number,
 *   fdPressureBackoffMs?:number,
 *   log?:(line:string)=>void
 * }} [options]
 * @returns {{
 *   onLifecycleEvent:(event:object)=>void,
 *   noteStderrLine:(line:string)=>void,
 *   getState:()=>object
 * }}
 */
export const createToolingLifecycleHealth = (options = {}) => {
  const name = String(options?.name || 'tooling');
  const restartWindowMs = Number.isFinite(Number(options?.restartWindowMs))
    ? Math.max(1000, Math.floor(Number(options.restartWindowMs)))
    : 60_000;
  const maxRestartsPerWindow = Number.isFinite(Number(options?.maxRestartsPerWindow))
    ? Math.max(2, Math.floor(Number(options.maxRestartsPerWindow)))
    : 6;
  const fdPressureBackoffMs = Number.isFinite(Number(options?.fdPressureBackoffMs))
    ? Math.max(50, Math.floor(Number(options.fdPressureBackoffMs)))
    : 1500;
  const log = typeof options?.log === 'function' ? options.log : (() => {});

  const starts = [];
  const crashes = [];
  let crashLoopTrips = 0;
  let crashLoopUntil = 0;
  let lastCrash = null;
  let fdPressureEvents = 0;
  let fdPressureUntil = 0;
  let lastFdPressureLine = '';

  const refreshWindows = (now = Date.now()) => {
    trimWindow(starts, now, restartWindowMs);
    trimWindow(crashes, now, restartWindowMs);
  };

  const evaluateCrashLoop = (now = Date.now()) => {
    refreshWindows(now);
    if (starts.length >= maxRestartsPerWindow && crashes.length >= (maxRestartsPerWindow - 1)) {
      crashLoopTrips += 1;
      crashLoopUntil = Math.max(crashLoopUntil, now + restartWindowMs);
      log(`[tooling] ${name} crash-loop quarantine active (${starts.length} starts/${crashes.length} failures in ${restartWindowMs}ms).`);
    }
  };

  const onLifecycleEvent = (event) => {
    const kind = String(event?.kind || '').trim();
    if (!kind) return;
    const now = Number.isFinite(Number(event?.at)) ? Number(event.at) : Date.now();
    if (kind === 'start') {
      starts.push(now);
      evaluateCrashLoop(now);
      return;
    }
    if (kind === 'exit' || kind === 'error') {
      crashes.push(now);
      lastCrash = {
        kind,
        code: event?.code ?? null,
        signal: event?.signal ?? null,
        message: event?.message ? String(event.message) : null,
        at: new Date(now).toISOString()
      };
      evaluateCrashLoop(now);
    }
  };

  const noteStderrLine = (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    if (!FD_PRESSURE_PATTERN.test(text)) return;
    const now = Date.now();
    fdPressureEvents += 1;
    fdPressureUntil = Math.max(fdPressureUntil, now + fdPressureBackoffMs);
    lastFdPressureLine = text;
    log(`[tooling] ${name} fd-pressure backoff armed (${fdPressureBackoffMs}ms).`);
  };

  const getState = () => {
    const now = Date.now();
    refreshWindows(now);
    return {
      restartWindowMs,
      maxRestartsPerWindow,
      startsInWindow: starts.length,
      crashesInWindow: crashes.length,
      crashLoopTrips,
      crashLoopQuarantined: now < crashLoopUntil,
      crashLoopBackoffRemainingMs: Math.max(0, crashLoopUntil - now),
      lastCrash,
      fdPressureEvents,
      fdPressureBackoffMs,
      fdPressureBackoffActive: now < fdPressureUntil,
      fdPressureBackoffRemainingMs: Math.max(0, fdPressureUntil - now),
      lastFdPressureLine: lastFdPressureLine || null
    };
  };

  return {
    onLifecycleEvent,
    noteStderrLine,
    getState
  };
};

export const createToolingGuard = ({
  name,
  timeoutMs = 15000,
  retries = 2,
  breakerThreshold = 3,
  log = () => {}
} = {}) => {
  let consecutiveFailures = 0;
  let lastFailure = null;
  let tripCount = 0;
  const isOpen = () => consecutiveFailures >= breakerThreshold;
  const reset = () => {
    consecutiveFailures = 0;
  };
  const recordFailure = (err, label) => {
    consecutiveFailures += 1;
    const message = err?.message || String(err);
    lastFailure = {
      label: label || null,
      message,
      code: err?.code || null,
      at: new Date().toISOString(),
      timedOut: /\btimeout\b/i.test(message)
    };
    if (label) log(`[tooling] ${name} ${label} failed (${consecutiveFailures}/${breakerThreshold}): ${err?.message || err}`);
    if (isOpen()) {
      tripCount += 1;
      log(`[tooling] ${name} circuit breaker tripped.`);
    }
  };
  const run = async (fn, { label, timeoutOverride } = {}) => {
    if (isOpen()) {
      const reason = lastFailure?.message || 'unknown failure';
      const err = new Error(`${name} tooling disabled (circuit breaker): ${reason}`);
      err.code = 'TOOLING_CIRCUIT_OPEN';
      err.detail = {
        provider: name,
        breakerThreshold,
        consecutiveFailures,
        tripCount,
        lastFailure
      };
      throw err;
    }
    let attempt = 0;
    while (attempt <= retries) {
      try {
        const result = await fn({ timeoutMs: timeoutOverride || timeoutMs });
        reset();
        return result;
      } catch (err) {
        attempt += 1;
        if (attempt > retries) {
          recordFailure(err, label);
          throw err;
        }
        const delay = attempt === 1 ? 250 : 1000;
        await sleep(delay);
      }
    }
    return null;
  };
  return {
    isOpen,
    getState: () => ({
      breakerThreshold,
      consecutiveFailures,
      tripCount,
      lastFailure
    }),
    run
  };
};

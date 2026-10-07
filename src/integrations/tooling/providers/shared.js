import { sleep } from '../../../shared/sleep.js';
import {
  mergeTypeEntries,
  normalizeTypeEntry,
  toTypeEntryCollection
} from '../../../shared/type-entry-utils.js';

export const uniqueTypes = (values) => {
  const out = [];
  const seen = new Set();
  for (const entry of toTypeEntryCollection(values)) {
    const normalizedEntry = normalizeTypeEntry(entry);
    const normalized = String(normalizedEntry?.type || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const DEFAULT_MAX_RETURN_CANDIDATES = 5;
const DEFAULT_MAX_PARAM_CANDIDATES = 5;

const mergeEntries = (existing, incoming, cap) => (
  mergeTypeEntries(existing, incoming, { cap }).list
);

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
      const incomingTypes = toTypeEntryCollection(types);
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
const FAILURE_RATE_WINDOW_MS = 60_000;

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
 *   noteHandshakeSuccess:(at?:number)=>void,
 *   noteHandshakeFailure:(detail?:object)=>void,
 *   noteRequestTimeout:(detail?:object)=>void,
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
  let startupFailures = 0;
  let handshakeFailures = 0;
  let protocolParseFailures = 0;
  let requestTimeouts = 0;
  let lastStartAt = 0;
  let lastHandshakeAt = 0;
  let lastFailureCategory = null;
  const protocolParseEvents = [];
  const requestTimeoutEvents = [];

  const refreshWindows = (now = Date.now()) => {
    trimWindow(starts, now, restartWindowMs);
    trimWindow(crashes, now, restartWindowMs);
    trimWindow(protocolParseEvents, now, FAILURE_RATE_WINDOW_MS);
    trimWindow(requestTimeoutEvents, now, FAILURE_RATE_WINDOW_MS);
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
      lastStartAt = now;
      starts.push(now);
      evaluateCrashLoop(now);
      return;
    }
    if (kind === 'protocol_parse_error') {
      protocolParseFailures += 1;
      protocolParseEvents.push(now);
      lastFailureCategory = {
        category: 'protocol_parse_failure',
        message: event?.message ? String(event.message) : 'protocol parse error',
        at: new Date(now).toISOString()
      };
      refreshWindows(now);
      return;
    }
    if (kind === 'exit' || kind === 'error') {
      crashes.push(now);
      if (lastStartAt > 0 && lastHandshakeAt < lastStartAt) {
        startupFailures += 1;
        lastFailureCategory = {
          category: 'startup_failure',
          message: event?.message ? String(event.message) : `${kind} before handshake`,
          at: new Date(now).toISOString()
        };
      }
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

  const noteHandshakeSuccess = (at = Date.now()) => {
    const now = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    lastHandshakeAt = now;
  };

  const noteHandshakeFailure = (detail = {}) => {
    const now = Number.isFinite(Number(detail?.at)) ? Number(detail.at) : Date.now();
    handshakeFailures += 1;
    lastFailureCategory = {
      category: 'handshake_failure',
      code: detail?.code || null,
      message: detail?.message ? String(detail.message) : 'handshake failure',
      at: new Date(now).toISOString()
    };
  };

  const noteRequestTimeout = (detail = {}) => {
    const now = Number.isFinite(Number(detail?.at)) ? Number(detail.at) : Date.now();
    requestTimeouts += 1;
    requestTimeoutEvents.push(now);
    refreshWindows(now);
    lastFailureCategory = {
      category: 'request_timeout',
      code: detail?.code || null,
      message: detail?.message ? String(detail.message) : 'request timeout',
      at: new Date(now).toISOString()
    };
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
      lastFdPressureLine: lastFdPressureLine || null,
      startupFailures,
      handshakeFailures,
      protocolParseFailures,
      protocolParseFailureRatePerMinute: Number((((protocolParseEvents.length * 60_000) / FAILURE_RATE_WINDOW_MS) || 0).toFixed(2)),
      requestTimeouts,
      requestTimeoutRatePerMinute: Number((((requestTimeoutEvents.length * 60_000) / FAILURE_RATE_WINDOW_MS) || 0).toFixed(2)),
      fdPressureDensityPerMinute: Number((((fdPressureEvents * 60_000) / Math.max(1, restartWindowMs)) || 0).toFixed(2)),
      lastFailureCategory
    };
  };

  return {
    onLifecycleEvent,
    noteStderrLine,
    noteHandshakeSuccess,
    noteHandshakeFailure,
    noteRequestTimeout,
    getState
  };
};

export const createToolingGuard = ({
  name,
  timeoutMs = 60000,
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

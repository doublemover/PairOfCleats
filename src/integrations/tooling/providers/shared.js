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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        await wait(delay);
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

const hasIterable = (value) => value != null && typeof value[Symbol.iterator] === 'function';

export const MAX_PARAM_CANDIDATES = 5;

export const createParamTypeMap = () => Object.create(null);

export const ensureParamTypeMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createParamTypeMap();
  if (Object.getPrototypeOf(value) === null) return value;
  const next = createParamTypeMap();
  for (const [name, entries] of Object.entries(value)) {
    if (!name) continue;
    next[name] = entries;
  }
  return next;
};

export const toTypeEntryCollection = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Array.from(value.values());
  if (hasIterable(value)) return Array.from(value);
  if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) return [value];
  return [];
};

export const normalizeTypeEntry = (entry) => {
  if (typeof entry === 'string') {
    const type = entry.trim();
    if (!type) return null;
    return {
      type,
      source: null,
      confidence: null
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.type) return null;
  const type = String(entry.type).trim();
  if (!type) return null;
  return {
    type,
    source: entry.source || null,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
  };
};

export const mergeTypeEntries = (existing, incoming, cap = MAX_PARAM_CANDIDATES) => {
  const map = new Map();
  const addEntry = (entry) => {
    const normalized = normalizeTypeEntry(entry);
    if (!normalized) return;
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
  for (const entry of toTypeEntryCollection(existing)) addEntry(entry);
  for (const entry of toTypeEntryCollection(incoming)) addEntry(entry);
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp) return typeCmp;
    const sourceCmp = String(a.source || '').localeCompare(String(b.source || ''));
    if (sourceCmp) return sourceCmp;
    const confA = Number.isFinite(a.confidence) ? a.confidence : 0;
    const confB = Number.isFinite(b.confidence) ? b.confidence : 0;
    return confB - confA;
  });
  if (cap && list.length > cap) {
    return { list: list.slice(0, cap), truncated: true };
  }
  return { list, truncated: false };
};

const normalizePayloadTextField = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
};

const maybeRecordObservation = (observations, issue) => {
  if (!Array.isArray(observations) || !issue) return;
  observations.push(issue);
};

/**
 * Normalize untrusted provider payload shape to deterministic, safe objects.
 * Invalid/unsupported shapes are dropped with explicit warning observations.
 *
 * @param {unknown} payload
 * @param {{
 *   observations?:Array<object>,
 *   providerId?:string,
 *   chunkUid?:string,
 *   maxParamCandidates?:number
 * }} [options]
 * @returns {object}
 */
export const normalizeProviderPayload = (payload, options = {}) => {
  const {
    observations = null,
    providerId = 'unknown',
    chunkUid = null,
    maxParamCandidates = MAX_PARAM_CANDIDATES
  } = options;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    if (payload != null) {
      maybeRecordObservation(observations, {
        level: 'warn',
        code: 'tooling_payload_shape_invalid',
        message: `tooling payload dropped for ${providerId}${chunkUid ? ` (${chunkUid})` : ''}: expected object`,
        context: { providerId, chunkUid, payloadType: typeof payload }
      });
    }
    return {};
  }

  const out = {};
  const returnType = normalizePayloadTextField(payload.returnType);
  if (returnType) out.returnType = returnType;
  const signature = normalizePayloadTextField(payload.signature);
  if (signature) out.signature = signature;

  if (payload.paramTypes == null) return out;
  if (typeof payload.paramTypes !== 'object' || Array.isArray(payload.paramTypes)) {
    maybeRecordObservation(observations, {
      level: 'warn',
      code: 'tooling_payload_paramtypes_invalid',
      message: `tooling paramTypes dropped for ${providerId}${chunkUid ? ` (${chunkUid})` : ''}: expected object`,
      context: { providerId, chunkUid, paramTypesType: typeof payload.paramTypes }
    });
    return out;
  }

  const paramTypes = createParamTypeMap();
  for (const [name, rawTypes] of Object.entries(payload.paramTypes)) {
    if (!name) continue;
    const incomingEntries = toTypeEntryCollection(rawTypes);
    if (!incomingEntries.length) continue;
    const { list, truncated } = mergeTypeEntries([], incomingEntries, maxParamCandidates);
    if (!list.length) continue;
    paramTypes[name] = list;
    if (truncated) {
      maybeRecordObservation(observations, {
        level: 'warn',
        code: 'tooling_param_types_truncated',
        message: `tooling param types truncated for ${providerId}${chunkUid ? ` (${chunkUid})` : ''}:${name}`,
        context: { providerId, chunkUid, param: name, cap: maxParamCandidates }
      });
    }
  }
  if (Object.keys(paramTypes).length) out.paramTypes = paramTypes;
  return out;
};

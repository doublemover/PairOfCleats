/**
 * Normalize dictionary tokenization config passed to workers.
 *
 * @param {unknown} raw
 * @returns {{segmentation:string,dpMaxTokenLength:number}}
 */
export const sanitizeDictConfig = (raw) => {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  return {
    segmentation: typeof cfg.segmentation === 'string' ? cfg.segmentation : 'auto',
    dpMaxTokenLength: Number.isFinite(Number(cfg.dpMaxTokenLength))
      ? Number(cfg.dpMaxTokenLength)
      : 32
  };
};

/**
 * Normalize optional tree-sitter worker payload.
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
export const sanitizeTreeSitterConfig = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const maxBytes = Number(raw.maxBytes);
  const maxLines = Number(raw.maxLines);
  const maxParseMs = Number(raw.maxParseMs);
  return {
    enabled: raw.enabled !== false,
    languages: raw.languages && typeof raw.languages === 'object' ? raw.languages : {},
    allowedLanguages: Array.isArray(raw.allowedLanguages)
      ? raw.allowedLanguages.filter((entry) => typeof entry === 'string')
      : undefined,
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : null,
    maxLines: Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : null,
    maxParseMs: Number.isFinite(maxParseMs) && maxParseMs > 0 ? Math.floor(maxParseMs) : null,
    byLanguage: raw.byLanguage && typeof raw.byLanguage === 'object' ? raw.byLanguage : {}
  };
};

function *iterateStringEntries(value) {
  if (!value) return;
  if (typeof value === 'string') {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') yield entry;
    }
    return;
  }
  if (value instanceof Set) {
    for (const entry of value.values()) {
      if (typeof entry === 'string') yield entry;
    }
    return;
  }
  if (typeof value[Symbol.iterator] === 'function') {
    for (const entry of value) {
      if (typeof entry === 'string') yield entry;
    }
  }
}

export const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return Array.from(iterateStringEntries(value));
  }
  // Fast path: avoid large array copies when the input is already string-only.
  for (let i = 0; i < value.length; i += 1) {
    if (typeof value[i] !== 'string') {
      return Array.from(iterateStringEntries(value));
    }
  }
  return value;
};

export const normalizeCodeDictLanguages = (value) => {
  if (!value) return [];
  return normalizeStringArray(value);
};

export const serializeCodeDictWordsByLanguage = (value) => {
  if (!value) return null;
  const entries = value instanceof Map
    ? value.entries()
    : Object.entries(value);
  const out = {};
  for (const [lang, words] of entries) {
    if (typeof lang !== 'string' || !lang) continue;
    const list = normalizeStringArray(words);
    if (list.length) out[lang] = list;
  }
  return Object.keys(out).length ? out : null;
};

const normalizeQuantizeVectors = (vectors) => {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    return { vectors: [], transferList: [], typedTempCount: 0 };
  }
  const normalizedVectors = new Array(vectors.length);
  const transferList = [];
  let typedTempCount = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    const vec = vectors[i];
    if (ArrayBuffer.isView(vec) && !(vec instanceof DataView)) {
      normalizedVectors[i] = vec;
      if (vec.byteOffset === 0 && vec.byteLength === vec.buffer.byteLength) {
        transferList.push(vec.buffer);
      }
      continue;
    }
    if (Array.isArray(vec)) {
      const typed = new Float32Array(vec.length);
      for (let j = 0; j < vec.length; j += 1) {
        const numeric = Number(vec[j]);
        typed[j] = Number.isFinite(numeric) ? numeric : 0;
      }
      normalizedVectors[i] = typed;
      transferList.push(typed.buffer);
      typedTempCount += 1;
      continue;
    }
    normalizedVectors[i] = vec;
  }
  return { vectors: normalizedVectors, transferList, typedTempCount };
};

/**
 * Build quantize worker payload while preserving caller-owned vector arrays.
 *
 * @param {unknown} payload
 * @returns {{payload:object,transferList:ArrayBuffer[],typedTempCount:number}}
 */
export const buildQuantizeRunPayload = (payload) => {
  const basePayload = payload && typeof payload === 'object' ? payload : {};
  const vectors = Array.isArray(basePayload.vectors) ? basePayload.vectors : null;
  if (!vectors) {
    return { payload: basePayload, transferList: [], typedTempCount: 0 };
  }
  const normalized = normalizeQuantizeVectors(vectors);
  const runPayload = normalized.typedTempCount > 0
    ? { ...basePayload, vectors: normalized.vectors }
    : basePayload;
  return {
    payload: runPayload,
    transferList: normalized.transferList,
    typedTempCount: normalized.typedTempCount
  };
};

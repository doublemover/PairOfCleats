const OMIT = Symbol('bundle.checksum.omit');

const normalizeScalarForJson = (value, { inArray = false } = {}) => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? null : OMIT;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('BigInt is not supported in bundle checksum payloads.');
  }
  return value;
};

const canonicalizeJsonLike = (value, { inArray = false, typedArraysBeforeToJSON = false } = {}) => {
  const scalar = normalizeScalarForJson(value, { inArray });
  if (scalar === OMIT) return OMIT;
  if (scalar === null || typeof scalar !== 'object') return scalar;

  // JSON streaming writes byte views as arrays, including Node Buffers. Keep
  // the default Buffer.toJSON shape for existing MessagePack checksums.
  const preferTypedArray = typedArraysBeforeToJSON && ArrayBuffer.isView(scalar) && !(scalar instanceof DataView);
  if (!preferTypedArray && typeof scalar.toJSON === 'function') {
    try {
      return canonicalizeJsonLike(scalar.toJSON(), { inArray, typedArraysBeforeToJSON });
    } catch {
      return canonicalizeJsonLike(null, { inArray, typedArraysBeforeToJSON });
    }
  }

  if (ArrayBuffer.isView(scalar) && !(scalar instanceof DataView)) {
    const out = new Array(scalar.length);
    for (let i = 0; i < scalar.length; i += 1) {
      const next = canonicalizeJsonLike(scalar[i], { inArray: true, typedArraysBeforeToJSON });
      out[i] = next === OMIT ? null : next;
    }
    return out;
  }

  if (Array.isArray(scalar)) {
    const out = new Array(scalar.length);
    for (let i = 0; i < scalar.length; i += 1) {
      const next = canonicalizeJsonLike(scalar[i], { inArray: true, typedArraysBeforeToJSON });
      out[i] = next === OMIT ? null : next;
    }
    return out;
  }

  const out = {};
  for (const key of Object.keys(scalar).sort()) {
    const next = canonicalizeJsonLike(scalar[key], { inArray: false, typedArraysBeforeToJSON });
    if (next === OMIT) continue;
    out[key] = next;
  }
  return out;
};

/**
 * Project an in-memory bundle payload to a JSON-equivalent canonical form used
 * for deterministic checksum verification across write/read paths.
 *
 * Invariants:
 * - Uses JSON omission/null semantics for unsupported values.
 * - Converts typed-array payloads to array form to match persisted JSON shape.
 * - Sorts object keys recursively for stable hashing independent of insertion.
 *
 * @param {unknown} payload
 * @param {{typedArraysBeforeToJSON?:boolean}} [options] Match JSON stream byte-view precedence when true.
 * @returns {unknown}
 */
export const canonicalizeBundlePayloadForChecksum = (payload, options = {}) => (
  canonicalizeJsonLike(payload, { inArray: false, typedArraysBeforeToJSON: options.typedArraysBeforeToJSON === true })
);

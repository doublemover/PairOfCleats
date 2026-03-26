const toPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : 0;
};

/**
 * Normalize dense-vector metadata envelopes that may be wrapped in `{fields}`.
 *
 * @param {any} metaRaw
 * @returns {Record<string, any>|null}
 */
export const normalizeDenseVectorMeta = (metaRaw) => {
  const raw = metaRaw?.fields && typeof metaRaw.fields === 'object'
    ? metaRaw.fields
    : metaRaw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
};

export const resolveDenseVectorCountFromBuffer = (meta, bufferLength) => {
  const dims = toPositiveInteger(meta?.dims);
  if (!dims) {
    return { dims: 0, count: 0, requiredBytes: 0 };
  }
  const countFromMeta = toPositiveInteger(meta?.count);
  const countFromBuffer = Math.floor(Math.max(0, bufferLength) / dims);
  const count = countFromMeta || countFromBuffer;
  return {
    dims,
    count,
    requiredBytes: dims * count
  };
};

/**
 * Check whether a dense-vector payload has usable vectors or binary buffer data.
 *
 * @param {any} denseVec
 * @returns {boolean}
 */
export const isDenseVectorPayloadAvailable = (denseVec) => {
  if (Array.isArray(denseVec?.vectors) && denseVec.vectors.length > 0) return true;
  const buffer = denseVec?.buffer;
  if (!ArrayBuffer.isView(buffer) || buffer.BYTES_PER_ELEMENT !== 1) return false;
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(denseVec, buffer.length);
  return !!(dims && count && buffer.length >= requiredBytes);
};

/**
 * Materialize dense-vector rows from either `vectors[]` payloads or binary buffers.
 *
 * @param {any} denseVec
 * @returns {Array<Uint8Array|number[]>}
 */
export const materializeDenseVectorRows = (denseVec) => {
  if (Array.isArray(denseVec?.vectors)) return denseVec.vectors;
  const buffer = denseVec?.buffer;
  if (!ArrayBuffer.isView(buffer) || buffer.BYTES_PER_ELEMENT !== 1) return [];
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(denseVec, buffer.length);
  if (!dims || !count || buffer.length < requiredBytes) return [];
  const rows = new Array(count);
  for (let row = 0; row < count; row += 1) {
    const start = row * dims;
    rows[row] = buffer.subarray(start, start + dims);
  }
  return rows;
};

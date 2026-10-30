import { decodeDenseVectorValidity } from './dense-vector-validity.js';
import { assertQuantizedEmbeddingRow, resolveDenseQuantizationSpec } from './embedding-quantization-spec.js';
const toPositiveInteger = (value) => {
  return Number.isSafeInteger(value) && value > 0
    ? value
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
  if (!dims || !Number.isSafeInteger(bufferLength) || bufferLength < 0) {
    return { dims: 0, count: 0, requiredBytes: 0 };
  }
  const count = Object.hasOwn(meta || {}, 'count') ? meta.count : bufferLength / dims;
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(dims * count) || dims * count !== bufferLength
    || Object.hasOwn(meta || {}, 'totalRecords') && meta.totalRecords !== count
    || Object.hasOwn(meta || {}, 'bytes') && meta.bytes !== bufferLength) {
    return { dims: 0, count: 0, requiredBytes: 0 };
  }
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
  const spec = resolveDenseQuantizationSpec(denseVec);
  if (Array.isArray(denseVec?.vectors)) return materializeDenseVectorRows(denseVec).some(row => row?.length > 0);
  const buffer = denseVec?.buffer;
  if (!(buffer instanceof Uint8Array)) return false;
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(denseVec, buffer.length);
  if (!dims || !count || buffer.length !== requiredBytes) return false;
  const bits = decodeDenseVectorValidity({ ...denseVec, count });
  if (bits && !denseVec.validity.validCount) return false;
  if (spec.levels < 256) {
    for (let row = 0; row < count; row++) {
      if (bits && !(bits[row >> 3] & (1 << (row & 7)))) continue;
      assertQuantizedEmbeddingRow(buffer.subarray(row * dims, (row + 1) * dims), { spec, dims, allowEmpty: false });
    }
  }
  return true;
};

/**
 * Materialize dense-vector rows from either `vectors[]` payloads or binary buffers.
 *
 * @param {any} denseVec
 * @returns {Array<Uint8Array|number[]>}
 */
export const materializeDenseVectorRows = (denseVec) => {
  const spec = resolveDenseQuantizationSpec(denseVec);
  if (Array.isArray(denseVec?.vectors)) {
    const count = Object.hasOwn(denseVec, 'count') ? denseVec.count
      : Object.hasOwn(denseVec, 'totalRecords') ? denseVec.totalRecords : denseVec.vectors.length;
    const dims = Object.hasOwn(denseVec, 'dims') ? denseVec.dims : denseVec.vectors.find(row => row?.length)?.length ?? null;
    if (!Number.isSafeInteger(count) || count < 0 || count !== denseVec.vectors.length
      || Object.hasOwn(denseVec, 'totalRecords') && denseVec.totalRecords !== count
      || Object.hasOwn(denseVec, 'dims') && !toPositiveInteger(dims) && !(count === 0 && dims === 0)
      || dims != null && !toPositiveInteger(dims) && !(count === 0 && dims === 0)) throw Object.assign(new Error('Dense vector row geometry is invalid.'), { code: 'ERR_DENSE_VECTOR_SHAPE' });
    const bits = decodeDenseVectorValidity({ ...denseVec, count });
    const present = id => bits ? Boolean(bits[id >> 3] & (1 << (id & 7))) : Boolean(denseVec.vectors[id]?.length);
    for (const [id, vector] of denseVec.vectors.entries()) if (present(id)) {
      assertQuantizedEmbeddingRow(vector, { spec, dims, allowEmpty: false });
    }
    return denseVec.validity && denseVec.validity.validCount !== denseVec.vectors.length
      ? denseVec.vectors.map((vector, id) => present(id) ? vector : new Uint8Array(0))
      : denseVec.vectors;
  }
  const buffer = denseVec?.buffer;
  if (!(buffer instanceof Uint8Array)) return [];
  const { dims, count, requiredBytes } = resolveDenseVectorCountFromBuffer(denseVec, buffer.length);
  if (!dims || !count || buffer.length !== requiredBytes) return [];
  const bits = decodeDenseVectorValidity({ ...denseVec, count });
  const rows = new Array(count);
  for (let row = 0; row < count; row += 1) {
    const start = row * dims;
    rows[row] = !bits || bits[row >> 3] & (1 << (row & 7)) ? buffer.subarray(start, start + dims) : new Uint8Array(0);
    assertQuantizedEmbeddingRow(rows[row], { spec, dims });
  }
  return rows;
};

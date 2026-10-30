export const DENSE_VECTOR_VALIDITY_VERSION = 1;
const decoded = new WeakMap();

export const buildDenseVectorValidity = vectors => {
  const count = vectors.length;
  const bits = Buffer.alloc(Math.ceil(count / 8));
  let validCount = 0;
  for (let id = 0; id < count; id++) {
    if (!vectors[id]?.length) continue;
    bits[id >> 3] |= 1 << (id & 7);
    validCount += 1;
  }
  return { version: DENSE_VECTOR_VALIDITY_VERSION, encoding: 'bitset-base64', count, validCount, bits: bits.toString('base64') };
};

const admitDenseVectorValidity = payload => {
  const validity = payload?.validity;
  if (!validity) return null;
  const cached = decoded.get(validity);
  const { version, encoding, count: rowLimit, validCount, bits: encodedBits } = validity;
  const invalid = () => { throw Object.assign(new Error('Dense vector validity metadata is invalid; rebuild embeddings.'), { code: 'ERR_DENSE_VECTOR_VALIDITY' }); };
  const rowCount = payload.count ?? payload.totalRecords ?? payload.vectors?.length;
  if (rowCount != null && rowCount !== rowLimit) invalid();
  if (cached && cached.version === version && cached.encoding === encoding && cached.count === rowLimit
    && cached.validCount === validCount && cached.encodedBits === encodedBits) return cached;
  if (version !== DENSE_VECTOR_VALIDITY_VERSION || encoding !== 'bitset-base64'
    || !Number.isSafeInteger(rowLimit) || rowLimit < 0
    || !Number.isSafeInteger(validCount) || validCount < 0 || validCount > rowLimit
    || typeof encodedBits !== 'string') invalid();
  const bits = Buffer.from(encodedBits, 'base64');
  if (bits.length !== Math.ceil(rowLimit / 8) || bits.toString('base64') !== encodedBits) invalid();
  let count = 0;
  for (let id = 0; id < bits.length * 8; id++) {
    if (!(bits[id >> 3] & (1 << (id & 7)))) continue;
    if (id >= rowLimit) invalid();
    count += 1;
  }
  if (count !== validCount) invalid();
  const admission = { version, encoding, count: rowLimit, validCount, encodedBits, bits };
  decoded.set(validity, admission);
  return admission;
};

export const decodeDenseVectorValidity = payload => {
  const bits = admitDenseVectorValidity(payload)?.bits;
  return bits ? Buffer.from(bits) : null;
};

/** Capture one validated mask before ingestion callbacks/awaits. Mutable public
 * metadata is re-admitted on the next operation, never serialized per row.
 */
export const createDenseVectorRowPresence = payload => {
  const admission = admitDenseVectorValidity(payload);
  const vectors = payload?.vectors;
  const count = admission?.count ?? (Array.isArray(vectors) ? vectors.length : null);
  const bits = admission ? Buffer.from(admission.bits)
    : Array.isArray(vectors) ? Buffer.alloc(Math.ceil(count / 8)) : null;
  if (!admission && bits) for (let id = 0; id < count; id++) {
    if (vectors[id]?.length) bits[id >> 3] |= 1 << (id & 7);
  }
  return id => Number.isSafeInteger(id) && id >= 0 && (bits
    ? id < count && Boolean(bits[id >> 3] & (1 << (id & 7)))
    : true);
};

export const isDenseVectorRowPresent = (payload, id) => {
  if (!Number.isSafeInteger(id) || id < 0) return false;
  const admission = admitDenseVectorValidity(payload);
  return admission ? id < admission.count && Boolean(admission.bits[id >> 3] & (1 << (id & 7)))
    : Array.isArray(payload?.vectors) ? Boolean(payload.vectors[id]?.length) : true;
};

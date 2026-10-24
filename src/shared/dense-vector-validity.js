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

export const decodeDenseVectorValidity = payload => {
  const validity = payload?.validity;
  if (!validity) return null;
  const cached = decoded.get(validity);
  const signature = JSON.stringify(validity);
  const invalid = () => { throw Object.assign(new Error('Dense vector validity metadata is invalid; rebuild embeddings.'), { code: 'ERR_DENSE_VECTOR_VALIDITY' }); };
  const rowCount = payload.count ?? payload.totalRecords ?? payload.vectors?.length;
  if (rowCount != null && rowCount !== validity.count) invalid();
  if (cached?.signature === signature) return cached.bits;
  if (validity.version !== DENSE_VECTOR_VALIDITY_VERSION || validity.encoding !== 'bitset-base64'
    || !Number.isSafeInteger(validity.count) || validity.count < 0
    || !Number.isSafeInteger(validity.validCount) || validity.validCount < 0 || validity.validCount > validity.count
    || typeof validity.bits !== 'string') invalid();
  const bits = Buffer.from(validity.bits, 'base64');
  if (bits.length !== Math.ceil(validity.count / 8) || bits.toString('base64') !== validity.bits) invalid();
  let count = 0;
  for (let id = 0; id < bits.length * 8; id++) {
    if (!(bits[id >> 3] & (1 << (id & 7)))) continue;
    if (id >= validity.count) invalid();
    count += 1;
  }
  if (count !== validity.validCount) invalid();
  decoded.set(validity, { signature, bits });
  return bits;
};

export const isDenseVectorRowPresent = (payload, id) => {
  if (!Number.isSafeInteger(id) || id < 0) return false;
  const bits = decodeDenseVectorValidity(payload);
  return bits ? id < payload.validity.count && Boolean(bits[id >> 3] & (1 << (id & 7)))
    : Array.isArray(payload?.vectors) ? Boolean(payload.vectors[id]?.length) : true;
};

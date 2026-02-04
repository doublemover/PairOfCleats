const BLOOM_SCHEMA_VERSION = '1.0.0';
const DEFAULT_FALSE_POSITIVE_RATE = 0.01;
const MIN_BLOOM_BITS = 1024;

const fnv1a32 = (value, seed) => {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const hashPair = (value) => {
  const text = value == null ? '' : String(value);
  const h1 = fnv1a32(text, 2166136261);
  const h2 = fnv1a32(text, 16777619) || 1;
  return { h1, h2 };
};

const resolveBloomParams = ({ expectedEntries, falsePositiveRate, minBits } = {}) => {
  const entries = Number.isFinite(Number(expectedEntries)) ? Math.max(1, Math.floor(Number(expectedEntries))) : 1;
  const fpRate = Number.isFinite(Number(falsePositiveRate))
    ? Math.min(0.25, Math.max(0.0001, Number(falsePositiveRate)))
    : DEFAULT_FALSE_POSITIVE_RATE;
  const minSize = Number.isFinite(Number(minBits)) ? Math.max(128, Math.floor(Number(minBits))) : MIN_BLOOM_BITS;
  const ln2 = Math.log(2);
  const bits = Math.max(minSize, Math.ceil(-(entries * Math.log(fpRate)) / (ln2 * ln2)));
  const hashes = Math.max(1, Math.round((bits / entries) * ln2));
  return { bits, hashes };
};

/**
 * Simple Bloom filter using fnv1a32 double-hashing.
 */
export class BloomFilter {
  constructor({ bits, hashes, bytes } = {}) {
    const resolvedBits = Number.isFinite(Number(bits)) ? Math.max(1, Math.floor(Number(bits))) : MIN_BLOOM_BITS;
    const resolvedHashes = Number.isFinite(Number(hashes)) ? Math.max(1, Math.floor(Number(hashes))) : 3;
    this.bits = resolvedBits;
    this.hashes = resolvedHashes;
    const byteLength = Math.ceil(resolvedBits / 8);
    if (bytes instanceof Uint8Array) {
      this.bytes = bytes.length === byteLength ? bytes : bytes.slice(0, byteLength);
    } else {
      this.bytes = new Uint8Array(byteLength);
    }
    this.count = 0;
  }

  add(value) {
    const { h1, h2 } = hashPair(value);
    for (let i = 0; i < this.hashes; i += 1) {
      const idx = (h1 + i * h2) % this.bits;
      this.bytes[idx >>> 3] |= 1 << (idx & 7);
    }
    this.count += 1;
  }

  has(value) {
    const { h1, h2 } = hashPair(value);
    for (let i = 0; i < this.hashes; i += 1) {
      const idx = (h1 + i * h2) % this.bits;
      if ((this.bytes[idx >>> 3] & (1 << (idx & 7))) === 0) return false;
    }
    return true;
  }
}

/**
 * Create a Bloom filter with size derived from expected entries and FP rate.
 * @param {{expectedEntries?:number,falsePositiveRate?:number,minBits?:number}} [options]
 * @returns {BloomFilter}
 */
export const createBloomFilter = (options = {}) => {
  const { bits, hashes } = resolveBloomParams(options);
  return new BloomFilter({ bits, hashes });
};

/**
 * Encode a Bloom filter as a JSON-safe payload.
 * @param {BloomFilter} filter
 * @returns {object|null}
 */
export const encodeBloomFilter = (filter) => {
  if (!filter) return null;
  return {
    schemaVersion: BLOOM_SCHEMA_VERSION,
    algorithm: 'fnv1a32',
    bits: filter.bits,
    hashes: filter.hashes,
    count: filter.count,
    bytes: Buffer.from(filter.bytes).toString('base64')
  };
};

/**
 * Decode a Bloom filter payload back into a BloomFilter instance.
 * @param {object|null} input
 * @returns {BloomFilter|null}
 */
export const decodeBloomFilter = (input) => {
  if (!input || typeof input !== 'object') return null;
  const bits = Number(input.bits);
  const hashes = Number(input.hashes);
  if (!Number.isFinite(bits) || !Number.isFinite(hashes)) return null;
  const bytes = typeof input.bytes === 'string' ? Buffer.from(input.bytes, 'base64') : null;
  const filter = new BloomFilter({
    bits,
    hashes,
    bytes: bytes ? new Uint8Array(bytes) : null
  });
  if (Number.isFinite(Number(input.count))) {
    filter.count = Math.max(0, Math.floor(Number(input.count)));
  }
  return filter;
};

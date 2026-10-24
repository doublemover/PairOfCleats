/**
 * Simple MinHash implementation for approximate similarity.
 */
export const MINHASH_HASH_IDENTITY = 'fnv1a32-utf16le-xor-fmix32-v2';

export const assertMinhashHashIdentity = (identity) => {
  if (identity !== MINHASH_HASH_IDENTITY) {
    throw Object.assign(new Error('MinHash hash identity is missing or incompatible; rebuild the index.'),
      { code: 'ERR_ARTIFACT_INVALID', rebuildRequired: true });
  }
  return identity;
};

// Austin Appleby's public-domain MurmurHash3 fmix32 avalanche is a bijection
// over u32 values. XOR with distinct mixed seeds supplies distinct orderings.
// https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
const mix32 = (input) => {
  let value = input >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
};

// FNV-1a on explicit UTF-16LE bytes preserves every JS code unit, including
// unpaired surrogates, while reading each character only once across all seeds.
// FNV is CC0: https://www.isthe.com/chongo/tech/comp/fnv/
const hashToken = (token) => {
  let value = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    const unit = token.charCodeAt(index);
    value = Math.imul(value ^ (unit & 255), 0x01000193);
    value = Math.imul(value ^ ((unit >>> 8) & 255), 0x01000193);
  }
  return value >>> 0;
};

export class SimpleMinHash {
  #seedMixes;
  /**
   * @param {number} [numHashes]
   */
  constructor(numHashes = 128) {
    this.numHashes = numHashes;
    this.seeds = Array.from({ length: numHashes }, (_, i) => i + 1);
    this.hashValues = Array(numHashes).fill(Infinity);
    this.#seedMixes = this.seeds.map(mix32);
  }

  get hashIdentity() {
    if (this.hash !== DEFAULT_TOKEN_HASH || this.seeds.length !== this.numHashes) return null;
    for (let index = 0; index < this.numHashes; index += 1) {
      if (this.seeds[index] !== index + 1) return null;
    }
    return MINHASH_HASH_IDENTITY;
  }

  reset() {
    this.hashValues.fill(Infinity);
  }

  /**
   * Hash a token with a given seed.
   * @param {string} str
   * @param {number} seed
   * @returns {number}
   */
  hash(str, seed) {
    return mix32(hashToken(str) ^ mix32(seed));
  }

  /**
   * Update signature with a token.
   * @param {string} token
   */
  update(token) {
    // Cache token work, while preserving custom hash callbacks and public seeds.
    const cacheable = typeof token === 'string' && this.hash === DEFAULT_TOKEN_HASH;
    const tokenHash = cacheable && this.seeds.length ? hashToken(token) : null;
    this.seeds.forEach((seed, i) => {
      const hv = cacheable
        ? mix32(tokenHash ^ (seed === i + 1 && i < this.#seedMixes.length ? this.#seedMixes[i] : mix32(seed)))
        : this.hash(token, seed);
      if (hv < this.hashValues[i]) {
        this.hashValues[i] = hv;
      }
    });
  }
}

const DEFAULT_TOKEN_HASH = SimpleMinHash.prototype.hash;

const clampPositiveInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.max(0, Math.floor(parsed));
};

/**
 * Resolve sampled/minified minhash plan for oversized corpora.
 *
 * Large indexes previously hard-skipped minhash signatures. This plan keeps
 * signatures available while reducing per-doc signature density.
 *
 * @param {{
 *   totalDocs?: number,
 *   maxDocs?: number,
 *   signatureLength?: number,
 *   minSignatureLength?: number,
 *   maxStride?: number
 * }} [input]
 * @returns {{
 *   mode:'sampled-minified',
 *   totalDocs:number,
 *   maxDocs:number,
 *   signatureLength:number,
 *   sampledSignatureLength:number,
 *   hashStride:number,
 *   density:number
 * }|null}
 */
export const resolveMinhashSampledPlan = (input = {}) => {
  const totalDocs = clampPositiveInt(input.totalDocs, 0);
  const maxDocs = clampPositiveInt(input.maxDocs, 0);
  const signatureLength = clampPositiveInt(input.signatureLength, 0);
  if (!totalDocs || !maxDocs || !signatureLength) return null;
  if (totalDocs <= maxDocs) return null;
  const defaultMinSignatureLength = Math.min(16, signatureLength);
  const minSignatureLength = Math.max(
    1,
    Math.min(
      signatureLength,
      clampPositiveInt(input.minSignatureLength, defaultMinSignatureLength || 1)
    )
  );
  const maxStrideByLength = Math.max(1, Math.floor(signatureLength / minSignatureLength));
  const maxStride = Math.max(
    1,
    Math.min(maxStrideByLength, clampPositiveInt(input.maxStride, maxStrideByLength))
  );
  const oversubscriptionRatio = Math.max(1, Math.floor(totalDocs / maxDocs));
  const hashStride = Math.max(1, Math.min(maxStride, oversubscriptionRatio));
  const sampledSignatureLength = Math.max(
    minSignatureLength,
    Math.min(signatureLength, Math.ceil(signatureLength / hashStride))
  );
  const density = signatureLength > 0
    ? Number((sampledSignatureLength / signatureLength).toFixed(4))
    : 1;
  return {
    mode: 'sampled-minified',
    totalDocs,
    maxDocs,
    signatureLength,
    sampledSignatureLength,
    hashStride,
    density
  };
};

const normalizeMinhashValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return (Math.floor(parsed) >>> 0);
};

/**
 * Minify a minhash signature using a sampled plan.
 *
 * @param {unknown} signature
 * @param {{
 *   sampledSignatureLength?: number,
 *   hashStride?: number
 * }|null} [plan]
 * @returns {number[]}
 */
export const minifyMinhashSignature = (signature, plan = null) => {
  if (!Array.isArray(signature) || !signature.length) return [];
  const hashStride = Math.max(1, clampPositiveInt(plan?.hashStride, 1));
  const targetLength = Math.max(
    1,
    Math.min(signature.length, clampPositiveInt(plan?.sampledSignatureLength, signature.length))
  );
  const out = new Array(targetLength);
  let offset = 0;
  for (let i = 0; i < signature.length && offset < targetLength; i += hashStride) {
    out[offset] = normalizeMinhashValue(signature[i]);
    offset += 1;
  }
  while (offset < targetLength) {
    out[offset] = 0;
    offset += 1;
  }
  return out;
};

/** Validate the indices represented by a sampled signature without guessing from its width. */
export const normalizeMinhashSampling = (input, expectedSignatureLength = null) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.mode !== 'sampled-minified') return null;
  const { signatureLength, sampledSignatureLength, hashStride } = input;
  if (!Number.isSafeInteger(signatureLength) || signatureLength <= 0
    || !Number.isSafeInteger(sampledSignatureLength) || sampledSignatureLength <= 0
    || !Number.isSafeInteger(hashStride) || hashStride <= 0) return null;
  if (hashStride > signatureLength || sampledSignatureLength !== Math.ceil(signatureLength / hashStride)) return null;
  if (expectedSignatureLength != null && signatureLength !== expectedSignatureLength) return null;
  const out = { mode: input.mode, signatureLength, sampledSignatureLength, hashStride };
  for (const field of ['maxDocs', 'totalDocs']) {
    if (Number.isSafeInteger(input[field]) && input[field] >= 0) out[field] = input[field];
  }
  if (Number.isFinite(input.density) && input.density > 0 && input.density <= 1) out.density = input.density;
  return out;
};

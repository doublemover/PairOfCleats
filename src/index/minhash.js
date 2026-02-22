/**
 * Simple MinHash implementation for approximate similarity.
 */
export class SimpleMinHash {
  /**
   * @param {number} [numHashes]
   */
  constructor(numHashes = 128) {
    this.numHashes = numHashes;
    this.seeds = Array.from({ length: numHashes }, (_, i) => i + 1);
    this.hashValues = Array(numHashes).fill(Infinity);
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
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  /**
   * Update signature with a token.
   * @param {string} token
   */
  update(token) {
    this.seeds.forEach((seed, i) => {
      const hv = this.hash(token, seed);
      if (hv < this.hashValues[i]) {
        this.hashValues[i] = hv;
      }
    });
  }
}

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

const isVectorLike = (value) => (
  Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
);

const toNumberOrZero = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * Normalize a query embedding to the expected dimension count.
 * Policy: clip extra dimensions, zero-pad missing trailing dimensions.
 * @param {ArrayLike<number>} embedding
 * @param {number|null|undefined} expectedDims
 * @returns {{embedding:number[]|null,queryDims:number,expectedDims:number|null,adjusted:boolean}}
 */
export function normalizeEmbeddingDims(embedding, expectedDims) {
  if (!isVectorLike(embedding)) {
    return { embedding: null, queryDims: 0, expectedDims: null, adjusted: false };
  }
  const queryDims = Number(embedding.length) || 0;
  if (!queryDims) {
    return { embedding: null, queryDims: 0, expectedDims: null, adjusted: false };
  }
  const resolvedExpected = Number.isFinite(Number(expectedDims))
    ? Math.max(1, Math.floor(Number(expectedDims)))
    : null;
  const base = Array.isArray(embedding) ? embedding : Array.from(embedding);
  if (!resolvedExpected || resolvedExpected === queryDims) {
    return {
      embedding: base,
      queryDims,
      expectedDims: resolvedExpected,
      adjusted: false
    };
  }
  if (queryDims > resolvedExpected) {
    return {
      embedding: base.slice(0, resolvedExpected),
      queryDims,
      expectedDims: resolvedExpected,
      adjusted: true
    };
  }
  const padded = new Array(resolvedExpected);
  for (let i = 0; i < resolvedExpected; i += 1) {
    padded[i] = i < queryDims ? toNumberOrZero(base[i]) : 0;
  }
  return {
    embedding: padded,
    queryDims,
    expectedDims: resolvedExpected,
    adjusted: true
  };
}

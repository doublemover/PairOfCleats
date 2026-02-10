import { SimpleMinHash } from '../index/minhash.js';
import { createTopKReducer } from './pipeline/topk.js';
import { bitmapHas, bitmapToArray, getBitmapSize } from './bitmap.js';
import { normalizeEmbeddingDims } from './ann/dims.js';

/**
 * Legacy BM25-like scoring using chunk metadata fields directly.
 * @param {object} idx
 * @param {string[]} tokens
 * @param {number} topN
 * @param {Set<number>|object|null} [allowedIdx]
 * @returns {Array<{idx:number,score:number}>}
 */
export function rankBM25Legacy(idx, tokens, topN, allowedIdx = null) {
  if (allowedIdx && getBitmapSize(allowedIdx) === 0) return [];
  const scores = new Map();
  const ids = allowedIdx ? bitmapToArray(allowedIdx) : idx.chunkMeta.map((_, i) => i);
  ids.forEach((i) => {
    const chunk = idx.chunkMeta[i];
    if (!chunk) return;
    let score = 0;
    tokens.forEach((tok) => {
      if (chunk.tokens && chunk.tokens.includes(tok)) score += 1 * (chunk.weight || 1);
      if (chunk.ngrams && chunk.ngrams.includes(tok)) score += 2 * (chunk.weight || 1);
      if (chunk.headline && chunk.headline.includes(tok)) score += 3 * (chunk.weight || 1);
    });
    scores.set(i, score);
  });
  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => ({ idx: entry.id, score: entry.score })
  });
  let order = 0;
  for (const [docId, score] of scores.entries()) {
    if (score > 0) {
      reducer.pushRaw(score, docId, order);
      order += 1;
    }
  }
  return reducer.finish({ limit: topN });
}

/**
 * Build or normalize the token index view for BM25 scoring.
 * @param {object} idx
 * @returns {object|null}
 */
export function getTokenIndex(idx) {
  const tokenIndex = idx.tokenIndex;
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) return null;
  if (!tokenIndex.vocabIndex) {
    tokenIndex.vocabIndex = new Map(tokenIndex.vocab.map((t, i) => [t, i]));
  }
  if (!Array.isArray(tokenIndex.docLengths)) tokenIndex.docLengths = [];
  if (!tokenIndex.totalDocs) tokenIndex.totalDocs = tokenIndex.docLengths.length;
  if (!tokenIndex.avgDocLen) {
    const total = tokenIndex.docLengths.reduce((sum, len) => sum + len, 0);
    tokenIndex.avgDocLen = tokenIndex.docLengths.length ? total / tokenIndex.docLengths.length : 0;
  }
  return tokenIndex;
}

/**
 * Rank documents using BM25 over the token postings index.
 * Falls back to legacy scoring when the token index is missing.
 * @param {object} params
 * @param {object} params.idx
 * @param {string[]} params.tokens
 * @param {number} params.topN
 * @param {object|null} [params.tokenIndexOverride]
 * @param {Set<number>|object|null} [params.allowedIdx]
 * @param {number} [params.k1]
 * @param {number} [params.b]
 * @returns {Array<{idx:number,score:number}>}
 */
export function rankBM25({
  idx,
  tokens,
  topN,
  tokenIndexOverride = null,
  allowedIdx = null,
  k1 = 1.2,
  b = 0.75
}) {
  const tokenIndex = tokenIndexOverride || getTokenIndex(idx);
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) {
    return rankBM25Legacy(idx, tokens, topN, allowedIdx);
  }
  if (allowedIdx && getBitmapSize(allowedIdx) === 0) return [];

  const scores = new Map();
  const docLengths = tokenIndex.docLengths;
  const avgDocLen = tokenIndex.avgDocLen || 1;
  const totalDocs = tokenIndex.totalDocs || idx.chunkMeta.length || 1;

  const qtf = new Map();
  tokens.forEach((tok) => qtf.set(tok, (qtf.get(tok) || 0) + 1));

  for (const [tok, qCount] of qtf.entries()) {
    const tokIdx = tokenIndex.vocabIndex.get(tok);
    if (tokIdx === undefined) continue;
    const posting = tokenIndex.postings[tokIdx] || [];
    const df = posting.length;
    if (!df) continue;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    for (const [docId, tf] of posting) {
      if (allowedIdx && !bitmapHas(allowedIdx, docId)) continue;
      const dl = docLengths[docId] || 0;
      const denom = tf + k1 * (1 - b + b * (dl / avgDocLen));
      const score = idf * ((tf * (k1 + 1)) / denom) * qCount;
      scores.set(docId, (scores.get(docId) || 0) + score);
    }
  }

  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => ({ idx: entry.id, score: entry.score })
  });
  let order = 0;
  for (const [docId, score] of scores.entries()) {
    const weight = idx.chunkMeta[docId]?.weight || 1;
    const weightedScore = score * weight;
    if (weightedScore > 0) {
      reducer.pushRaw(weightedScore, docId, order);
      order += 1;
    }
  }
  return reducer.finish({ limit: topN });
}

/**
 * Rank documents using BM25 across fielded postings.
 * @param {object} params
 * @param {object} params.idx
 * @param {string[]} params.tokens
 * @param {number} params.topN
 * @param {object} params.fieldWeights
 * @param {Set<number>|object|null} [params.allowedIdx]
 * @param {number} [params.k1]
 * @param {number} [params.b]
 * @returns {Array<{idx:number,score:number}>}
 */
export function rankBM25Fields({
  idx,
  tokens,
  topN,
  fieldWeights,
  allowedIdx = null,
  k1 = 1.2,
  b = 0.75
}) {
  const fields = idx.fieldPostings?.fields;
  if (!fields || !fieldWeights || !tokens.length) {
    return rankBM25({ idx, tokens, topN, k1, b, allowedIdx });
  }
  if (allowedIdx && getBitmapSize(allowedIdx) === 0) return [];

  // NOTE:
  // The build pipeline may intentionally omit a dedicated "body" field postings map
  // because the unfielded token index already covers the body and maintaining both
  // roughly doubles memory. When that happens we treat "body" as an alias of the
  // unfielded token index at query time.
  const tokenIndex = getTokenIndex(idx);

  const qtf = new Map();
  tokens.forEach((tok) => qtf.set(tok, (qtf.get(tok) || 0) + 1));

  const scores = new Map();
  for (const [field, weight] of Object.entries(fieldWeights)) {
    const fieldWeight = Number(weight);
    if (!Number.isFinite(fieldWeight) || fieldWeight <= 0) continue;

    let index = fields[field];

    // Fallback: use unfielded index for body weighting when the field index is
    // absent or effectively empty.
    if (field === 'body' && tokenIndex) {
      const emptyBody = !index
        || !Array.isArray(index.vocab) || index.vocab.length === 0
        || !Array.isArray(index.postings) || index.postings.length === 0;
      if (emptyBody) index = tokenIndex;
    }

    if (!index || !index.vocab || !index.postings) continue;
    if (!index.vocabIndex) {
      index.vocabIndex = new Map(index.vocab.map((t, i) => [t, i]));
    }
    const docLengths = Array.isArray(index.docLengths) ? index.docLengths : [];
    const avgDocLen = Number.isFinite(index.avgDocLen) ? index.avgDocLen : 1;
    const totalDocs = Number.isFinite(index.totalDocs) ? index.totalDocs : docLengths.length;
    if (!totalDocs) continue;

    for (const [tok, qCount] of qtf.entries()) {
      const tokIdx = index.vocabIndex.get(tok);
      if (tokIdx === undefined) continue;
      const posting = index.postings[tokIdx] || [];
      const df = posting.length;
      if (!df) continue;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

      for (const [docId, tf] of posting) {
        if (allowedIdx && !bitmapHas(allowedIdx, docId)) continue;
        const dl = docLengths[docId] || 0;
        const denom = tf + k1 * (1 - b + b * (dl / avgDocLen));
        const score = idf * ((tf * (k1 + 1)) / denom) * qCount * fieldWeight;
        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }
  }

  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => ({ idx: entry.id, score: entry.score })
  });
  let order = 0;
  for (const [docId, score] of scores.entries()) {
    const weight = idx.chunkMeta[docId]?.weight || 1;
    const weightedScore = score * weight;
    if (weightedScore > 0) {
      reducer.pushRaw(weightedScore, docId, order);
      order += 1;
    }
  }
  return reducer.finish({ limit: topN });
}

function minhashSigForTokens(tokens) {
  const mh = new SimpleMinHash();
  tokens.forEach((t) => mh.update(t));
  return mh.hashValues;
}

function jaccard(sigA, sigB) {
  let match = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) match++;
  return match / sigA.length;
}

/**
 * Rank documents using MinHash signatures.
 * @param {object} idx
 * @param {string[]} tokens
 * @param {number} topN
 * @returns {Array<{idx:number,sim:number}>}
 */
export function rankMinhash(idx, tokens, topN, candidateSet = null) {
  if (!idx.minhash?.signatures?.length) return [];
  if (!Array.isArray(tokens) || !tokens.length) return [];
  const qSig = minhashSigForTokens(tokens);
  const ids = candidateSet ? bitmapToArray(candidateSet) : idx.minhash.signatures.map((_, i) => i);
  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => ({ idx: entry.id, sim: entry.score })
  });
  let order = 0;
  for (const id of ids) {
    const sig = idx.minhash.signatures[id];
    if (!sig) continue;
    reducer.pushRaw(jaccard(qSig, sig), id, order);
    order += 1;
  }
  return reducer.finish({ limit: topN });
}

/**
 * Rank documents using dense vector dot products.
 * @param {object} idx
 * @param {number[]} queryEmbedding
 * @param {number} topN
 * @param {Set<number>|object|null} candidateSet
 * @returns {Array<{idx:number,sim:number}>}
 */
export function rankDenseVectors(idx, queryEmbedding, topN, candidateSet) {
  const vectors = idx.denseVec?.vectors;
  if (!Array.isArray(vectors) || !vectors.length) return [];
  const rawQueryDims = Number(queryEmbedding?.length) || 0;
  const reportedDims = Number.isFinite(idx.denseVec?.dims) ? idx.denseVec.dims : rawQueryDims;
  const normalized = normalizeEmbeddingDims(queryEmbedding, reportedDims || null);
  if (!normalized.embedding) return [];
  const queryDims = normalized.queryDims;
  let dims = normalized.expectedDims || queryDims;
  const queryVector = normalized.embedding;
  if (normalized.adjusted && queryDims && normalized.expectedDims) {
    if (!idx.denseVec?._dimMismatchWarned) {
      idx.denseVec._dimMismatchWarned = true;
      console.warn(
        `[search] dense embeddings dimension mismatch (query=${queryDims}, index=${reportedDims}); ` +
        'clipping/padding query vector to index dims.'
      );
    }
  }
  if (!dims || dims <= 0) return [];
  const minVal = Number.isFinite(idx.denseVec?.minVal) ? Number(idx.denseVec.minVal) : -1;
  const maxVal = Number.isFinite(idx.denseVec?.maxVal) ? Number(idx.denseVec.maxVal) : 1;
  const rawLevels = Number(idx.denseVec?.levels);
  let levels = Number.isFinite(rawLevels) ? Math.floor(rawLevels) : 256;
  if (!Number.isFinite(levels) || levels < 2) levels = 256;
  if (levels > 256) levels = 256;
  const range = maxVal - minVal;
  const scale = Number.isFinite(idx.denseVec?.scale)
    ? idx.denseVec.scale
    : (Number.isFinite(range) && range !== 0 ? (range / (levels - 1)) : (2 / 255));
  const ids = candidateSet ? bitmapToArray(candidateSet) : vectors.map((_, i) => i);
  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => ({ idx: entry.id, sim: entry.score })
  });
  let order = 0;

  for (const id of ids) {
    const vec = vectors[id];
    const isArrayLike = Array.isArray(vec) || ArrayBuffer.isView(vec);
    if (!isArrayLike || vec.length < dims) continue;
    let dot = 0;
    for (let i = 0; i < dims; i++) {
      const v = vec[i] * scale + minVal;
      dot += v * queryVector[i];
    }
    reducer.pushRaw(dot, id, order);
    order += 1;
  }

  return reducer.finish({ limit: topN });
}

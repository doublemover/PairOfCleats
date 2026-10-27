import { SimpleMinHash, assertMinhashHashIdentity, minifyMinhashSignature, normalizeMinhashSampling } from '../index/minhash.js';
import { createTopKReducer } from './pipeline/topk.js';
import { bitmapHas, bitmapToArray, getBitmapSize } from './bitmap.js';
import { normalizeEmbeddingDims } from './ann/dims.js';
import { createVocabIndex } from './vocab-index.js';
import { decodeDenseVectorValidity } from '../shared/dense-vector-validity.js';
import { throwIfAborted } from '../shared/abort.js';
import { withAnnScoreSpace } from '../shared/ann-similarity.js';
import { assertBm25Parameters } from './bm25-policy.js';
import { hasAdmittedPostingOrder } from '../shared/posting-order.js';
import { tryRankBm25Wand } from './bm25-wand.js';

/**
 * Legacy BM25-like scoring using chunk metadata fields directly.
 * @param {object} idx
 * @param {string[]} tokens
 * @param {number} topN
 * @param {Set<number>|object|null} [allowedIdx]
 * @returns {Array<{idx:number,score:number}>}
 */
export function rankBM25Legacy(idx, tokens, topN, allowedIdx = null, includeZeroScores = false) {
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
    if (score > 0 || (includeZeroScores && score === 0)) {
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
  ensureVocabIndex(tokenIndex);
  if (!Array.isArray(tokenIndex.docLengths) && !(tokenIndex.docLengths instanceof Map)) tokenIndex.docLengths = [];
  if (!tokenIndex.totalDocs) tokenIndex.totalDocs = tokenIndex.docLengths instanceof Map ? tokenIndex.docLengths.size : tokenIndex.docLengths.length;
  if (!tokenIndex.avgDocLen) {
    const lengths = tokenIndex.docLengths instanceof Map ? tokenIndex.docLengths.values() : tokenIndex.docLengths;
    let total = 0, count = 0;
    for (const length of lengths) { total += length; count++; }
    tokenIndex.avgDocLen = count ? total / count : 0;
  }
  return tokenIndex;
}

const buildQueryTermFrequency = (tokens) => {
  const qtf = new Map();
  tokens.forEach((tok) => qtf.set(tok, (qtf.get(tok) || 0) + 1));
  return qtf;
};

const ensureVocabIndex = (index) => {
  if (!index.vocabIndex) {
    index.vocabIndex = createVocabIndex(index.vocab);
  }
  return index.vocabIndex;
};

const accumulateBm25Scores = ({
  scores,
  index,
  qtf,
  allowedIdx,
  allowedIds,
  docLengths,
  avgDocLen,
  totalDocs,
  k1,
  b,
  scoreMultiplier = 1
}) => {
  ensureVocabIndex(index);

  for (const [tok, qCount] of qtf.entries()) {
    const tokIdx = index.vocabIndex.get(tok);
    if (tokIdx === undefined) continue;
    const posting = index.postings[tokIdx] || [];
    if (!posting.length) continue;
    const df = index.documentFrequencies ? index.documentFrequencies[tokIdx] : posting.length;
    if (index.documentFrequencies && (!Number.isSafeInteger(df) || df < posting.length || df > totalDocs)) {
      throw new Error('Invalid global BM25 document-frequency evidence.');
    }
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    const seek = allowedIds && posting.length >= 64
      && allowedIds.length * Math.ceil(Math.log2(posting.length + 1)) < posting.length / 2
      && hasAdmittedPostingOrder(posting);
    const eligibleRows = seek ? (function* () {
      for (const id of allowedIds) {
        let low = 0, high = posting.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (posting[middle][0] < id) low = middle + 1;
          else high = middle;
        }
        if (low < posting.length && posting[low][0] === id) yield posting[low];
      }
    })() : posting;
    for (const [docId, tf] of eligibleRows) {
      if (!seek && allowedIdx && !bitmapHas(allowedIdx, docId)) continue;
      const dl = (docLengths instanceof Map ? docLengths.get(docId) : docLengths[docId]) || 0;
      const denom = tf + k1 * (1 - b + b * (dl / avgDocLen));
      const score = idf * ((tf * (k1 + 1)) / denom) * qCount * scoreMultiplier;
      scores.set(docId, (scores.get(docId) || 0) + score);
    }
  }
};

const prepareAllowedIds = allowedIdx => allowedIdx
  ? bitmapToArray(allowedIdx).filter(id => Number.isSafeInteger(id) && id >= 0).sort((a, b) => a - b)
  : null;

const finishWeightedScores = ({ idx, scores, topN, includeZeroScores = false, zeroScoreIds = null }) => {
  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => ({ idx: entry.id, score: entry.score })
  });
  let order = 0;
  for (const [docId, score] of scores.entries()) {
    const weight = idx.chunkMeta[docId]?.weight || 1;
    const weightedScore = score * weight;
    if (weightedScore > 0 || (includeZeroScores && weightedScore === 0)) {
      reducer.pushRaw(weightedScore, docId, order);
      order += 1;
    }
  }
  if (includeZeroScores && zeroScoreIds) {
    const ids = zeroScoreIds instanceof Set ? zeroScoreIds : bitmapToArray(zeroScoreIds);
    for (const id of ids) {
      if (!scores.has(id) && idx.chunkMeta[id]) {
        reducer.pushRaw(0, id, order++);
      }
    }
  }
  return reducer.finish({ limit: topN });
};

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
  b = 0.75,
  includeZeroScores = false,
  scoreBoundPruning = true,
  work = null
}) {
  assertBm25Parameters(k1, b);
  const tokenIndex = tokenIndexOverride || getTokenIndex(idx);
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) {
    return rankBM25Legacy(idx, tokens, topN, allowedIdx, includeZeroScores);
  }
  if (allowedIdx && getBitmapSize(allowedIdx) === 0) return [];

  const scores = new Map();
  const docLengths = tokenIndex.docLengths;
  const avgDocLen = tokenIndex.avgDocLen || 1;
  const totalDocs = tokenIndex.totalDocs || idx.chunkMeta.length || 1;
  const qtf = buildQueryTermFrequency(tokens);
  ensureVocabIndex(tokenIndex);
  if (scoreBoundPruning) {
    const bounded = tryRankBm25Wand({ idx, groups: [{ index: tokenIndex, qtf, docLengths, avgDocLen, totalDocs }],
      topN, k1, b, allowedIdx, includeZeroScores, work });
    if (bounded !== null) return bounded;
  }

  accumulateBm25Scores({
    scores,
    index: tokenIndex,
    qtf,
    allowedIdx,
    allowedIds: prepareAllowedIds(allowedIdx),
    docLengths,
    avgDocLen,
    totalDocs,
    k1,
    b
  });
  if (work) Object.assign(work, { strategy: 'exhaustive', retainedScoreMapEntries: scores.size });
  return finishWeightedScores({ idx, scores, topN, includeZeroScores, zeroScoreIds: allowedIdx });
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
  tokenIndexOverride = null,
  allowedIdx = null,
  k1 = 1.2,
  b = 0.75,
  includeZeroScores = false,
  scoreBoundPruning = true,
  work = null
}) {
  assertBm25Parameters(k1, b);
  const fields = idx.fieldPostings?.fields || {};
  if (!fieldWeights) {
    return rankBM25({ idx, tokens, topN, k1, b, allowedIdx, tokenIndexOverride, includeZeroScores, scoreBoundPruning, work });
  }
  if (!tokens.length && !includeZeroScores) return [];
  if (allowedIdx && getBitmapSize(allowedIdx) === 0) return [];

  // NOTE:
  // The build pipeline may intentionally omit a dedicated "body" field postings map
  // because the unfielded token index already covers the body and maintaining both
  // roughly doubles memory. When that happens we treat "body" as an alias of the
  // unfielded token index at query time.
  const tokenIndex = tokenIndexOverride || getTokenIndex(idx);

  const qtf = buildQueryTermFrequency(tokens);
  const allowedIds = prepareAllowedIds(allowedIdx);

  const scores = new Map(), groups = [];
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
    const docLengths = Array.isArray(index.docLengths) || index.docLengths instanceof Map ? index.docLengths : [];
    const avgDocLen = Number.isFinite(index.avgDocLen) ? index.avgDocLen : 1;
    const totalDocs = Number.isFinite(index.totalDocs) ? index.totalDocs : docLengths instanceof Map ? docLengths.size : docLengths.length;
    if (!totalDocs) continue;

    ensureVocabIndex(index);
    groups.push({ index, qtf, docLengths, avgDocLen, totalDocs, scoreMultiplier: fieldWeight });
  }
  if (scoreBoundPruning) {
    const bounded = tryRankBm25Wand({ idx, groups, topN, k1, b, allowedIdx, includeZeroScores, work });
    if (bounded !== null) return bounded;
  }
  for (const group of groups) accumulateBm25Scores({ scores, ...group, allowedIdx, allowedIds, k1, b });
  if (work) Object.assign(work, { strategy: 'exhaustive', retainedScoreMapEntries: scores.size });

  return finishWeightedScores({ idx, scores, topN, includeZeroScores, zeroScoreIds: allowedIdx });
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
  assertMinhashHashIdentity(idx.minhash.hashIdentity);
  const qSig = minhashSigForTokens(tokens);
  const sampling = normalizeMinhashSampling(idx.minhash.sampling, qSig.length);
  const sampledQuery = sampling ? minifyMinhashSignature(qSig, sampling) : null;
  const ids = candidateSet ? bitmapToArray(candidateSet) : idx.minhash.signatures.map((_, i) => i);
  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => withAnnScoreSpace({ idx: entry.id, sim: entry.score }, { kind: 'jaccard', metric: 'jaccard', backend: 'minhash' })
  });
  let order = 0;
  for (const id of ids) {
    const sig = idx.minhash.signatures[id];
    if (!sig) continue;
    const querySig = sig.length === qSig.length
      ? qSig
      : (sampledQuery && sig.length === sampledQuery.length ? sampledQuery : null);
    if (!querySig) continue;
    reducer.pushRaw(jaccard(querySig, sig), id, order);
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
const createDenseVectorRanker = (idx, queryEmbedding, topN, metrics = null) => {
  const vectors = idx.denseVec?.vectors;
  const denseBuffer = idx.denseVec?.buffer;
  const hasBuffer = !!(
    denseBuffer
    && ArrayBuffer.isView(denseBuffer)
    && denseBuffer.BYTES_PER_ELEMENT === 1
  );
  if ((!Array.isArray(vectors) || !vectors.length) && !hasBuffer) return [];
  const rawQueryDims = Number(queryEmbedding?.length) || 0;
  const reportedDims = Number.isFinite(idx.denseVec?.dims) ? idx.denseVec.dims : rawQueryDims;
  const normalized = normalizeEmbeddingDims(queryEmbedding, reportedDims || null);
  if (!normalized.embedding) return [];
  const queryDims = normalized.queryDims;
  let dims = normalized.expectedDims || queryDims;
  const queryVector = normalized.embedding;
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
  const vectorCount = hasBuffer && dims > 0
    ? Math.floor(denseBuffer.length / dims)
    : vectors.length;
  const reducer = createTopKReducer({
    k: topN,
    buildPayload: (entry) => withAnnScoreSpace({ idx: entry.id, sim: entry.score }, { kind: 'dot-product', metric: 'dot', backend: 'dense' })
  });
  let order = 0;
  const validity = decodeDenseVectorValidity(idx.denseVec);
  const validityCount = idx.denseVec.validity?.count ?? null;

  const processVectorId = (id) => {
    if (metrics) metrics.rowsVisited = (metrics.rowsVisited || 0) + 1;
    if (!Number.isSafeInteger(id) || id < 0 || id >= vectorCount) return;
    if (validity ? id >= validityCount || !(validity[id >> 3] & (1 << (id & 7)))
      : Array.isArray(vectors) && !vectors[id]?.length) return;
    let dot = 0;
    if (hasBuffer) {
      const start = id * dims;
      const end = start + dims;
      if (start < 0 || end > denseBuffer.length) return;
      // Preserve the scalar operation/accumulation order exactly. Computing
      // query-side coefficients or reassociating rows would change near ties.
      for (let i = 0; i < dims; i++) {
        const v = denseBuffer[start + i] * scale + minVal;
        dot += v * queryVector[i];
      }
    } else {
      const vec = vectors[id];
      const isArrayLike = Array.isArray(vec) || ArrayBuffer.isView(vec);
      if (!isArrayLike || vec.length < dims) return;
      for (let i = 0; i < dims; i++) {
        const v = vec[i] * scale + minVal;
        dot += v * queryVector[i];
      }
    }
    if (metrics) { metrics.vectorsScored = (metrics.vectorsScored || 0) + 1; metrics.coordinatesScored = (metrics.coordinatesScored || 0) + dims; }
    reducer.pushRaw(dot, id, order);
    order += 1;
  };
  return { reducer, processVectorId, vectorCount };
};

const denseCandidateIds = (candidateSet, vectorCount, metrics) => {
  if (!candidateSet) return (function* () { for (let id = 0; id < vectorCount; id++) yield id; })();
  if (typeof candidateSet[Symbol.iterator] === 'function') return candidateSet;
  if (typeof candidateSet.values === 'function') return candidateSet.values();
  const ids = bitmapToArray(candidateSet);
  if (metrics) metrics.candidateIdsCopied = (metrics.candidateIdsCopied || 0) + ids.length;
  return ids;
};

export function rankDenseVectors(idx, queryEmbedding, topN, candidateSet, { signal = null, metrics = null } = {}) {
  throwIfAborted(signal);
  const plan = createDenseVectorRanker(idx, queryEmbedding, topN, metrics);
  if (Array.isArray(plan)) return plan;
  if (metrics) { metrics.rowViewsCreated = 0; metrics.candidateIdsCopied ||= 0; }
  let processed = 0;
  for (const id of denseCandidateIds(candidateSet, plan.vectorCount, metrics)) {
    if (processed++ % 128 === 0) throwIfAborted(signal);
    plan.processVectorId(id);
  }
  throwIfAborted(signal);
  return plan.reducer.finish({ limit: topN });
}

/** The actual async provider yields between bounded scalar blocks so a caller's
 * cancellation can be observed without returning an incomplete top-k. */
export async function rankDenseVectorsAsync(idx, queryEmbedding, topN, candidateSet, { signal = null, metrics = null } = {}) {
  throwIfAborted(signal);
  const plan = createDenseVectorRanker(idx, queryEmbedding, topN, metrics);
  if (Array.isArray(plan)) return plan;
  if (metrics) { metrics.rowViewsCreated = 0; metrics.candidateIdsCopied ||= 0; metrics.yieldedBlocks = 0; }
  let processed = 0, checkpoint = performance.now();
  for (const id of denseCandidateIds(candidateSet, plan.vectorCount, metrics)) {
    if (processed && (processed % 128 === 0 || performance.now() - checkpoint >= 8)) {
      throwIfAborted(signal);
      await new Promise(resolve => setImmediate(resolve));
      throwIfAborted(signal); checkpoint = performance.now();
      if (metrics) metrics.yieldedBlocks++;
    }
    plan.processVectorId(id); processed++;
  }
  throwIfAborted(signal);
  return plan.reducer.finish({ limit: topN });
}

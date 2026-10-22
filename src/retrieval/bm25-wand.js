import { createTopKReducer } from './pipeline/topk.js';
import { bitmapHas, getBitmapSize } from './bitmap.js';
import { hasAdmittedPostingOrder } from '../shared/posting-order.js';

const MIN_POSTINGS = 2048, MAX_CURSORS = 64;
const scratch = new ArrayBuffer(8), number = new Float64Array(scratch), bits = new BigUint64Array(scratch);
const up = value => {
  if (value === Infinity) return value;
  if (value === 0) return Number.MIN_VALUE;
  number[0] = value; bits[0] += 1n; return number[0];
};
const upperMultiply = (left, right) => up(up(left) * up(right));
const unsupported = (work, reason) => { if (work) work.boundFallback = reason; return null; };

/** Exact document-at-a-time WAND for an explicitly bounded positive parameter
 * domain. Bounds are request-local; no persistent index metadata or shared
 * mutable score cache is introduced. The exhaustive owner remains fallback. */
export const tryRankBm25Wand = ({ idx, groups, topN, k1, b, allowedIdx, includeZeroScores, work = null }) => {
  if (work) { work.boundPostingRowsInspected = 0; delete work.boundFallback; }
  if (includeZeroScores) return unsupported(work, 'boolean-zero-completion');
  if (!Number.isSafeInteger(topN) || topN <= 0 || k1 < 0 || k1 > 16 || b < 0 || b > 1) return unsupported(work, 'parameter-domain');
  const cursors = [];
  let postingCount = 0;
  for (const group of groups) {
    const { index, qtf, docLengths, avgDocLen, totalDocs, scoreMultiplier = 1 } = group;
    if (!Number.isFinite(avgDocLen) || avgDocLen < 1e-6 || avgDocLen > Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(totalDocs) || totalDocs <= 0 || !Number.isFinite(scoreMultiplier)
      || scoreMultiplier < 1e-6 || scoreMultiplier > 1e6) return unsupported(work, 'corpus-or-field-domain');
    for (const [token, qCount] of qtf) {
      const tokenId = index.vocabIndex.get(token);
      if (tokenId === undefined) continue;
      const posting = index.postings[tokenId] || [];
      if (!posting.length) continue;
      const df = index.documentFrequencies ? index.documentFrequencies[tokenId] : posting.length;
      if (!hasAdmittedPostingOrder(posting) || !Number.isSafeInteger(df) || df < posting.length || df > totalDocs
        || !Number.isSafeInteger(qCount) || qCount <= 0 || qCount > 1e6) return unsupported(work, 'posting-or-frequency-domain');
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      cursors.push({ posting, position: 0, idf, qCount, docLengths, avgDocLen, scoreMultiplier, maximumWeight: 1 });
      postingCount += posting.length;
      if (cursors.length > MAX_CURSORS) return unsupported(work, 'cursor-count');
    }
  }
  if (cursors.length < 2 || postingCount < MIN_POSTINGS || topN * 8 >= postingCount) return unsupported(work, 'small-workload');
  if (allowedIdx && getBitmapSize(allowedIdx) * cursors.length * 8 < postingCount / 2) return unsupported(work, 'selective-intersection');
  let inspected = 0;
  for (const cursor of cursors) {
    for (const [id, tf] of cursor.posting) {
      if (work) work.boundPostingRowsInspected++;
      const length = (cursor.docLengths instanceof Map ? cursor.docLengths.get(id) : cursor.docLengths[id]) || 0;
      const rawWeight = idx.chunkMeta[id]?.weight;
      const weight = rawWeight || 1;
      if (!Number.isSafeInteger(tf) || tf <= 0 || !Number.isFinite(length) || length < 0 || length > Number.MAX_SAFE_INTEGER
        || rawWeight != null && (typeof rawWeight !== 'number' || !Number.isFinite(rawWeight))
        || weight < 1e-6 || weight > 1e6) return unsupported(work, 'length-tf-or-chunk-weight-domain');
      cursor.maximumWeight = Math.max(cursor.maximumWeight, weight); inspected++;
    }
    // At most 64 nonnegative contributions, bounded normal operands and the
    // original scalar accumulation order. 1024 eps covers their floating-point
    // rounding envelope; every positive bound operation also rounds upward.
    // Unsupported/extreme domains are evaluated by the original scorer.
    let upper = upperMultiply(cursor.idf, up((k1 + 1) * (1 + 1024 * Number.EPSILON)));
    for (const factor of [cursor.qCount, cursor.scoreMultiplier, cursor.maximumWeight]) upper = upperMultiply(upper, factor);
    cursor.upper = upper;
  }
  const reducer = createTopKReducer({ k: topN, buildPayload: entry => ({ idx: entry.id, score: entry.score }) });
  let skipped = 0, fullyScored = 0, visited = 0;
  for (;;) {
    const ordered = cursors.filter(cursor => cursor.position < cursor.posting.length)
      .sort((left, right) => left.posting[left.position][0] - right.posting[right.position][0]);
    if (!ordered.length) break;
    const threshold = reducer.minimumCompetitiveScore();
    let bound = 0, pivot = null;
    for (const cursor of ordered) {
      bound = up(bound + cursor.upper);
      if (bound >= threshold) { pivot = cursor.posting[cursor.position][0]; break; }
    }
    if (pivot === null) {
      for (const cursor of ordered) skipped += cursor.posting.length - cursor.position;
      break;
    }
    if (ordered[0].posting[ordered[0].position][0] !== pivot) {
      for (const cursor of ordered) {
        if (cursor.posting[cursor.position][0] >= pivot) break;
        let low = cursor.position, high = cursor.posting.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (cursor.posting[middle][0] < pivot) low = middle + 1; else high = middle;
        }
        skipped += low - cursor.position; cursor.position = low;
      }
      continue;
    }
    const eligible = !allowedIdx || bitmapHas(allowedIdx, pivot);
    let score = 0;
    // This is the original field-then-query-term contribution order. Cursor
    // order used to find a pivot never changes score accumulation order.
    for (const cursor of cursors) {
      const row = cursor.posting[cursor.position];
      if (!row || row[0] !== pivot) continue;
      cursor.position++; visited++;
      if (!eligible) continue;
      const tf = row[1], length = (cursor.docLengths instanceof Map ? cursor.docLengths.get(pivot) : cursor.docLengths[pivot]) || 0;
      const denominator = tf + k1 * (1 - b + b * (length / cursor.avgDocLen));
      const contribution = cursor.idf * ((tf * (k1 + 1)) / denominator) * cursor.qCount * cursor.scoreMultiplier;
      score = (score || 0) + contribution;
    }
    if (!eligible) continue;
    fullyScored++;
    const weighted = score * (idx.chunkMeta[pivot]?.weight || 1);
    if (weighted > 0) reducer.pushRaw(weighted, pivot, fullyScored - 1);
  }
  if (work) Object.assign(work, { strategy: 'request-bound-wand', boundPostingRowsInspected: inspected, postingsScored: visited,
    postingsSkipped: skipped, fullyScoredDocuments: fullyScored, retainedScoreMapEntries: 0, cursors: cursors.length,
    boundMetadataBytes: 0 });
  return reducer.finish({ limit: topN });
};

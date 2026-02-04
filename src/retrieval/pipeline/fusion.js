/**
 * Fuse sparse and ANN hits into a single ranked list.
 * @param {object} input
 * @param {Array<object>} input.bmHits
 * @param {Array<object>} input.annHits
 * @param {string} input.sparseType
 * @param {string|null} input.annSource
 * @param {boolean} input.rrfEnabled
 * @param {number} input.rrfK
 * @param {boolean} input.blendEnabled
 * @param {number} input.blendSparseWeight
 * @param {number} input.blendAnnWeight
 * @param {boolean} input.fieldWeightsEnabled
 * @param {object|null} [input.scoreBuffer]
 * @returns {{scored:Array<object>|object,useRrf:boolean}}
 */
export const fuseRankedHits = ({
  bmHits,
  annHits,
  sparseType,
  annSource,
  rrfEnabled,
  rrfK,
  blendEnabled,
  blendSparseWeight,
  blendAnnWeight,
  fieldWeightsEnabled,
  scoreBuffer = null
}) => {
  const useRrf = rrfEnabled && !blendEnabled && bmHits.length && annHits.length;
  const sparseRanks = new Map();
  const annRanks = new Map();
  if (useRrf) {
    bmHits.forEach((hit, index) => sparseRanks.set(hit.idx, index + 1));
    annHits.forEach((hit, index) => annRanks.set(hit.idx, index + 1));
  }

  const allHits = new Map();
  const recordHit = (idxVal, update) => {
    const current = allHits.get(idxVal) || { bm25: null, fts: null, ann: null, annSource: null };
    allHits.set(idxVal, { ...current, ...update });
  };
  bmHits.forEach((h) => {
    recordHit(h.idx, sparseType === 'fts' ? { fts: h.score } : { bm25: h.score });
  });
  annHits.forEach((h) => {
    recordHit(h.idx, { ann: h.sim, annSource });
  });

  const sparseMaxScore = bmHits.length
    ? Math.max(...bmHits.map((hit) => (hit.score ?? hit.sim ?? 0)))
    : null;
  const scored = scoreBuffer?.reset ? scoreBuffer.reset() : [];
  for (const [idxVal, scores] of allHits.entries()) {
    const sparseScore = scores.fts ?? scores.bm25 ?? null;
    const annScore = scores.ann ?? null;
    const sparseTypeValue = scores.fts != null
      ? 'fts'
      : (scores.bm25 != null ? (fieldWeightsEnabled ? 'bm25-fielded' : 'bm25') : null);
    let scoreType = null;
    let score = null;
    let blendInfo = null;
    if (useRrf) {
      const sparseRank = sparseRanks.get(idxVal) ?? null;
      const annRank = annRanks.get(idxVal) ?? null;
      const sparseRrf = sparseRank ? 1 / (rrfK + sparseRank) : 0;
      const annRrf = annRank ? 1 / (rrfK + annRank) : 0;
      scoreType = 'rrf';
      score = sparseRrf + annRrf;
      blendInfo = {
        k: rrfK,
        sparseRank,
        annRank,
        sparseRrf,
        annRrf,
        score
      };
    } else if (blendEnabled && (sparseScore != null || annScore != null)) {
      const sparseMax = sparseScore != null
        ? Math.max(sparseScore, sparseMaxScore || 0)
        : 0;
      const normalizedSparse = sparseScore != null && sparseMax > 0
        ? sparseScore / sparseMax
        : null;
      const clippedAnn = annScore != null
        ? Math.max(-1, Math.min(1, annScore))
        : null;
      const normalizedAnn = clippedAnn != null ? (clippedAnn + 1) / 2 : null;
      const activeSparseWeight = normalizedSparse != null ? blendSparseWeight : 0;
      const activeAnnWeight = normalizedAnn != null ? blendAnnWeight : 0;
      const weightSum = activeSparseWeight + activeAnnWeight;
      const blended = weightSum > 0
        ? ((normalizedSparse ?? 0) * activeSparseWeight + (normalizedAnn ?? 0) * activeAnnWeight) / weightSum
        : 0;
      scoreType = 'blend';
      score = blended;
      blendInfo = {
        score: blended,
        sparseNormalized: normalizedSparse,
        annNormalized: normalizedAnn,
        sparseWeight: activeSparseWeight,
        annWeight: activeAnnWeight
      };
    } else if (sparseScore != null) {
      scoreType = sparseTypeValue;
      score = sparseScore;
    } else if (annScore != null) {
      scoreType = 'ann';
      score = annScore;
    } else {
      scoreType = 'none';
      score = 0;
    }

    const entry = {
      idx: idxVal,
      score,
      scoreType,
      sparseScore,
      annScore,
      annSource: scores.annSource || null,
      sparseType: sparseTypeValue,
      blendInfo
    };
    if (scoreBuffer?.push) {
      scoreBuffer.push(entry);
    } else {
      scored.push(entry);
    }
  }

  return { scored: scoreBuffer?.push ? scoreBuffer : scored, useRrf };
};

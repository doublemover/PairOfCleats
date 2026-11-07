const identityPatterns = {
  policyIdentity: /^sqp1-[a-f0-9]{64}$/,
  sourceIdentity: /^ss1-[a-f0-9]{64}$/,
  coordinateIdentity: /^sc1-[a-f0-9]{64}$/
};
const passive = (value, key) => {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};

/** A declared final coordinate is separate from the numeric observation. Missing
 * provenance cannot borrow a sparse/ANN component or an explanation's score. */
export const captureRetrievalScoreSpace = original => {
  if (!original || typeof original !== 'object' || Array.isArray(original)
    || passive(original, 'schemaVersion') !== 1 || passive(original, 'stage') !== 'final') return null;
  const type = passive(original, 'type');
  if (typeof type !== 'string' || !type || type.length > 128) return null;
  const space = { schemaVersion: 1, stage: 'final', type };
  for (const [field, pattern] of Object.entries(identityPatterns)) {
    const value = passive(original, field);
    if (typeof value !== 'string' || !pattern.test(value)) return null;
    space[field] = value;
  }
  return Object.freeze(space);
};

export const observeRetrievalHitScore = hit => {
  const score = passive(hit, 'score');
  const value = typeof score === 'number' && Number.isFinite(score) ? score : null;
  const space = captureRetrievalScoreSpace(passive(hit, 'scoreSpace'));
  const type = passive(hit, 'scoreType');
  const qualified = value !== null && space !== null && type === space.type;
  return { value, space, qualified, state: value === null ? 'missing-value'
    : !space || type !== space.type ? 'unknown-space' : 'measured' };
};

export const retrievalScoreSpaceKey = space => space
  ? JSON.stringify([space.stage, space.type, space.policyIdentity, space.sourceIdentity, space.coordinateIdentity]) : null;

/** Report both the mean per comparison and the pooled pair mean. They answer
 * different questions when queries share different numbers of distinct hits. */
export const aggregateRetrievalScoreDeltas = comparisons => {
  let macro = 0, pooled = 0, defined = 0, pairs = 0;
  const totals = { requestedPairs: 0, comparedPairs: 0, missingValuePairs: 0,
    unknownSpacePairs: 0, incompatibleSpacePairs: 0, nonFiniteDeltaPairs: 0 };
  let complete = 0, unavailable = 0;
  for (const comparison of comparisons) {
    const measurement = comparison?.comparable !== false ? comparison?.scoreDelta : null;
    if (!measurement) { unavailable++; continue; }
    for (const key of Object.keys(totals)) totals[key] += measurement[key];
    if (measurement.complete) complete++;
    if (!Number.isFinite(comparison.avgDelta) || measurement.comparedPairs === 0) continue;
    defined++;
    macro += (comparison.avgDelta - macro) / defined;
    const next = pairs + measurement.comparedPairs;
    pooled += (comparison.avgDelta - pooled) * (measurement.comparedPairs / next);
    pairs = next;
  }
  return { aggregationUnit: 'comparison-macro', pairAggregationUnit: 'shared-distinct-hit-pair',
    requestedComparisons: comparisons.length, definedComparisons: defined, completeComparisons: complete,
    unavailableComparisons: unavailable, ...totals,
    complete: comparisons.length > 0 && complete === comparisons.length,
    meanAbsoluteDelta: defined ? macro : null, pooledMeanAbsoluteDelta: pairs ? pooled : null };
};

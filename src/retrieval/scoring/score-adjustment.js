/** Relative scaling in a higher-is-better coordinate. Positive factors move
 * negative similarities toward zero by division, preserving their strict order
 * under a shared factor instead of turning promotion into a distance penalty.
 * Zero is the limiting demotion for negative scores; neutral factors are exact.
 */
export const applyRankFactor = (score, factor) => {
  if (factor === 1) return score;
  if (score < 0 && factor >= 0) return factor === 0 ? -Number.MAX_VALUE : Math.max(-Number.MAX_VALUE, score / factor);
  return score * factor;
};

const stages = ['graph', 'model', 'federation'];
const scorePair = value => value && typeof value.type === 'string' && value.type.length <= 128 && Number.isFinite(value.score)
  ? { type: value.type, score: value.score } : null;

/** Keep the final selected pair truthful without building histories or cloning
 * full explanations. Three named source-stage pairs are the entire retained
 * provenance budget. Explain-disabled paths do not allocate a breakdown.
 */
export const reconcileSelectedScore = (breakdown, { score, type, stage, sourceScore, sourceType }) => {
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return breakdown;
  if (!stages.includes(stage)) throw new TypeError('Unknown score transformation stage.');
  const sources = {};
  for (const name of stages) {
    const pair = scorePair(breakdown.selected?.sources?.[name]);
    if (pair) sources[name] = pair;
  }
  const source = scorePair({ type: sourceType, score: sourceScore });
  if (source) sources[stage] = source;
  return { ...breakdown, selected: { type, score, ...(Object.keys(sources).length ? { sources } : {}) } };
};

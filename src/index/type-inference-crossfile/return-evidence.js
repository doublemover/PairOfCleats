export const RETURN_TYPE_EVIDENCE_VERSION = 1;
const basis = 'minimum-support-and-local-hop';
const score = value => Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' && value ? value : null;
const offset = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const location = chunk => ({ chunkUid: text(chunk?.chunkUid || chunk?.metaV2?.chunkUid),
  file: text(chunk?.file), name: text(chunk?.name), start: offset(chunk?.start), end: offset(chunk?.end) });
const copyOrigin = origin => {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)
    || !['chunkUid', 'file', 'name', 'source'].every(key => origin[key] === null || typeof origin[key] === 'string')
    || !['start', 'end'].every(key => origin[key] === null || Number.isSafeInteger(origin[key]) && origin[key] >= 0)
    || origin.confidence !== null && !Number.isFinite(origin.confidence)) throw new TypeError('Invalid return type evidence origin.');
  return Object.freeze({ ...location(origin), source: origin.source, confidence: origin.confidence });
};

/** Scores are evidence strengths, not probabilities. Keep the original seed
 * owner/score without copying or growing a complete propagation path.
 */
export const createReturnTypeFact = (chunk, type, source, confidence, evidence = null) => {
  const propagation = evidence?.returnPropagation;
  if (propagation && (propagation.schemaVersion !== RETURN_TYPE_EVIDENCE_VERSION || propagation.basis !== basis)) {
    throw new TypeError('Incompatible return type propagation evidence.');
  }
  const origin = propagation ? copyOrigin(propagation.origin)
    : Object.freeze({ ...location(chunk), source: text(source), confidence: score(confidence) });
  return Object.freeze({ type, source: text(source), confidence: score(confidence), origin });
};

export const propagateReturnTypeFact = (fact, chunk, localConfidence) => ({
  type: fact.type,
  // Missing support stays unscored; zero is an explicit score, never a default.
  confidence: fact.confidence === null ? null : Math.min(fact.confidence, localConfidence),
  evidence: { returnPropagation: Object.freeze({ schemaVersion: RETURN_TYPE_EVIDENCE_VERSION, basis,
    sourceConfidence: fact.confidence, localConfidence, origin: copyOrigin(fact.origin),
    via: Object.freeze(location(chunk)) }) }
});

/** Independent seed owners/sources/scores and immediate supporting declarations
 * remain separate. Alternative paths for the same support keep strongest strength.
 */
export const returnTypeSupportKey = evidence => {
  const propagation = evidence?.returnPropagation;
  return propagation ? JSON.stringify([propagation.schemaVersion, propagation.basis,
    propagation.origin, propagation.via]) : null;
};

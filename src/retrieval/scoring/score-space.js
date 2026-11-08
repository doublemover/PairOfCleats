import { createHash } from 'node:crypto';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { captureRetrievalScoreSpace } from '../score-observation.js';

const digest = (prefix, value) => prefix + createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');

/** Called only for retained ranked hits, never per candidate. The owning rank
 * stage supplies actual formula/provider facts, not requested CLI flags. */
export const createScoreCoordinateIdentity = descriptor => {
  if (descriptor.usesAnn && ['ann', 'blend', 'rrf'].includes(descriptor.type)) {
    const ann = descriptor.ann;
    if (!ann || typeof ann.kind !== 'string' || !ann.kind || !descriptor.annSource
      || (ann.kind === 'negative-distance' && (typeof ann.metric !== 'string' || !ann.metric))) return null;
  }
  return digest('sc1-', { version: 1, ...descriptor });
};

export const bindRetrievalScoreSpaces = (hits, { policyIdentity = null, freshness = null } = {}) => {
  const sourceIdentity = freshness?.buildId && freshness?.generationKey && freshness?.activeBuildRoot
    && freshness?.artifactSurfaceVersion && freshness?.profileId && freshness?.signature
    ? digest('ss1-', freshness) : null;
  return hits.map(hit => {
    const { scoreCoordinateIdentity, scoreSpace: previousSpace, ...data } = hit;
    // Cached hits retain the coordinate owner, while the invocation supplies its
    // current policy/source. A previous output receipt is never reused as authority.
    void previousSpace;
    const scoreSpace = captureRetrievalScoreSpace({ schemaVersion: 1, stage: 'final', type: hit.scoreType,
      policyIdentity, sourceIdentity, coordinateIdentity: scoreCoordinateIdentity });
    return { ...data, scoreSpace };
  });
};

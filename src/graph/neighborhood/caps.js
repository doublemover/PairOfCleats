import { normalizeCap } from '../../shared/limits.js';

export const normalizeCaps = (caps) => ({
  maxDepth: normalizeCap(caps?.maxDepth),
  maxFanoutPerNode: normalizeCap(caps?.maxFanoutPerNode),
  maxNodes: normalizeCap(caps?.maxNodes),
  maxEdges: normalizeCap(caps?.maxEdges),
  maxPaths: normalizeCap(caps?.maxPaths),
  maxCandidates: normalizeCap(caps?.maxCandidates),
  maxWorkUnits: normalizeCap(caps?.maxWorkUnits),
  maxWallClockMs: normalizeCap(caps?.maxWallClockMs)
});

export const normalizeDirection = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'in' || raw === 'out' || raw === 'both') return raw;
  return 'both';
};

export const applyCandidateCap = (ref, maxCandidates, recordTruncation) => {
  if (!ref || typeof ref !== 'object') return ref;
  if (!Number.isFinite(maxCandidates) || maxCandidates == null) return ref;
  if (!Array.isArray(ref.candidates) || ref.candidates.length <= maxCandidates) return ref;
  recordTruncation('maxCandidates', {
    limit: maxCandidates,
    observed: ref.candidates.length,
    omitted: ref.candidates.length - maxCandidates
  });
  return {
    ...ref,
    candidates: ref.candidates.slice(0, maxCandidates)
  };
};

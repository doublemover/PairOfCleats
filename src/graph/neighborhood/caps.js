import { normalizeCap } from '../../shared/limits.js';
const optionalCap = value => value == null ? null : normalizeCap(value);

export const normalizeCaps = (caps) => ({
  maxDepth: optionalCap(caps?.maxDepth),
  maxFanoutPerNode: optionalCap(caps?.maxFanoutPerNode),
  maxNodes: optionalCap(caps?.maxNodes),
  maxEdges: optionalCap(caps?.maxEdges),
  maxPaths: optionalCap(caps?.maxPaths),
  maxCandidates: optionalCap(caps?.maxCandidates),
  maxWorkUnits: optionalCap(caps?.maxWorkUnits),
  maxWallClockMs: optionalCap(caps?.maxWallClockMs)
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

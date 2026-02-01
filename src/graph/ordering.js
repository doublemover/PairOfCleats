import { compareStrings } from '../shared/sort.js';

const normalizeNumber = (value) => (Number.isFinite(value) ? value : null);

const compareNumbersAsc = (left, right) => {
  const a = normalizeNumber(left);
  const b = normalizeNumber(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
};

const compareNumbersDesc = (left, right) => {
  const result = compareNumbersAsc(left, right);
  return result === 0 ? 0 : result * -1;
};

export const nodeKey = (ref) => {
  if (!ref || typeof ref !== 'object') return '';
  if (ref.type === 'chunk' && typeof ref.chunkUid === 'string') {
    return `chunk:${ref.chunkUid}`;
  }
  if (ref.type === 'symbol' && typeof ref.symbolId === 'string') {
    return `symbol:${ref.symbolId}`;
  }
  if (ref.type === 'file' && typeof ref.path === 'string') {
    return `file:${ref.path}`;
  }
  return '';
};

const candidateKey = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return '';
  if (typeof candidate.symbolId === 'string' && candidate.symbolId) {
    return `symbol:${candidate.symbolId}`;
  }
  if (typeof candidate.chunkUid === 'string' && candidate.chunkUid) {
    return `chunk:${candidate.chunkUid}`;
  }
  if (typeof candidate.path === 'string' && candidate.path) {
    return `file:${candidate.path}`;
  }
  if (typeof candidate.symbolKey === 'string' && candidate.symbolKey) {
    return `symbolKey:${candidate.symbolKey}`;
  }
  if (typeof candidate.signatureKey === 'string' && candidate.signatureKey) {
    return `signatureKey:${candidate.signatureKey}`;
  }
  return '';
};

export const referenceEnvelopeKey = (envelope) => {
  if (!envelope || typeof envelope !== 'object') return '';
  const resolved = envelope.resolved && typeof envelope.resolved === 'object'
    ? envelope.resolved
    : null;
  const resolvedKey = candidateKey(resolved);
  if (resolvedKey) return resolvedKey;
  const firstCandidate = Array.isArray(envelope.candidates) ? envelope.candidates[0] : null;
  const candidateFallback = candidateKey(firstCandidate);
  if (candidateFallback) return candidateFallback;
  if (typeof envelope.targetName === 'string' && envelope.targetName) {
    return `name:${envelope.targetName}`;
  }
  const status = typeof envelope.status === 'string' ? envelope.status : 'unknown';
  return `status:${status}`;
};

export const edgeEndpointKey = (ref) => {
  if (ref && typeof ref === 'object' && 'status' in ref) {
    return referenceEnvelopeKey(ref);
  }
  return nodeKey(ref);
};

export const compareNodeRefs = (left, right) => compareStrings(nodeKey(left), nodeKey(right));

export const compareCandidates = (left, right) => compareStrings(candidateKey(left), candidateKey(right));

export const compareGraphNodes = (left, right) => {
  const distanceCompare = compareNumbersAsc(left?.distance, right?.distance);
  if (distanceCompare !== 0) return distanceCompare;
  return compareNodeRefs(left?.ref, right?.ref);
};

export const edgeKey = (edge) => {
  if (!edge || typeof edge !== 'object') return '';
  const fromKey = edgeEndpointKey(edge.from);
  const toKey = edgeEndpointKey(edge.to);
  const edgeType = typeof edge.edgeType === 'string' ? edge.edgeType : '';
  return `${fromKey}|${edgeType}|${toKey}`;
};

export const compareGraphEdges = (left, right) => {
  const fromCompare = compareStrings(edgeEndpointKey(left?.from), edgeEndpointKey(right?.from));
  if (fromCompare !== 0) return fromCompare;
  const typeCompare = compareStrings(left?.edgeType, right?.edgeType);
  if (typeCompare !== 0) return typeCompare;
  const toCompare = compareStrings(edgeEndpointKey(left?.to), edgeEndpointKey(right?.to));
  if (toCompare !== 0) return toCompare;
  const confidenceCompare = compareNumbersDesc(left?.confidence, right?.confidence);
  if (confidenceCompare !== 0) return confidenceCompare;
  return compareStrings(edgeKey(left), edgeKey(right));
};

export const compareWitnessPaths = (left, right) => {
  const distanceCompare = compareNumbersAsc(left?.distance, right?.distance);
  if (distanceCompare !== 0) return distanceCompare;
  const toCompare = compareNodeRefs(left?.to, right?.to);
  if (toCompare !== 0) return toCompare;
  const leftKey = Array.isArray(left?.nodes) ? left.nodes.map(nodeKey).join('>') : '';
  const rightKey = Array.isArray(right?.nodes) ? right.nodes.map(nodeKey).join('>') : '';
  return compareStrings(leftKey, rightKey);
};


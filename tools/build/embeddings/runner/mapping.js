import { toPosix } from '../../../../src/shared/files.js';
import {
  buildChunkMappingHintKey,
  resolveChunkSegmentAnchor,
  resolveChunkSegmentUid
} from '../../../../src/index/chunk-id.js';

/**
 * @typedef {'boundaryMismatch'|'missingParent'|'parserOmission'} MappingFailureReason
 */

/**
 * @typedef {object} MappingEntry
 * @property {number} index
 * @property {string} filePath
 * @property {string} kind
 * @property {string} name
 * @property {string} chunkId
 * @property {string} hintKey
 * @property {string} hintWithFileKey
 * @property {string} segmentUid
 * @property {string} anchor
 * @property {number|null} start
 * @property {number|null} end
 */

/**
 * @typedef {object} FileChunkMapping
 * @property {string} filePath
 * @property {Map<number,number>} chunkMap
 * @property {Map<string,number>} chunkIdMap
 * @property {Map<string,number>} hintMap
 * @property {Map<string,number>} hintWithFileMap
 * @property {Map<string,MappingEntry[]>} anchorBuckets
 * @property {Map<string,MappingEntry[]>} segmentBuckets
 * @property {number[]} fallbackIndices
 */

/**
 * @typedef {object} IncrementalChunkMappingIndex
 * @property {Map<string,FileChunkMapping>} fileMappings
 * @property {Map<string,FileChunkMapping|null>} fileAliases
 * @property {Map<string,number>} globalChunkIdMap
 * @property {Map<string,number>} globalHintMap
 * @property {Map<string,number>} globalHintWithFileMap
 * @property {Map<string,MappingEntry[]>} globalAnchorBuckets
 * @property {Map<string,MappingEntry[]>} globalSegmentBuckets
 */

/**
 * @typedef {object} BundleChunkVectorResolution
 * @property {number|null} vectorIndex
 * @property {MappingFailureReason|null} reason
 */

/**
 * Parse a chunk id-ish value into a non-negative integer index.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export const toChunkIndex = (value) => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const index = Math.floor(numeric);
  return index >= 0 ? index : null;
};

/**
 * Convert vector-like payloads to `Uint8Array` for normalized comparison and
 * persistence.
 *
 * @param {unknown} value
 * @returns {Uint8Array|null}
 */
export const toUint8Vector = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value) && value.BYTES_PER_ELEMENT === 1 && !(value instanceof DataView)) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    const out = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const numeric = Number(value[i]);
      out[i] = Number.isFinite(numeric)
        ? Math.max(0, Math.min(255, Math.floor(numeric)))
        : 0;
    }
    return out;
  }
  return null;
};

/**
 * Determine whether a value carries any vector payload.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const hasVectorPayload = (value) => (
  (Array.isArray(value) && value.length > 0)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView) && value.length > 0)
);

/**
 * Compare vector payloads after uint8 normalization.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export const vectorsEqual = (left, right) => {
  const a = toUint8Vector(left);
  const b = toUint8Vector(right);
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const MAPPING_FAILURE_REASON_KEYS = Object.freeze([
  'boundaryMismatch',
  'missingParent',
  'parserOmission'
]);

/**
 * Create empty mapping-failure reason counters.
 *
 * @returns {{boundaryMismatch:number,missingParent:number,parserOmission:number}}
 */
export const createMappingFailureReasons = () => ({
  boundaryMismatch: 0,
  missingParent: 0,
  parserOmission: 0
});

/**
 * Increment failure reason counters with parser-omission fallback.
 *
 * @param {{boundaryMismatch:number,missingParent:number,parserOmission:number}} reasons
 * @param {string|null|undefined} reason
 * @returns {MappingFailureReason}
 */
export const recordMappingFailureReason = (reasons, reason) => {
  const key = MAPPING_FAILURE_REASON_KEYS.includes(reason) ? reason : 'parserOmission';
  reasons[key] += 1;
  return key;
};

/**
 * Serialize reason counters for compact logging.
 *
 * @param {{boundaryMismatch?:number,missingParent?:number,parserOmission?:number}|null|undefined} reasons
 * @returns {string}
 */
export const formatMappingFailureReasons = (reasons) => MAPPING_FAILURE_REASON_KEYS
  .map((reason) => `${reason}:${Number(reasons?.[reason] || 0)}`)
  .join('|');

/**
 * Normalize mapping strings by trimming and falling back to empty.
 *
 * @param {unknown} value
 * @returns {string}
 */
const normalizeMappingString = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || '';
};

/**
 * Resolve stable chunk id string from known chunk payload locations.
 *
 * @param {object|null|undefined} chunk
 * @returns {string}
 */
const resolveExplicitChunkId = (chunk) => normalizeMappingString(
  chunk?.metaV2?.chunkId || chunk?.chunkId
);

/**
 * Normalize file-like path values for mapping lookups.
 *
 * @param {unknown} value
 * @returns {string}
 */
const normalizeMappingPath = (value) => {
  const normalized = toPosix(value);
  return normalizeMappingString(normalized);
};

/**
 * Normalize range boundaries to non-negative integer offsets.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
const normalizeRangeBoundary = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
};

/**
 * Build path aliases used for tolerant file mapping lookup.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
const buildPathLookupKeys = (value) => {
  const normalized = normalizeMappingPath(value);
  if (!normalized) return [];
  const withoutDotPrefix = normalized.replace(/^\.\//, '');
  const withoutLeadingSlash = withoutDotPrefix.replace(/^\/+/, '');
  const keys = new Set([
    normalized,
    withoutDotPrefix,
    withoutLeadingSlash,
    normalized.toLowerCase(),
    withoutDotPrefix.toLowerCase(),
    withoutLeadingSlash.toLowerCase()
  ]);
  return Array.from(keys).filter(Boolean);
};

/**
 * Append entry into a keyed bucket map.
 *
 * @param {Map<string,MappingEntry[]>} bucketMap
 * @param {string} key
 * @param {MappingEntry} entry
 * @returns {void}
 */
const pushMappingBucket = (bucketMap, key, entry) => {
  if (!key) return;
  if (!bucketMap.has(key)) {
    bucketMap.set(key, []);
  }
  bucketMap.get(key).push(entry);
};

/**
 * Build normalized structural mapping metadata for one chunk.
 *
 * @param {{index:number,filePath:string,chunk:object|null}} input
 * @returns {MappingEntry}
 */
const buildMappingEntry = ({ index, filePath, chunk }) => {
  const kind = normalizeMappingString(chunk?.kind || chunk?.metaV2?.kind);
  const name = normalizeMappingString(chunk?.name || chunk?.metaV2?.name);
  const chunkId = resolveExplicitChunkId(chunk);
  const hintKey = buildChunkMappingHintKey(chunk);
  const hintWithFileKey = buildChunkMappingHintKey(chunk, { includeFile: true });
  const segmentUid = normalizeMappingString(resolveChunkSegmentUid(chunk));
  const anchor = normalizeMappingString(resolveChunkSegmentAnchor(chunk));
  return {
    index,
    filePath,
    kind,
    name,
    chunkId,
    hintKey,
    hintWithFileKey,
    segmentUid,
    anchor,
    start: normalizeRangeBoundary(chunk?.start),
    end: normalizeRangeBoundary(chunk?.end)
  };
};

/**
 * Build lookup structures that map incremental bundle chunks back to stage-3
 * vector indices.
 *
 * @param {Map<string,Array<{index?:number,chunk?:object}>>} chunksByFile
 * @returns {IncrementalChunkMappingIndex}
 */
export const createIncrementalChunkMappingIndex = (chunksByFile) => {
  const fileMappings = new Map();
  const fileAliases = new Map();
  const globalChunkIdMap = new Map();
  const globalHintMap = new Map();
  const globalHintWithFileMap = new Map();
  const globalAnchorBuckets = new Map();
  const globalSegmentBuckets = new Map();

  const registerAlias = (lookupKey, mapping) => {
    if (!lookupKey) return;
    if (!fileAliases.has(lookupKey)) {
      fileAliases.set(lookupKey, mapping);
      return;
    }
    if (fileAliases.get(lookupKey) !== mapping) {
      fileAliases.set(lookupKey, null);
    }
  };

  for (const [filePath, items] of chunksByFile.entries()) {
    const normalizedFile = normalizeMappingPath(filePath);
    if (!normalizedFile) continue;
    const mapping = {
      filePath: normalizedFile,
      chunkMap: new Map(),
      chunkIdMap: new Map(),
      hintMap: new Map(),
      hintWithFileMap: new Map(),
      anchorBuckets: new Map(),
      segmentBuckets: new Map(),
      fallbackIndices: []
    };
    const pathAliases = new Set([normalizedFile]);
    for (const item of items || []) {
      const resolvedIndex = toChunkIndex(item?.index ?? item?.chunk?.id);
      if (resolvedIndex == null) continue;
      const chunk = item?.chunk || null;
      const numericChunkId = toChunkIndex(chunk?.id);
      if (numericChunkId != null && !mapping.chunkMap.has(numericChunkId)) {
        mapping.chunkMap.set(numericChunkId, resolvedIndex);
      }
      mapping.fallbackIndices.push(resolvedIndex);
      const entry = buildMappingEntry({
        index: resolvedIndex,
        filePath: normalizedFile,
        chunk
      });
      if (entry.chunkId && !mapping.chunkIdMap.has(entry.chunkId)) {
        mapping.chunkIdMap.set(entry.chunkId, resolvedIndex);
      }
      if (entry.chunkId && !globalChunkIdMap.has(entry.chunkId)) {
        globalChunkIdMap.set(entry.chunkId, resolvedIndex);
      }
      if (entry.hintWithFileKey && !mapping.hintWithFileMap.has(entry.hintWithFileKey)) {
        mapping.hintWithFileMap.set(entry.hintWithFileKey, resolvedIndex);
      }
      if (entry.hintWithFileKey && !globalHintWithFileMap.has(entry.hintWithFileKey)) {
        globalHintWithFileMap.set(entry.hintWithFileKey, resolvedIndex);
      }
      if (entry.hintKey && !mapping.hintMap.has(entry.hintKey)) {
        mapping.hintMap.set(entry.hintKey, resolvedIndex);
      }
      if (entry.hintKey && !globalHintMap.has(entry.hintKey)) {
        globalHintMap.set(entry.hintKey, resolvedIndex);
      }
      pushMappingBucket(mapping.anchorBuckets, entry.anchor, entry);
      pushMappingBucket(globalAnchorBuckets, entry.anchor, entry);
      pushMappingBucket(mapping.segmentBuckets, entry.segmentUid, entry);
      pushMappingBucket(globalSegmentBuckets, entry.segmentUid, entry);
      const stableChunkPath = normalizeMappingPath(resolveChunkStableFilePath(chunk));
      if (stableChunkPath) {
        pathAliases.add(stableChunkPath);
      }
    }
    fileMappings.set(normalizedFile, mapping);
    for (const aliasPath of pathAliases) {
      for (const lookupKey of buildPathLookupKeys(aliasPath)) {
        registerAlias(lookupKey, mapping);
      }
    }
  }
  return {
    fileMappings,
    fileAliases,
    globalChunkIdMap,
    globalHintMap,
    globalHintWithFileMap,
    globalAnchorBuckets,
    globalSegmentBuckets
  };
};

/**
 * Resolve file mapping using normalized path aliases.
 *
 * @param {IncrementalChunkMappingIndex} mappingIndex
 * @param {string} filePath
 * @returns {FileChunkMapping|null}
 */
export const resolveChunkFileMapping = (mappingIndex, filePath) => {
  for (const lookupKey of buildPathLookupKeys(filePath)) {
    const mapping = mappingIndex.fileAliases.get(lookupKey);
    if (mapping) return mapping;
  }
  return null;
};

/**
 * Calculate Manhattan distance between two [start,end] ranges.
 *
 * @param {{chunkStart:number|null,chunkEnd:number|null,candidateStart:number|null,candidateEnd:number|null}} input
 * @returns {number|null}
 */
const distanceForRanges = ({ chunkStart, chunkEnd, candidateStart, candidateEnd }) => {
  if (
    chunkStart == null
    || chunkEnd == null
    || candidateStart == null
    || candidateEnd == null
  ) {
    return null;
  }
  return Math.abs(chunkStart - candidateStart) + Math.abs(chunkEnd - candidateEnd);
};

/**
 * Select nearest structural candidate, penalizing kind/name/file mismatches.
 *
 * @param {{candidates:MappingEntry[]|undefined,chunk:object|null,normalizedFile:string}} input
 * @returns {{accepted:boolean,hasCandidates:boolean,vectorIndex:number|null,boundaryDistance?:number|null,boundaryThreshold?:number}}
 */
const resolveNearestStructuralCandidate = ({
  candidates,
  chunk,
  normalizedFile
}) => {
  if (!Array.isArray(candidates) || !candidates.length) {
    return { accepted: false, hasCandidates: false, vectorIndex: null };
  }
  const kind = normalizeMappingString(chunk?.kind || chunk?.metaV2?.kind);
  const name = normalizeMappingString(chunk?.name || chunk?.metaV2?.name);
  const start = normalizeRangeBoundary(chunk?.start);
  const end = normalizeRangeBoundary(chunk?.end);
  const span = start != null && end != null ? Math.max(1, end - start) : 1;
  const boundaryThreshold = Math.max(24, Math.floor(span * 0.75));
  let best = null;
  for (const candidate of candidates) {
    const boundaryDistance = distanceForRanges({
      chunkStart: start,
      chunkEnd: end,
      candidateStart: candidate?.start,
      candidateEnd: candidate?.end
    });
    let penalty = 0;
    if (kind && candidate?.kind && kind !== candidate.kind) {
      penalty += 512;
    }
    if (name && candidate?.name && name !== candidate.name) {
      penalty += 128;
    }
    if (normalizedFile && candidate?.filePath && normalizedFile !== candidate.filePath) {
      penalty += 64;
    }
    const score = (boundaryDistance == null ? 0 : boundaryDistance) + penalty;
    const boundarySort = boundaryDistance == null ? Number.MAX_SAFE_INTEGER : boundaryDistance;
    if (!best) {
      best = {
        candidate,
        score,
        penalty,
        boundaryDistance,
        boundarySort
      };
      continue;
    }
    if (score !== best.score) {
      if (score < best.score) {
        best = {
          candidate,
          score,
          penalty,
          boundaryDistance,
          boundarySort
        };
      }
      continue;
    }
    if (boundarySort !== best.boundarySort) {
      if (boundarySort < best.boundarySort) {
        best = {
          candidate,
          score,
          penalty,
          boundaryDistance,
          boundarySort
        };
      }
      continue;
    }
    if ((candidate?.index ?? Number.MAX_SAFE_INTEGER) < (best.candidate?.index ?? Number.MAX_SAFE_INTEGER)) {
      best = {
        candidate,
        score,
        penalty,
        boundaryDistance,
        boundarySort
      };
    }
  }
  if (!best || best.candidate?.index == null) {
    return { accepted: false, hasCandidates: false, vectorIndex: null };
  }
  const hasBoundaryDistance = best.boundaryDistance != null;
  const accepted = hasBoundaryDistance
    ? best.boundaryDistance <= boundaryThreshold && best.penalty <= 256
    : best.penalty <= 128;
  return {
    accepted,
    hasCandidates: true,
    vectorIndex: best.candidate.index,
    boundaryDistance: best.boundaryDistance,
    boundaryThreshold
  };
};

/**
 * Resolve vector index for an incremental bundle chunk using increasingly loose
 * matching strategies (id, hints, structural buckets, then fallback cursor).
 *
 * @param {{
 *   chunk:object|null,
 *   normalizedFile:string,
 *   fileMapping:FileChunkMapping|null,
 *   mappingIndex:IncrementalChunkMappingIndex,
 *   fallbackState:{cursor:number}
 * }} input
 * @returns {BundleChunkVectorResolution}
 */
export const resolveBundleChunkVectorIndex = ({
  chunk,
  normalizedFile,
  fileMapping,
  mappingIndex,
  fallbackState
}) => {
  const numericChunkId = toChunkIndex(chunk?.id);
  if (numericChunkId != null && fileMapping?.chunkMap.has(numericChunkId)) {
    return {
      vectorIndex: fileMapping.chunkMap.get(numericChunkId),
      reason: null
    };
  }

  const stableChunkId = resolveExplicitChunkId(chunk);
  if (stableChunkId) {
    const localStableIdIndex = fileMapping?.chunkIdMap.get(stableChunkId);
    if (localStableIdIndex != null) {
      return { vectorIndex: localStableIdIndex, reason: null };
    }
    const globalStableIdIndex = mappingIndex.globalChunkIdMap.get(stableChunkId);
    if (globalStableIdIndex != null) {
      return { vectorIndex: globalStableIdIndex, reason: null };
    }
  }

  const hintWithFileKey = buildChunkMappingHintKey(chunk, { includeFile: true });
  if (hintWithFileKey) {
    const localHintWithFile = fileMapping?.hintWithFileMap.get(hintWithFileKey);
    if (localHintWithFile != null) {
      return { vectorIndex: localHintWithFile, reason: null };
    }
    const globalHintWithFile = mappingIndex.globalHintWithFileMap.get(hintWithFileKey);
    if (globalHintWithFile != null) {
      return { vectorIndex: globalHintWithFile, reason: null };
    }
  }

  const hintKey = buildChunkMappingHintKey(chunk);
  if (hintKey) {
    const localHint = fileMapping?.hintMap.get(hintKey);
    if (localHint != null) {
      return { vectorIndex: localHint, reason: null };
    }
    const globalHint = mappingIndex.globalHintMap.get(hintKey);
    if (globalHint != null) {
      return { vectorIndex: globalHint, reason: null };
    }
  }

  let sawStructuralCandidates = false;
  const anchor = normalizeMappingString(resolveChunkSegmentAnchor(chunk));
  if (anchor) {
    const localCandidates = fileMapping?.anchorBuckets.get(anchor);
    const localNearest = resolveNearestStructuralCandidate({
      candidates: localCandidates,
      chunk,
      normalizedFile
    });
    if (localNearest.accepted) {
      return { vectorIndex: localNearest.vectorIndex, reason: null };
    }
    sawStructuralCandidates = sawStructuralCandidates || localNearest.hasCandidates;
    const globalCandidates = mappingIndex.globalAnchorBuckets.get(anchor);
    const globalNearest = resolveNearestStructuralCandidate({
      candidates: globalCandidates,
      chunk,
      normalizedFile
    });
    if (globalNearest.accepted) {
      return { vectorIndex: globalNearest.vectorIndex, reason: null };
    }
    sawStructuralCandidates = sawStructuralCandidates || globalNearest.hasCandidates;
  }

  const segmentUid = normalizeMappingString(resolveChunkSegmentUid(chunk));
  if (segmentUid) {
    const localCandidates = fileMapping?.segmentBuckets.get(segmentUid);
    const localNearest = resolveNearestStructuralCandidate({
      candidates: localCandidates,
      chunk,
      normalizedFile
    });
    if (localNearest.accepted) {
      return { vectorIndex: localNearest.vectorIndex, reason: null };
    }
    sawStructuralCandidates = sawStructuralCandidates || localNearest.hasCandidates;
    const globalCandidates = mappingIndex.globalSegmentBuckets.get(segmentUid);
    const globalNearest = resolveNearestStructuralCandidate({
      candidates: globalCandidates,
      chunk,
      normalizedFile
    });
    if (globalNearest.accepted) {
      return { vectorIndex: globalNearest.vectorIndex, reason: null };
    }
    sawStructuralCandidates = sawStructuralCandidates || globalNearest.hasCandidates;
  }

  if (fileMapping && fallbackState.cursor < fileMapping.fallbackIndices.length) {
    const fallbackIndex = fileMapping.fallbackIndices[fallbackState.cursor];
    fallbackState.cursor += 1;
    if (fallbackIndex != null) {
      return { vectorIndex: fallbackIndex, reason: null };
    }
  }
  if (numericChunkId != null) {
    return { vectorIndex: numericChunkId, reason: null };
  }

  const hasStructuralHints = Boolean(stableChunkId || hintWithFileKey || hintKey || anchor || segmentUid);
  if (sawStructuralCandidates) {
    return { vectorIndex: null, reason: 'boundaryMismatch' };
  }
  if (!fileMapping) {
    return { vectorIndex: null, reason: 'missingParent' };
  }
  if (!hasStructuralHints) {
    return { vectorIndex: null, reason: 'parserOmission' };
  }
  return { vectorIndex: null, reason: 'parserOmission' };
};




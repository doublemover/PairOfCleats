import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbedder } from '../../../src/index/embedding.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../../src/index/build/build-state.js';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { loadIncrementalManifest, writeIncrementalManifest } from '../../../src/storage/sqlite/incremental.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
import { resolveQuantizationParams } from '../../../src/storage/sqlite/quantization.js';
import {
  loadChunkMetaRows,
  loadFileMetaRows,
  readJsonFile,
  MAX_JSON_BYTES
} from '../../../src/shared/artifact-io.js';
import { readTextFileWithHash } from '../../../src/shared/encoding.js';
import { createTempPath, replaceFile, writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { resolveHnswPaths, resolveHnswTarget } from '../../../src/shared/hnsw.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths, resolveLanceDbTarget } from '../../../src/shared/lancedb.js';
import { DEFAULT_STUB_DIMS, resolveStubDims } from '../../../src/shared/embedding.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  clampQuantizedVectorsInPlace,
  normalizeEmbeddingVectorInPlace
} from '../../../src/shared/embedding-utils.js';
import { resolveEmbeddingInputFormatting } from '../../../src/shared/embedding-input-format.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings.js';
import { fromPosix, toPosix } from '../../../src/shared/files.js';
import { getEnvConfig, isTestingEnv } from '../../../src/shared/env.js';
import { normalizeDenseVectorMode } from '../../../src/shared/dense-vector-mode.js';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { runWithConcurrency } from '../../../src/shared/concurrency.js';
import {
  normalizeBundleFormat,
  readBundleFile,
  resolveBundleFilename,
  resolveBundleFormatFromName,
  writeBundleFile
} from '../../../src/shared/bundle-io.js';
import {
  getCurrentBuildInfo,
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  getTriageConfig,
  resolveIndexRoot,
  resolveSqlitePaths
} from '../../shared/dict-utils.js';
import {
  buildChunkHashesFingerprint,
  buildCacheIdentity,
  buildCacheKey,
  createShardAppendHandlePool,
  encodeCacheEntryPayload,
  isCacheValid,
  readCacheIndex,
  readCacheMeta,
  readCacheEntry,
  resolveCacheDir,
  resolveCacheRoot,
  shouldFastRejectCacheLookup,
  updateCacheIndexAccess,
  upsertCacheIndexEntry,
  writeCacheEntry,
  writeCacheMeta
} from './cache.js';
import { flushCacheIndexIfNeeded } from './cache-flush.js';
import { buildChunkSignature, buildChunksFromBundles } from './chunks.js';
import {
  assertVectorArrays,
  buildQuantizedVectors,
  createDimsValidator,
  ensureVectorArrays,
  fillMissingVectors,
  isDimsMismatch,
  runBatched,
  validateCachedDims
} from './embed.js';
import { writeHnswBackends, writeLanceDbBackends } from './backends.js';
import { createHnswBuilder } from './hnsw.js';
import { updatePieceManifest } from './manifest.js';
import { createFileEmbeddingsProcessor } from './pipeline.js';
import { createEmbeddingsScheduler } from './scheduler.js';
import { createBoundedWriterQueue } from './writer-queue.js';
import { updateSqliteDense } from './sqlite-dense.js';
import {
  createDeterministicFileStreamSampler,
  selectDeterministicFileSample
} from './sampling.js';
import {
  normalizeEmbeddingsMaintenanceConfig,
  shouldQueueSqliteMaintenance
} from './maintenance.js';
import { createBuildEmbeddingsContext } from './context.js';
import { loadIndexState, writeIndexState } from './state.js';
import {
  normalizeExtractedProseLowYieldBailoutConfig,
  selectDeterministicWarmupSample
} from '../../../src/index/chunking/formats/document-common.js';
import {
  buildChunkMappingHintKey,
  resolveChunkSegmentAnchor,
  resolveChunkSegmentUid,
  resolveChunkStableFilePath
} from '../../../src/index/chunk-id.js';

const EMBEDDINGS_TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPACT_SQLITE_SCRIPT = path.join(EMBEDDINGS_TOOLS_DIR, '..', 'compact-sqlite-index.js');
const DEFAULT_EMBEDDINGS_CHUNK_META_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_EMBEDDINGS_PROGRESS_HEARTBEAT_MS = 1500;
const DEFAULT_EMBEDDINGS_FILE_PARALLELISM = 2;

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

const toChunkIndex = (value) => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const index = Math.floor(numeric);
  return index >= 0 ? index : null;
};

const toUint8Vector = (value) => {
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

const hasVectorPayload = (value) => (
  (Array.isArray(value) && value.length > 0)
  || (ArrayBuffer.isView(value) && !(value instanceof DataView) && value.length > 0)
);

const vectorsEqual = (left, right) => {
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

const createMappingFailureReasons = () => ({
  boundaryMismatch: 0,
  missingParent: 0,
  parserOmission: 0
});

const recordMappingFailureReason = (reasons, reason) => {
  const key = MAPPING_FAILURE_REASON_KEYS.includes(reason) ? reason : 'parserOmission';
  reasons[key] += 1;
  return key;
};

const formatMappingFailureReasons = (reasons) => MAPPING_FAILURE_REASON_KEYS
  .map((reason) => `${reason}:${Number(reasons?.[reason] || 0)}`)
  .join('|');

const normalizeMappingString = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || '';
};

const resolveExplicitChunkId = (chunk) => normalizeMappingString(
  chunk?.metaV2?.chunkId || chunk?.chunkId
);

const normalizeMappingPath = (value) => {
  const normalized = toPosix(value);
  return normalizeMappingString(normalized);
};

const normalizeRangeBoundary = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
};

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

const pushMappingBucket = (bucketMap, key, entry) => {
  if (!key) return;
  if (!bucketMap.has(key)) {
    bucketMap.set(key, []);
  }
  bucketMap.get(key).push(entry);
};

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

const createIncrementalChunkMappingIndex = (chunksByFile) => {
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

const resolveChunkFileMapping = (mappingIndex, filePath) => {
  for (const lookupKey of buildPathLookupKeys(filePath)) {
    const mapping = mappingIndex.fileAliases.get(lookupKey);
    if (mapping) return mapping;
  }
  return null;
};

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

const resolveBundleChunkVectorIndex = ({
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

const toPositiveIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(1, Math.floor(numeric));
};

const resolveEmbeddingsChunkMetaMaxBytes = (indexingConfig) => {
  const configured = Number(indexingConfig?.embeddings?.chunkMetaMaxBytes);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(MAX_JSON_BYTES, Math.floor(configured));
  }
  return Math.max(MAX_JSON_BYTES, DEFAULT_EMBEDDINGS_CHUNK_META_MAX_BYTES);
};

const resolveEmbeddingsProgressHeartbeatMs = (indexingConfig) => {
  const configured = Number(indexingConfig?.embeddings?.progressHeartbeatMs);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1000, Math.floor(configured));
  }
  return DEFAULT_EMBEDDINGS_PROGRESS_HEARTBEAT_MS;
};

const resolveEmbeddingsFileParallelism = ({
  indexingConfig,
  computeTokensTotal,
  hnswEnabled
}) => {
  if (hnswEnabled) return 1;
  const configured = toPositiveIntOrNull(indexingConfig?.embeddings?.fileParallelism);
  if (configured) return configured;
  const tokenDriven = Math.max(
    DEFAULT_EMBEDDINGS_FILE_PARALLELISM,
    Math.min(4, Number.isFinite(Number(computeTokensTotal)) ? Math.floor(Number(computeTokensTotal)) : 1)
  );
  return Math.max(1, tokenDriven);
};

const isChunkMetaTooLargeError = (err) => {
  const code = String(err?.code || '');
  if (code === 'ERR_JSON_TOO_LARGE' || code === 'ERR_ARTIFACT_TOO_LARGE') {
    return true;
  }
  const message = String(err?.message || '').toLowerCase();
  return message.includes('exceeds maxbytes');
};

const isMissingArtifactError = (err, artifactBaseName) => {
  const code = String(err?.code || '');
  if (code === 'ERR_MANIFEST_ENTRY_MISSING') return true;
  const message = String(err?.message || '').toLowerCase();
  const baseName = String(artifactBaseName || '').toLowerCase();
  if (!baseName) return false;
  return message.includes(`missing manifest entry for ${baseName}`)
    || message.includes(`missing index artifact: ${baseName}.json`);
};

const compactChunkMetaV2ForEmbeddings = (metaV2) => {
  if (!metaV2 || typeof metaV2 !== 'object') return null;
  const out = {};
  if (typeof metaV2.chunkId === 'string' && metaV2.chunkId) out.chunkId = metaV2.chunkId;
  if (typeof metaV2.file === 'string' && metaV2.file) out.file = metaV2.file;
  if (typeof metaV2.kind === 'string' && metaV2.kind) out.kind = metaV2.kind;
  if (typeof metaV2.name === 'string' && metaV2.name) out.name = metaV2.name;
  if (typeof metaV2.doc === 'string' && metaV2.doc) out.doc = metaV2.doc;
  const segment = metaV2.segment && typeof metaV2.segment === 'object'
    ? metaV2.segment
    : null;
  if (segment) {
    const compactSegment = {};
    if (typeof segment.anchor === 'string' && segment.anchor) {
      compactSegment.anchor = segment.anchor;
    }
    if (typeof segment.segmentUid === 'string' && segment.segmentUid) {
      compactSegment.segmentUid = segment.segmentUid;
    }
    if (Object.keys(compactSegment).length) {
      out.segment = compactSegment;
    }
  }
  return Object.keys(out).length ? out : null;
};

const compactChunkForEmbeddings = (chunk, filePath) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
  const endRaw = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
  const end = endRaw >= start ? endRaw : start;
  const out = {
    start,
    end
  };
  const chunkId = toChunkIndex(chunk.id);
  if (chunkId != null) out.id = chunkId;
  if (typeof filePath === 'string' && filePath) {
    out.file = filePath;
  } else if (typeof chunk.file === 'string' && chunk.file) {
    out.file = chunk.file;
  }
  if (typeof chunk.kind === 'string' && chunk.kind) out.kind = chunk.kind;
  if (typeof chunk.name === 'string' && chunk.name) out.name = chunk.name;
  if (typeof chunk.chunkId === 'string' && chunk.chunkId) out.chunkId = chunk.chunkId;
  const docText = typeof chunk?.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
  if (docText) {
    out.docmeta = { doc: docText };
  }
  const segment = chunk.segment && typeof chunk.segment === 'object' ? chunk.segment : null;
  if (segment) {
    const compactSegment = {};
    if (typeof segment.anchor === 'string' && segment.anchor) {
      compactSegment.anchor = segment.anchor;
    }
    if (typeof segment.segmentUid === 'string' && segment.segmentUid) {
      compactSegment.segmentUid = segment.segmentUid;
    }
    if (Object.keys(compactSegment).length) {
      out.segment = compactSegment;
    }
  }
  const compactMetaV2 = compactChunkMetaV2ForEmbeddings(chunk.metaV2);
  if (compactMetaV2) {
    out.metaV2 = compactMetaV2;
  }
  return out;
};

const formatEta = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h${String(remMins).padStart(2, '0')}m`;
  }
  return `${mins}m${String(secs).padStart(2, '0')}s`;
};

/**
 * Resolve deterministic embeddings sampling config.
 *
 * Sampling is opt-in and intended for smoke/benchmark workflows where we need
 * representative model behavior without embedding every file.
 *
 * @param {{embeddingsConfig?:object,env?:object}} [input]
 * @returns {{maxFiles:number|null,seed:string}}
 */
const resolveEmbeddingSamplingConfig = ({ embeddingsConfig, env } = {}) => {
  const configRaw = Number(embeddingsConfig?.sampleFiles);
  const envRaw = Number(env?.embeddingsSampleFiles);
  const maxFiles = toPositiveIntOrNull(Number.isFinite(envRaw) ? envRaw : configRaw);
  const configSeed = typeof embeddingsConfig?.sampleSeed === 'string'
    ? embeddingsConfig.sampleSeed.trim()
    : '';
  const envSeed = typeof env?.embeddingsSampleSeed === 'string'
    ? env.embeddingsSampleSeed.trim()
    : '';
  const seed = envSeed || configSeed || 'default';
  return { maxFiles, seed };
};

/**
 * Inline HNSW builders are fed during per-file embedding compute and therefore
 * only observe processed files. When sampling is active we must defer HNSW
 * construction until after missing vectors are filled so backend counts remain
 * aligned with chunk_meta length for validation.
 *
 * @param {{enabled:boolean,hnswIsolate:boolean,samplingActive:boolean}} input
 * @returns {boolean}
 */
const shouldUseInlineHnswBuilders = ({ enabled, hnswIsolate, samplingActive }) => (
  enabled === true && hnswIsolate !== true && samplingActive !== true
);

const refreshIncrementalBundlesWithEmbeddings = async ({
  mode,
  incremental,
  chunksByFile,
  mergedVectors,
  embeddingMode,
  embeddingIdentityKey,
  lowYieldBailout,
  scheduleIo,
  log,
  warn
}) => {
  if (!incremental?.manifest || !incremental?.bundleDir || !incremental?.manifestPath) {
    return { attempted: 0, rewritten: 0, manifestWritten: false, completeCoverage: false };
  }
  const manifest = incremental.manifest;
  const manifestFiles = manifest.files && typeof manifest.files === 'object'
    ? manifest.files
    : {};
  const manifestEntries = Object.entries(manifestFiles)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  if (!manifestEntries.length) {
    return { attempted: 0, rewritten: 0, manifestWritten: false, completeCoverage: false };
  }

  const mappingIndex = createIncrementalChunkMappingIndex(chunksByFile);

  const resolvedBundleFormat = normalizeBundleFormat(manifest.bundleFormat);
  const scanned = manifestEntries.length;
  const lowYieldConfig = normalizeExtractedProseLowYieldBailoutConfig(lowYieldBailout);
  const lowYieldEnabled = mode === 'extracted-prose' && lowYieldConfig.enabled !== false;
  const warmupWindowSize = lowYieldEnabled
    ? Math.max(1, Math.min(scanned, Math.floor(lowYieldConfig.warmupWindowSize)))
    : 0;
  const warmupWindowEntries = lowYieldEnabled
    ? manifestEntries.slice(0, warmupWindowSize)
    : [];
  const warmupSampleSize = lowYieldEnabled
    ? Math.max(0, Math.min(warmupWindowEntries.length, Math.floor(lowYieldConfig.warmupSampleSize)))
    : 0;
  const sampledWarmupEntries = lowYieldEnabled
    ? selectDeterministicWarmupSample({
      values: warmupWindowEntries,
      sampleSize: warmupSampleSize,
      seed: lowYieldConfig.seed,
      resolveKey: (entry) => entry?.[0] || ''
    })
    : [];
  const sampledWarmupFiles = new Set(sampledWarmupEntries.map((entry) => toPosix(entry?.[0])));
  const observedWarmupFiles = new Set();
  let warmupObserved = 0;
  let warmupMapped = 0;
  let lowYieldDecisionMade = false;
  let lowYieldBailoutTriggered = false;
  let lowYieldBailoutSkipped = 0;
  let lowYieldBailoutSummary = null;
  let processedEntries = 0;
  let eligible = 0;
  let rewritten = 0;
  let covered = 0;
  let skippedNoMapping = 0;
  let skippedNoMappingChunks = 0;
  const mappingFailureReasons = createMappingFailureReasons();
  let skippedInvalidBundle = 0;
  let skippedEmptyBundle = 0;

  for (const [filePath, entry] of manifestEntries) {
    if (lowYieldBailoutTriggered) break;
    processedEntries += 1;
    const normalizedFile = normalizeMappingPath(filePath);
    const chunkMapping = resolveChunkFileMapping(mappingIndex, normalizedFile);
    if (
      lowYieldEnabled
      && sampledWarmupFiles.has(normalizedFile)
      && !observedWarmupFiles.has(normalizedFile)
    ) {
      observedWarmupFiles.add(normalizedFile);
      warmupObserved += 1;
      if (chunkMapping) warmupMapped += 1;
      if (!lowYieldDecisionMade && warmupObserved >= warmupSampleSize) {
        lowYieldDecisionMade = true;
        const observedYieldRatio = warmupObserved > 0 ? warmupMapped / warmupObserved : 0;
        const minYieldedFiles = Math.min(
          Math.max(1, Math.floor(Number(lowYieldConfig.minYieldedFiles) || 1)),
          Math.max(1, warmupObserved)
        );
        lowYieldBailoutTriggered = observedYieldRatio < lowYieldConfig.minYieldRatio
          && warmupMapped < minYieldedFiles;
        lowYieldBailoutSummary = {
          enabled: lowYieldEnabled,
          triggered: lowYieldBailoutTriggered,
          seed: lowYieldConfig.seed,
          warmupWindowSize,
          warmupSampleSize,
          sampledFiles: warmupObserved,
          sampledMappedFiles: warmupMapped,
          observedYieldRatio,
          minYieldRatio: lowYieldConfig.minYieldRatio,
          minYieldedFiles
        };
      }
    }
    const bundleName = entry?.bundle || resolveBundleFilename(filePath, resolvedBundleFormat);
    const bundlePath = path.join(incremental.bundleDir, bundleName);
    const bundleFormat = resolveBundleFormatFromName(bundleName, resolvedBundleFormat);
    let existing = null;
    try {
      existing = await scheduleIo(() => readBundleFile(bundlePath, { format: bundleFormat }));
    } catch {
      existing = null;
    }
    if (!existing?.ok || !Array.isArray(existing.bundle?.chunks)) {
      skippedInvalidBundle += 1;
      continue;
    }

    const bundle = existing.bundle;
    if (!bundle.chunks.length) {
      skippedEmptyBundle += 1;
      continue;
    }
    eligible += 1;
    const fallbackState = { cursor: 0 };
    let changed = false;
    let fileCovered = true;
    let fileNoMappingCounted = false;

    for (const chunk of bundle.chunks) {
      if (!chunk || typeof chunk !== 'object') continue;
      const mappingResult = resolveBundleChunkVectorIndex({
        chunk,
        normalizedFile,
        fileMapping: chunkMapping,
        mappingIndex,
        fallbackState
      });
      const vectorIndex = mappingResult.vectorIndex;
      const vector = vectorIndex != null ? mergedVectors[vectorIndex] : null;
      if (hasVectorPayload(vector)) {
        const quantized = toUint8Vector(vector);
        if (quantized && !vectorsEqual(chunk.embedding_u8, quantized)) {
          chunk.embedding_u8 = quantized;
          changed = true;
        }
      }
      if (chunk.embedding !== undefined) {
        delete chunk.embedding;
        changed = true;
      }
      if (!hasVectorPayload(chunk.embedding_u8)) {
        fileCovered = false;
        if (vectorIndex == null) {
          skippedNoMappingChunks += 1;
          recordMappingFailureReason(mappingFailureReasons, mappingResult.reason);
          if (!fileNoMappingCounted) {
            skippedNoMapping += 1;
            fileNoMappingCounted = true;
          }
        }
      }
    }

    if (!changed) {
      if (fileCovered) covered += 1;
      continue;
    }
    try {
      await scheduleIo(() => writeBundleFile({
        bundlePath,
        bundle,
        format: bundleFormat
      }));
      rewritten += 1;
      if (fileCovered) covered += 1;
    } catch (err) {
      warn(`[embeddings] ${mode}: failed to refresh bundle ${filePath}: ${err?.message || err}`);
    }
  }

  if (lowYieldBailoutTriggered) {
    lowYieldBailoutSkipped = Math.max(0, scanned - processedEntries);
  }

  const completeCoverage = eligible > 0
    ? covered === eligible
    : skippedInvalidBundle === 0;
  let manifestWritten = false;
  if (completeCoverage) {
    manifest.bundleEmbeddings = true;
    manifest.bundleEmbeddingMode = embeddingMode || manifest.bundleEmbeddingMode || null;
    manifest.bundleEmbeddingIdentityKey = embeddingIdentityKey || manifest.bundleEmbeddingIdentityKey || null;
    manifest.bundleEmbeddingStage = 'stage3';
    manifestWritten = await scheduleIo(
      () => writeIncrementalManifest(incremental.manifestPath, manifest)
    );
    if (!manifestWritten) {
      warn(`[embeddings] ${mode}: failed to persist incremental manifest embedding metadata.`);
    }
  }

  if (scanned > 0) {
    const skippedNotes = [];
    if (skippedNoMapping > 0) skippedNotes.push(`noMapping=${skippedNoMapping}`);
    if (skippedNoMappingChunks > 0) skippedNotes.push(`noMappingChunks=${skippedNoMappingChunks}`);
    if (skippedNoMappingChunks > 0) {
      skippedNotes.push(`noMappingReasons=${formatMappingFailureReasons(mappingFailureReasons)}`);
    }
    if (skippedEmptyBundle > 0) skippedNotes.push(`empty=${skippedEmptyBundle}`);
    if (skippedInvalidBundle > 0) skippedNotes.push(`invalid=${skippedInvalidBundle}`);
    if (lowYieldBailoutSkipped > 0) skippedNotes.push(`lowYieldBailout=${lowYieldBailoutSkipped}`);
    const skippedSuffix = skippedNotes.length ? ` (skipped ${skippedNotes.join(', ')})` : '';
    const coverageText = eligible > 0 ? `${covered}/${eligible}` : 'n/a';
    log(
      `[embeddings] ${mode}: refreshed ${rewritten}/${eligible} eligible incremental bundles; ` +
      `embedding coverage ${coverageText}${skippedSuffix}.`
    );
    if (lowYieldBailoutTriggered) {
      const ratioPct = ((lowYieldBailoutSummary?.observedYieldRatio || 0) * 100).toFixed(1);
      warn(
        `[embeddings] ${mode}: low-yield bailout engaged after ${warmupObserved} warmup files `
          + `(mapped=${warmupMapped}, ratio=${ratioPct}%, `
          + `threshold=${Math.round(lowYieldConfig.minYieldRatio * 100)}%); `
          + 'quality marker: reduced-extracted-prose-recall.'
      );
    }
  }
  return {
    attempted: eligible,
    eligible,
    rewritten,
    covered,
    scanned,
    skippedNoMapping,
    skippedNoMappingChunks,
    mappingFailureReasons,
    skippedInvalidBundle,
    skippedEmptyBundle,
    lowYieldBailoutSkipped,
    lowYieldBailout: lowYieldBailoutSummary,
    manifestWritten,
    completeCoverage
  };
};

/**
 * Kick off the `pairofcleats build embeddings` workflow using normalized runtime config.
 * @param {{
 *   argv:string[],
 *   root:string,
 *   userConfig:object,
 *   envConfig:object,
 *   indexingConfig:object,
 *   rawArgv:string[],
 *   embeddingsConfig:object,
 *   embeddingProvider:object|null,
 *   embeddingOnnx:object|null,
 *   hnswConfig:object,
 *   normalizedEmbeddingMode:string,
 *   resolvedEmbeddingMode:string,
 *   useStubEmbeddings:boolean,
 *   embeddingBatchSize:number,
 *   configuredDims:number|null,
 *   modelId:string|null,
 *   modelsDir:string|null,
 *   indexRoot:string,
 *   modes:string[]
 * }} config
 * @returns {Promise<void>}
 */
export async function runBuildEmbeddingsWithConfig(config) {
  const {
    argv,
    root,
    userConfig,
    envConfig: configEnv,
    indexingConfig,
    rawArgv,
    embeddingsConfig,
    embeddingProvider,
    embeddingOnnx,
    hnswConfig,
    normalizedEmbeddingMode,
    resolvedEmbeddingMode,
    useStubEmbeddings,
    embeddingBatchSize,
    configuredDims,
    modelId,
    modelsDir,
    indexRoot,
    modes
  } = config;
  const {
    display,
    log,
    warn,
    error,
    logger,
    fail,
    finalize,
    setHeartbeat
  } = createBuildEmbeddingsContext({ argv });
  const embeddingNormalize = embeddingsConfig.normalize !== false;
  const extractedProseLowYieldBailout = normalizeExtractedProseLowYieldBailoutConfig(
    indexingConfig?.extractedProse?.lowYieldBailout
  );
  const embeddingSampling = resolveEmbeddingSamplingConfig({ embeddingsConfig, env: configEnv });
  const isVectorLike = (value) => {
    if (Array.isArray(value)) return true;
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
  };
  const isNonEmptyVector = (value) => isVectorLike(value) && value.length > 0;
  const countNonEmptyVectors = (vectors) => {
    if (!Array.isArray(vectors)) return 0;
    let count = 0;
    for (const vec of vectors) {
      if (vec && typeof vec.length === 'number' && vec.length > 0) count += 1;
    }
    return count;
  };
  const writeDenseVectorArtifacts = async ({
    indexDir,
    baseName,
    vectorFields,
    vectors,
    shardMaxBytes = 8 * 1024 * 1024,
    writeBinary = false
  }) => {
    const jsonPath = path.join(indexDir, `${baseName}.json`);
    await writeJsonObjectFile(jsonPath, {
      fields: vectorFields,
      arrays: { vectors },
      atomic: true
    });
    const rowIterable = {
      [Symbol.iterator]: function* iterateRows() {
        for (let i = 0; i < vectors.length; i += 1) {
          yield { vector: vectors[i] };
        }
      }
    };
    const sharded = await writeJsonLinesSharded({
      dir: indexDir,
      partsDirName: `${baseName}.parts`,
      partPrefix: `${baseName}.part-`,
      items: rowIterable,
      maxBytes: shardMaxBytes,
      atomic: true,
      offsets: { suffix: 'offsets.bin' }
    });
    const parts = sharded.parts.map((part, index) => ({
      path: part,
      records: sharded.counts[index] || 0,
      bytes: sharded.bytes[index] || 0
    }));
    const metaPath = path.join(indexDir, `${baseName}.meta.json`);
    await writeJsonObjectFile(metaPath, {
      fields: {
        schemaVersion: '1.0.0',
        artifact: baseName,
        format: 'jsonl-sharded',
        generatedAt: new Date().toISOString(),
        compression: 'none',
        totalRecords: sharded.total,
        totalBytes: sharded.totalBytes,
        maxPartRecords: sharded.maxPartRecords,
        maxPartBytes: sharded.maxPartBytes,
        targetMaxBytes: sharded.targetMaxBytes,
        parts,
        offsets: sharded.offsets || [],
        ...vectorFields
      },
      atomic: true
    });
    let binPath = null;
    let binMetaPath = null;
    if (writeBinary) {
      const dims = Number(vectorFields?.dims);
      const count = Array.isArray(vectors) ? vectors.length : 0;
      const rowWidth = Number.isFinite(dims) && dims > 0 ? Math.floor(dims) : 0;
      const totalBytes = rowWidth > 0 ? rowWidth * count : 0;
      const bytes = Buffer.alloc(totalBytes);
      for (let docId = 0; docId < count; docId += 1) {
        const vec = vectors[docId];
        if (!vec || typeof vec.length !== 'number') continue;
        const start = docId * rowWidth;
        const end = start + rowWidth;
        if (end > bytes.length) break;
        if (ArrayBuffer.isView(vec) && vec.BYTES_PER_ELEMENT === 1) {
          bytes.set(vec.subarray(0, rowWidth), start);
          continue;
        }
        for (let i = 0; i < rowWidth; i += 1) {
          const value = Number(vec[i]);
          bytes[start + i] = Number.isFinite(value)
            ? Math.max(0, Math.min(255, Math.floor(value)))
            : 0;
        }
      }
      binPath = path.join(indexDir, `${baseName}.bin`);
      const tempBinPath = createTempPath(binPath);
      await fs.writeFile(tempBinPath, bytes);
      await replaceFile(tempBinPath, binPath);
      binMetaPath = path.join(indexDir, `${baseName}.bin.meta.json`);
      await writeJsonObjectFile(binMetaPath, {
        fields: {
          schemaVersion: '1.0.0',
          artifact: baseName,
          format: 'uint8-row-major',
          generatedAt: new Date().toISOString(),
          path: path.basename(binPath),
          count,
          dims: rowWidth,
          bytes: totalBytes,
          ...vectorFields
        },
        atomic: true
      });
    }
    return { jsonPath, metaPath, binPath, binMetaPath };
  };
  const lanceConfig = normalizeLanceDbConfig(embeddingsConfig.lancedb || {});
  const binaryDenseVectors = embeddingsConfig.binaryDenseVectors !== false;
  const hnswIsolateOverride = typeof embeddingsConfig?.hnsw?.isolate === 'boolean'
    ? embeddingsConfig.hnsw.isolate
    : null;
  const denseVectorMode = normalizeDenseVectorMode(userConfig?.search?.denseVectorMode, 'merged');
  const readJsonOptional = (filePath) => {
    if (!filePath || !fsSync.existsSync(filePath)) return null;
    try {
      return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
    } catch {
      return null;
    }
  };
  const traceArtifactIo = (configEnv || getEnvConfig()).traceArtifactIo === true;
  const hasArtifactFile = (filePath) => (
    fsSync.existsSync(filePath)
    || fsSync.existsSync(`${filePath}.gz`)
    || fsSync.existsSync(`${filePath}.zst`)
    || fsSync.existsSync(`${filePath}.bak`)
  );
  const logArtifactLocation = (mode, label, filePath) => {
    if (!traceArtifactIo) return;
    const exists = hasArtifactFile(filePath);
    log(`[embeddings] ${mode}: artifact ${label} path=${filePath} exists=${exists}`);
  };
  const logExpectedArtifacts = (mode, indexDir, stageLabel) => {
    if (!traceArtifactIo) return;
    const expected = [
      { label: 'chunk_meta', path: path.join(indexDir, 'chunk_meta.json') },
      { label: 'chunk_meta_stream', path: path.join(indexDir, 'chunk_meta.jsonl') },
      { label: 'chunk_meta_meta', path: path.join(indexDir, 'chunk_meta.meta.json') },
      { label: 'token_postings', path: path.join(indexDir, 'token_postings.json') },
      { label: 'token_postings_stream', path: path.join(indexDir, 'token_postings.jsonl') },
      { label: 'token_postings_meta', path: path.join(indexDir, 'token_postings.meta.json') },
      { label: 'phrase_ngrams', path: path.join(indexDir, 'phrase_ngrams.json') },
      { label: 'chargram_postings', path: path.join(indexDir, 'chargram_postings.json') },
      { label: 'index_state', path: path.join(indexDir, 'index_state.json') },
      { label: 'filelists', path: path.join(indexDir, '.filelists.json') },
      { label: 'pieces_manifest', path: path.join(indexDir, 'pieces', 'manifest.json') }
    ];
    log(`[embeddings] ${mode}: expected artifact snapshot (${stageLabel})`);
    for (const entry of expected) {
      logArtifactLocation(mode, `${stageLabel}:${entry.label}`, entry.path);
    }
  };
  const BACKEND_ARTIFACT_RELATIVE_PATHS = [
    'dense_vectors_hnsw.bin',
    'dense_vectors_hnsw.meta.json',
    'dense_vectors_doc_hnsw.bin',
    'dense_vectors_doc_hnsw.meta.json',
    'dense_vectors_code_hnsw.bin',
    'dense_vectors_code_hnsw.meta.json',
    'dense_vectors.lancedb',
    'dense_vectors.lancedb.meta.json',
    'dense_vectors_doc.lancedb',
    'dense_vectors_doc.lancedb.meta.json',
    'dense_vectors_code.lancedb',
    'dense_vectors_code.lancedb.meta.json'
  ];
  /**
   * Promote backend-only artifacts from a staging directory into the active
   * index directory. Stage3 uses this to isolate backend writers from the core
   * stage2 artifact surface and then copy only ANN outputs back.
   *
   * @param {{stageDir:string,indexDir:string}} input
   * @returns {Promise<void>}
   */
  const promoteBackendArtifacts = async ({ stageDir, indexDir }) => {
    for (const relPath of BACKEND_ARTIFACT_RELATIVE_PATHS) {
      const sourcePath = path.join(stageDir, relPath);
      if (!fsSync.existsSync(sourcePath)) continue;
      const targetPath = path.join(indexDir, relPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const stat = await fs.lstat(sourcePath).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
        try {
          await fs.rename(sourcePath, targetPath);
        } catch (err) {
          if (!['EXDEV', 'EPERM', 'EACCES'].includes(err?.code)) throw err;
          await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
          await fs.rm(sourcePath, { recursive: true, force: true });
        }
      } else {
        try {
          await fs.rm(`${targetPath}.bak`, { force: true });
        } catch {}
        await replaceFile(sourcePath, targetPath, { keepBackup: true });
      }
    }
  };

  if (embeddingsConfig.enabled === false || resolvedEmbeddingMode === 'off') {
    error('Embeddings disabled; skipping build-embeddings.');
    finalize();
    return { skipped: true };
  }

  const quantization = resolveQuantizationParams(embeddingsConfig.quantization);
  const quantRange = quantization.maxVal - quantization.minVal;
  const quantLevels = Number.isFinite(quantization.levels) ? quantization.levels : 256;
  const denseScale = quantLevels > 1 && Number.isFinite(quantRange) && quantRange !== 0
    ? quantRange / (quantLevels - 1)
    : 2 / 255;
  const cacheDims = useStubEmbeddings ? resolveStubDims(configuredDims) : configuredDims;
  const embeddingInputFormatting = resolveEmbeddingInputFormatting(modelId);
  const resolvedOnnxModelPath = embeddingProvider === 'onnx'
    ? resolveOnnxModelPath({
      rootDir: root,
      modelPath: embeddingOnnx?.modelPath,
      modelsDir,
      modelId
    })
    : null;
  const { identity: cacheIdentity, key: cacheIdentityKey } = buildCacheIdentity({
    modelId,
    provider: embeddingProvider,
    mode: resolvedEmbeddingMode,
    stub: useStubEmbeddings,
    dims: cacheDims,
    scale: denseScale,
    pooling: 'mean',
    normalize: embeddingNormalize,
    truncation: 'truncate',
    maxLength: null,
    inputFormatting: embeddingInputFormatting,
    quantization: {
      version: 1,
      minVal: quantization.minVal,
      maxVal: quantization.maxVal,
      levels: quantization.levels
    },
    onnx: embeddingProvider === 'onnx' ? {
      ...embeddingOnnx,
      resolvedModelPath: resolvedOnnxModelPath
    } : null
  });
  const cacheKeyFlags = [
    embeddingProvider ? `provider:${embeddingProvider}` : null,
    resolvedEmbeddingMode ? `mode:${resolvedEmbeddingMode}` : null,
    embeddingNormalize ? 'normalize' : 'no-normalize',
    useStubEmbeddings ? 'stub' : null
  ].filter(Boolean);

  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const repoCacheRootResolved = path.resolve(repoCacheRoot);
  /**
   * Detect whether the caller explicitly supplied an index root, which means
   * we must fail fast on missing artifacts instead of auto-falling back.
   *
   * @param {Record<string, any>} parsedArgv
   * @param {string[]|unknown} rawArgs
   * @returns {boolean}
   */
  const hasExplicitIndexRootArg = (parsedArgv, rawArgs) => {
    if (typeof parsedArgv?.['index-root'] === 'string' && parsedArgv['index-root'].trim()) return true;
    if (typeof parsedArgv?.indexRoot === 'string' && parsedArgv.indexRoot.trim()) return true;
    if (!Array.isArray(rawArgs) || !rawArgs.length) return false;
    return rawArgs.some((arg) => arg === '--index-root' || arg.startsWith('--index-root='));
  };
  const explicitIndexRoot = hasExplicitIndexRootArg(argv, rawArgv);
  let activeIndexRoot = indexRoot
    ? path.resolve(indexRoot)
    : resolveIndexRoot(root, userConfig, { mode: modes[0] || null });
  const normalizePath = (value) => {
    if (!value) return null;
    const normalized = path.resolve(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const repoCacheRootKey = normalizePath(repoCacheRootResolved);
  const buildsRootKey = normalizePath(path.join(repoCacheRootResolved, 'builds'));
  const hasModeArtifacts = (candidateRoot, mode = null) => {
    if (!candidateRoot || !fsSync.existsSync(candidateRoot)) return false;
    const candidateModes = mode
      ? [mode]
      : (Array.isArray(modes) && modes.length ? modes : ['code', 'prose', 'extracted-prose', 'records']);
    for (const modeName of candidateModes) {
      if (typeof modeName !== 'string' || !modeName) continue;
      const indexDir = path.join(candidateRoot, `index-${modeName}`);
      if (!fsSync.existsSync(indexDir)) continue;
      const hasPiecesManifest = fsSync.existsSync(path.join(indexDir, 'pieces', 'manifest.json'));
      const hasChunkMeta = (
        fsSync.existsSync(path.join(indexDir, 'chunk_meta.json'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.json.gz'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.json.zst'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.jsonl'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.jsonl.gz'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.jsonl.zst'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.meta.json'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.parts'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.columnar.json'))
        || fsSync.existsSync(path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'))
      );
      if (hasPiecesManifest || hasChunkMeta) {
        return true;
      }
    }
    return false;
  };
  const primaryMode = typeof modes?.[0] === 'string' && modes[0] ? modes[0] : null;
  const findLatestModeRoot = (mode = primaryMode) => {
    const buildsRoot = path.join(repoCacheRootResolved, 'builds');
    if (!fsSync.existsSync(buildsRoot)) return null;
    let entries = [];
    try {
      entries = fsSync.readdirSync(buildsRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    const candidates = [];
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const candidateRoot = path.join(buildsRoot, entry.name);
      if (!hasModeArtifacts(candidateRoot, mode)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = Number(fsSync.statSync(candidateRoot).mtimeMs) || 0;
      } catch {}
      candidates.push({ root: candidateRoot, mtimeMs });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.root || null;
  };
  /**
   * Resolve the effective root for a mode. Auto mode can fall back to current
   * build/latest build; explicit --index-root always stays pinned to caller root.
   *
   * @param {string} mode
   * @returns {string|null}
   */
  const resolveModeIndexRoot = (mode) => {
    if (hasModeArtifacts(activeIndexRoot, mode)) return activeIndexRoot;
    if (explicitIndexRoot) return activeIndexRoot;
    const currentBuild = getCurrentBuildInfo(root, userConfig, { mode });
    const currentRoot = currentBuild?.activeRoot || currentBuild?.buildRoot || null;
    if (currentRoot && hasModeArtifacts(currentRoot, mode)) return currentRoot;
    return findLatestModeRoot(mode) || activeIndexRoot;
  };
  if (activeIndexRoot && !explicitIndexRoot) {
    const activeRootKey = normalizePath(activeIndexRoot);
    const underRepoCache = activeRootKey
      && repoCacheRootKey
      && (activeRootKey === repoCacheRootKey || activeRootKey.startsWith(`${repoCacheRootKey}${path.sep}`));
    const needsCurrentBuildRoot = underRepoCache && (
      activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey
      || !hasModeArtifacts(activeIndexRoot, primaryMode)
    );
    if (needsCurrentBuildRoot) {
      const currentBuild = getCurrentBuildInfo(root, userConfig, { mode: modes[0] || null });
      const buildRootCandidate = currentBuild?.buildRoot || null;
      const activeRootCandidate = currentBuild?.activeRoot || null;
      const promotedRoot = hasModeArtifacts(buildRootCandidate, primaryMode)
        ? buildRootCandidate
        : (hasModeArtifacts(activeRootCandidate, primaryMode) ? activeRootCandidate : null);
      const promotedRootKey = normalizePath(promotedRoot);
      if (promotedRoot && promotedRootKey && promotedRootKey !== activeRootKey) {
        activeIndexRoot = promotedRoot;
        log(`[embeddings] using active build root from current.json: ${activeIndexRoot}`);
      }
    }
  }
  if (!explicitIndexRoot && activeIndexRoot && !hasModeArtifacts(activeIndexRoot, primaryMode)) {
    const activeRootKey = normalizePath(activeIndexRoot);
    const allowLatestFallback = !activeRootKey
      || !fsSync.existsSync(activeIndexRoot)
      || activeRootKey === repoCacheRootKey
      || activeRootKey === buildsRootKey;
    if (allowLatestFallback) {
      const fallbackRoot = findLatestModeRoot(primaryMode);
      if (fallbackRoot && normalizePath(fallbackRoot) !== normalizePath(activeIndexRoot)) {
        activeIndexRoot = fallbackRoot;
        log(`[embeddings] index root lacked mode artifacts; using latest build root: ${activeIndexRoot}`);
      }
    }
  }
  const metricsDir = getMetricsDir(root, userConfig);
  const envConfig = configEnv || getEnvConfig();
  const crashLogger = await createCrashLogger({
    repoCacheRoot,
    enabled: true,
    log
  });
  crashLogger.updatePhase('stage3:init');
  let embedder;
  try {
    embedder = createEmbedder({
      rootDir: root,
      useStubEmbeddings,
      modelId,
      dims: argv.dims,
      modelsDir,
      provider: embeddingProvider,
      onnx: embeddingOnnx,
      normalize: embeddingNormalize
    });
  } catch (err) {
    crashLogger.logError({
      phase: 'stage3:init',
      stage: 'embedder',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    throw err;
  }
  const getChunkEmbeddings = embedder.getChunkEmbeddings;
  const resolvedRawArgv = Array.isArray(rawArgv) ? rawArgv : [];
  const { scheduler, scheduleCompute, scheduleIo } = createEmbeddingsScheduler({
    argv,
    rawArgv: resolvedRawArgv,
    userConfig,
    envConfig,
    indexingConfig
  });
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsDir = triageConfig.recordsDir;
  const buildStateTrackers = new Map();
  /**
   * Lazily initialize build-state tracking for each unique build root used by
   * stage3 so mixed-root mode runs emit accurate heartbeat/phase markers.
   *
   * @param {string|null} buildRoot
   * @returns {{
   *   root:string,
   *   hasBuildState:boolean,
   *   runningMarked:boolean,
   *   stopHeartbeat:() => void
   * }|null}
   */
  const ensureBuildStateTracker = (buildRoot) => {
    const key = normalizePath(buildRoot);
    if (!buildRoot || !key) return null;
    if (buildStateTrackers.has(key)) return buildStateTrackers.get(key);
    const buildStatePath = resolveBuildStatePath(buildRoot);
    const hasBuildState = Boolean(buildStatePath && fsSync.existsSync(buildStatePath));
    const tracker = {
      root: buildRoot,
      hasBuildState,
      runningMarked: false,
      stopHeartbeat: hasBuildState ? startBuildHeartbeat(buildRoot, 'stage3') : () => {}
    };
    buildStateTrackers.set(key, tracker);
    return tracker;
  };
  setHeartbeat(() => {
    for (const tracker of buildStateTrackers.values()) {
      try {
        tracker.stopHeartbeat?.();
      } catch {}
    }
  });

  const cacheScopeRaw = embeddingsConfig.cache?.scope;
  const cacheScope = typeof cacheScopeRaw === 'string' ? cacheScopeRaw.trim().toLowerCase() : '';
  const resolvedCacheScope = cacheScope === 'global' ? 'global' : 'repo';
  const cacheRoot = resolveCacheRoot({
    repoCacheRoot,
    cacheDirConfig: embeddingsConfig.cache?.dir,
    scope: resolvedCacheScope
  });
  const cacheMaxGb = Number(embeddingsConfig.cache?.maxGb);
  const cacheMaxAgeDays = Number(embeddingsConfig.cache?.maxAgeDays);
  const cacheMaxBytes = Number.isFinite(cacheMaxGb) ? Math.max(0, cacheMaxGb) * 1024 * 1024 * 1024 : 0;
  const cacheMaxAgeMs = Number.isFinite(cacheMaxAgeDays) ? Math.max(0, cacheMaxAgeDays) * 24 * 60 * 60 * 1000 : 0;
  const maintenanceConfig = normalizeEmbeddingsMaintenanceConfig(embeddingsConfig.maintenance || {});
  const queuedMaintenance = new Set();
  /**
   * Queue detached sqlite maintenance against the same mode-specific db root
   * that stage3 just updated, avoiding maintenance drift across mixed roots.
   *
   * @param {{
   *   mode:string,
   *   denseCount:number,
   *   modeIndexRoot:string|null,
   *   sqlitePathsForMode?:{codePath?:string|null,prosePath?:string|null}|null
   * }} input
   * @returns {void}
   */
  const queueBackgroundSqliteMaintenance = ({ mode, denseCount, modeIndexRoot, sqlitePathsForMode }) => {
    if (maintenanceConfig.background !== true || isTestingEnv()) return;
    if (mode !== 'code' && mode !== 'prose') return;
    const dbPath = mode === 'code' ? sqlitePathsForMode?.codePath : sqlitePathsForMode?.prosePath;
    if (!dbPath || !fsSync.existsSync(dbPath)) return;
    const walPath = `${dbPath}-wal`;
    const dbBytes = Number(fsSync.statSync(dbPath).size) || 0;
    const walBytes = fsSync.existsSync(walPath)
      ? (Number(fsSync.statSync(walPath).size) || 0)
      : 0;
    const decision = shouldQueueSqliteMaintenance({
      config: maintenanceConfig,
      dbBytes,
      walBytes,
      denseCount
    });
    if (!decision.queue) return;
    const key = `${mode}:${dbPath}`;
    if (queuedMaintenance.has(key)) return;
    queuedMaintenance.add(key);
    log(
      `[embeddings] ${mode}: queueing background sqlite maintenance ` +
      `(reason=${decision.reason}, dbBytes=${dbBytes}, walBytes=${walBytes}, denseCount=${denseCount}).`
    );
    const args = [COMPACT_SQLITE_SCRIPT, '--repo', root, '--mode', mode];
    if (typeof modeIndexRoot === 'string' && modeIndexRoot) {
      args.push('--index-root', modeIndexRoot);
    }
    void spawnSubprocess(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: 'ignore',
      detached: true,
      unref: true,
      rejectOnNonZeroExit: false,
      name: `background sqlite compact ${mode}`
    })
      .catch((err) => {
        warn(`[embeddings] ${mode}: background sqlite maintenance failed: ${err?.message || err}`);
      })
      .finally(() => {
        queuedMaintenance.delete(key);
      });
  };

  const modeTask = display.task('Embeddings', { total: modes.length, stage: 'embeddings' });
  let completedModes = 0;
  const writerStatsByMode = {};
  const hnswIsolateState = {
    disabled: false,
    reason: null
  };

  try {
    for (const mode of modes) {
      if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) {
        fail(`Invalid mode: ${mode}`);
      }
      let stageCheckpoints = null;
      modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
      const finishMode = (message) => {
        completedModes += 1;
        modeTask.set(completedModes, modes.length, { message });
      };
      let cacheAttempts = 0;
      let cacheHits = 0;
      let cacheMisses = 0;
      let cacheRejected = 0;
      let cacheFastRejects = 0;
      const chunkMetaMaxBytes = resolveEmbeddingsChunkMetaMaxBytes(indexingConfig);
      const modeIndexRoot = resolveModeIndexRoot(mode);
      const modeTracker = ensureBuildStateTracker(modeIndexRoot);
      if (modeTracker?.hasBuildState && !modeTracker.runningMarked) {
        await markBuildPhase(modeIndexRoot, 'stage3', 'running');
        modeTracker.runningMarked = true;
      }
      if (explicitIndexRoot && !hasModeArtifacts(modeIndexRoot, mode)) {
        fail(
          `Missing index artifacts for mode "${mode}" under explicit --index-root: ${modeIndexRoot}. ` +
          'Run stage2 for that root/mode or choose the correct --index-root.'
        );
      }
      if (normalizePath(modeIndexRoot) !== normalizePath(activeIndexRoot)) {
        log(`[embeddings] ${mode}: using mode-specific index root: ${modeIndexRoot}`);
      }
      const indexDir = getIndexDir(root, mode, userConfig, { indexRoot: modeIndexRoot });
      const statePath = path.join(indexDir, 'index_state.json');
      logExpectedArtifacts(mode, indexDir, 'pre-stage3');
      const stateNow = new Date().toISOString();
      let indexState = loadIndexState(statePath);
      indexState.generatedAt = indexState.generatedAt || stateNow;
      indexState.updatedAt = stateNow;
      indexState.mode = indexState.mode || mode;
      indexState.embeddings = {
        ...(indexState.embeddings || {}),
        enabled: true,
        ready: false,
        pending: true,
        mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
        service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
        embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
        embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
        lastError: null,
        updatedAt: stateNow
      };
      const cacheRepoId = indexState?.repoId || null;
      try {
        await scheduleIo(() => writeIndexState(statePath, indexState));
      } catch {
        // Ignore index state write failures.
      }

      try {
        const incremental = loadIncrementalManifest(repoCacheRoot, mode);
        const manifestFiles = incremental?.manifest?.files || {};

        let chunksByFile = new Map();
        let totalChunks = 0;
        let loadedChunkMetaFromArtifacts = false;
        let streamSamplingSummary = null;
        try {
          await scheduleIo(async () => {
            const fileMetaById = new Map();
            const streamSampler = embeddingSampling.maxFiles
              ? createDeterministicFileStreamSampler({
                mode,
                maxFiles: embeddingSampling.maxFiles,
                seed: embeddingSampling.seed
              })
              : null;
            let fileMetaLoaded = false;
            let fileMetaLoadFailed = false;
            const ensureFileMetaById = async () => {
              if (fileMetaLoaded || fileMetaLoadFailed) return;
              try {
                for await (const row of loadFileMetaRows(indexDir, {
                  maxBytes: chunkMetaMaxBytes,
                  strict: false
                })) {
                  if (!row || !Number.isFinite(Number(row.id)) || typeof row.file !== 'string') continue;
                  fileMetaById.set(Number(row.id), row.file);
                }
                fileMetaLoaded = true;
              } catch (err) {
                fileMetaLoadFailed = true;
                if (!isMissingArtifactError(err, 'file_meta')) {
                  warn(`[embeddings] Failed to stream file_meta for ${mode}: ${err?.message || err}`);
                }
              }
            };
            let unresolvedFileRows = 0;
            let nextIndex = 0;
            for await (const chunkRow of loadChunkMetaRows(indexDir, {
              maxBytes: chunkMetaMaxBytes,
              strict: false,
              includeCold: false
            })) {
              const chunkIndex = nextIndex;
              nextIndex += 1;
              if (!chunkRow || typeof chunkRow !== 'object') continue;
              const fileId = Number(chunkRow.fileId);
              let filePath = typeof chunkRow.file === 'string' && chunkRow.file
                ? chunkRow.file
                : null;
              if (!filePath && Number.isFinite(fileId)) {
                if (!fileMetaLoaded && !fileMetaLoadFailed) {
                  await ensureFileMetaById();
                }
                filePath = fileMetaById.get(fileId) || null;
              }
              if (!filePath) {
                unresolvedFileRows += 1;
                continue;
              }
              const normalizedFilePath = toPosix(filePath);
              if (!normalizedFilePath) {
                unresolvedFileRows += 1;
                continue;
              }
              if (streamSampler) {
                const decision = streamSampler.considerFile(normalizedFilePath);
                if (decision.evicted) {
                  chunksByFile.delete(decision.evicted);
                }
                if (!decision.selected) {
                  continue;
                }
              }
              const compactChunk = compactChunkForEmbeddings(chunkRow, filePath);
              if (!compactChunk) {
                unresolvedFileRows += 1;
                continue;
              }
              const list = chunksByFile.get(normalizedFilePath) || [];
              list.push({ index: chunkIndex, chunk: compactChunk });
              chunksByFile.set(normalizedFilePath, list);
            }
            if (unresolvedFileRows > 0) {
              warn(
                `[embeddings] ${mode}: skipped ${unresolvedFileRows} chunk_meta rows with unresolved file mapping.`
              );
            }
            if (streamSampler) {
              streamSamplingSummary = {
                seenFiles: streamSampler.getSeenCount(),
                selectedFiles: streamSampler.getSelectedCount()
              };
            }
            totalChunks = nextIndex;
          });
          loadedChunkMetaFromArtifacts = true;
        } catch (err) {
          if (isChunkMetaTooLargeError(err)) {
            warn(
              `[embeddings] chunk_meta exceeded budget for ${mode} ` +
              `(${chunkMetaMaxBytes} bytes); using incremental bundles if available.`
            );
          } else if (!isMissingArtifactError(err, 'chunk_meta')) {
            warn(`[embeddings] Failed to load chunk_meta for ${mode}: ${err?.message || err}`);
          }
          loadedChunkMetaFromArtifacts = false;
        }
        if (!loadedChunkMetaFromArtifacts) {
          if (!manifestFiles || !Object.keys(manifestFiles).length) {
            warn(`[embeddings] Missing chunk_meta and no incremental bundles for ${mode}; skipping.`);
            finishMode(`skipped ${mode}`);
            continue;
          }
          const bundleResult = await scheduleIo(() => buildChunksFromBundles(
            incremental.bundleDir,
            manifestFiles,
            incremental?.manifest?.bundleFormat
          ));
          chunksByFile = bundleResult.chunksByFile;
          totalChunks = bundleResult.totalChunks;
          if (!chunksByFile.size || !totalChunks) {
            warn(`[embeddings] Incremental bundles empty for ${mode}; skipping.`);
            finishMode(`skipped ${mode}`);
            continue;
          }
          log(`[embeddings] ${mode}: using incremental bundles (${chunksByFile.size} files).`);
        }

        // Deterministic chunk ordering per file, independent of Map insertion order.
        for (const list of chunksByFile.values()) {
          if (!Array.isArray(list) || list.length < 2) continue;
          list.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
        }
        const fileEntries = Array.from(chunksByFile.entries())
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        let sampledFileEntries = fileEntries;
        let totalFileCount = fileEntries.length;
        let sampledChunkCount = totalChunks;
        if (streamSamplingSummary && embeddingSampling.maxFiles) {
          totalFileCount = Math.max(fileEntries.length, streamSamplingSummary.seenFiles || 0);
          sampledChunkCount = sampledFileEntries.reduce(
            (sum, entry) => sum + (Array.isArray(entry?.[1]) ? entry[1].length : 0),
            0
          );
          if (totalFileCount > sampledFileEntries.length) {
            log(
              `[embeddings] ${mode}: sampling ${sampledFileEntries.length}/${totalFileCount} files ` +
              `(${sampledChunkCount}/${totalChunks} chunks, seed=${embeddingSampling.seed}).`
            );
          }
        } else if (embeddingSampling.maxFiles && embeddingSampling.maxFiles < fileEntries.length) {
          sampledFileEntries = selectDeterministicFileSample({
            fileEntries,
            mode,
            maxFiles: embeddingSampling.maxFiles,
            seed: embeddingSampling.seed
          });
          sampledChunkCount = sampledFileEntries.reduce(
            (sum, entry) => sum + (Array.isArray(entry?.[1]) ? entry[1].length : 0),
            0
          );
          log(
            `[embeddings] ${mode}: sampling ${sampledFileEntries.length}/${totalFileCount} files ` +
            `(${sampledChunkCount}/${totalChunks} chunks, seed=${embeddingSampling.seed}).`
          );
        }
        const sampledChunksByFile = new Map(sampledFileEntries);
        const samplingActive = sampledChunkCount < totalChunks;

        stageCheckpoints = createStageCheckpointRecorder({
          buildRoot: modeIndexRoot,
          metricsDir,
          mode,
          buildId: modeIndexRoot ? path.basename(modeIndexRoot) : null
        });
        stageCheckpoints.record({
          stage: 'stage3',
          step: 'chunks',
          extra: {
            files: sampledFileEntries.length,
            totalFiles: totalFileCount,
            sampledFiles: totalFileCount - sampledFileEntries.length,
            totalChunks,
            sampledChunks: sampledChunkCount
          }
        });

        const codeVectors = new Array(totalChunks).fill(null);
        const docVectors = new Array(totalChunks).fill(null);
        const mergedVectors = new Array(totalChunks).fill(null);
        stageCheckpoints.record({
          stage: 'stage3',
          step: 'vectors-allocated',
          extra: {
            vectors: {
              merged: mergedVectors.length,
              doc: docVectors.length,
              code: codeVectors.length
            }
          }
        });
        const hnswIsolate = hnswConfig.enabled
          ? (hnswIsolateOverride ?? isTestingEnv())
          : false;
        const hnswEnabled = shouldUseInlineHnswBuilders({
          enabled: hnswConfig.enabled,
          hnswIsolate,
          samplingActive
        });
        if (hnswConfig.enabled && !hnswIsolate && samplingActive) {
          log(
            `[embeddings] ${mode}: deferring HNSW build until post-fill because sampling is active ` +
            `(${sampledChunkCount}/${totalChunks} chunks).`
          );
        }
        const hnswBuilders = hnswEnabled ? {
          merged: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          }),
          doc: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          }),
          code: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          })
        } : null;
        const addHnswFloatVector = (target, chunkIndex, floatVec) => {
          if (!hnswEnabled || !floatVec || !floatVec.length) return;
          const builder = hnswBuilders?.[target];
          if (!builder) return;
          builder.addVector(chunkIndex, floatVec);
        };
        const addHnswFromQuantized = (target, chunkIndex, quantizedVec) => {
          if (!hnswEnabled || !quantizedVec || !quantizedVec.length) return;
          const floatVec = dequantizeUint8ToFloat32(
            quantizedVec,
            quantization.minVal,
            quantization.maxVal,
            quantization.levels
          );
          if (floatVec && embeddingNormalize) {
            normalizeEmbeddingVectorInPlace(floatVec);
          }
          if (floatVec) addHnswFloatVector(target, chunkIndex, floatVec);
        };
        const hnswResults = { merged: null, doc: null, code: null };

        const cacheDir = resolveCacheDir(cacheRoot, cacheIdentity, mode);
        await scheduleIo(() => fs.mkdir(cacheDir, { recursive: true }));
        let cacheIndex = await scheduleIo(() => readCacheIndex(cacheDir, cacheIdentityKey));
        let cacheIndexDirty = false;
        const cacheMeta = await scheduleIo(() => readCacheMeta(cacheRoot, cacheIdentity, mode));
        const cacheMetaMatches = cacheMeta?.identityKey === cacheIdentityKey;
        let cacheEligible = true;
        if (cacheMeta?.identityKey && !cacheMetaMatches) {
          warn(`[embeddings] ${mode} cache identity mismatch; ignoring cached vectors.`);
          cacheEligible = false;
          cacheIndex = {
            ...cacheIndex,
            entries: {},
            files: {},
            shards: {},
            currentShard: null,
            nextShardId: 0
          };
          cacheIndexDirty = true;
        }

        const dimsValidator = createDimsValidator({ mode, configuredDims });
        const assertDims = dimsValidator.assertDims;

        if (configuredDims && cacheEligible) {
          if (cacheMetaMatches && Number.isFinite(Number(cacheMeta?.dims))) {
            const cachedDims = Number(cacheMeta.dims);
            if (cachedDims !== configuredDims) {
              throw new Error(
                `[embeddings] ${mode} cache dims mismatch (configured=${configuredDims}, cached=${cachedDims}).`
              );
            }
          }
        }

        const CACHE_INDEX_FLUSH_INTERVAL_FILES = 64;
        let filesSinceCacheIndexFlush = 0;
        const markCacheIndexDirty = () => {
          cacheIndexDirty = true;
        };
        let cacheIndexFlushInFlight = null;
        const flushCacheIndexMaybe = async ({ force = false } = {}) => {
          if (!cacheIndex || !cacheEligible) return;
          if (cacheIndexFlushInFlight) {
            if (force) {
              await cacheIndexFlushInFlight;
            }
            return;
          }
          if (!cacheIndexDirty) {
            if (force) filesSinceCacheIndexFlush = 0;
            return;
          }
          if (!force && filesSinceCacheIndexFlush < CACHE_INDEX_FLUSH_INTERVAL_FILES) {
            return;
          }
          cacheIndexFlushInFlight = (async () => {
            const flushState = await flushCacheIndexIfNeeded({
              cacheDir,
              cacheIndex,
              cacheEligible,
              cacheIndexDirty,
              cacheIdentityKey,
              cacheMaxBytes,
              cacheMaxAgeMs,
              scheduleIo
            });
            cacheIndexDirty = flushState.cacheIndexDirty;
            if (!cacheIndexDirty || force) {
              filesSinceCacheIndexFlush = 0;
            } else {
              filesSinceCacheIndexFlush = CACHE_INDEX_FLUSH_INTERVAL_FILES;
            }
          })();
          try {
            await cacheIndexFlushInFlight;
          } finally {
            cacheIndexFlushInFlight = null;
          }
        };

        let processedFiles = 0;
        let processedChunks = 0;
        let cacheHitFiles = 0;
        let computedFiles = 0;
        let skippedFiles = 0;
        const fileTask = display.task('Files', {
          taskId: `embeddings:${mode}:files`,
          total: sampledFileEntries.length,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });
        const chunkTask = display.task('Chunks', {
          taskId: `embeddings:${mode}:chunks`,
          total: sampledChunkCount,
          stage: 'embeddings',
          mode,
          ephemeral: true
        });

        // Cache shard writes are serialized via cache.lock but can still be queued.
        // Keep a bounded in-process queue so compute does not outrun IO and retain
        // unbounded payloads in memory.
        const schedulerStatsForWriter = scheduler?.stats?.() || null;
        const schedulerIoQueue = schedulerStatsForWriter?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo] || null;
        const schedulerIoMaxPending = Number.isFinite(Number(schedulerIoQueue?.maxPending))
          ? Math.max(1, Math.floor(Number(schedulerIoQueue.maxPending)))
          : null;
        const ioTokensTotal = Number.isFinite(Number(schedulerStatsForWriter?.tokens?.io?.total))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.tokens.io.total)))
          : 1;
        const computeTokensTotal = Number.isFinite(Number(schedulerStatsForWriter?.tokens?.cpu?.total))
          ? Math.max(1, Math.floor(Number(schedulerStatsForWriter.tokens.cpu.total)))
          : 1;
        const fileParallelism = resolveEmbeddingsFileParallelism({
          indexingConfig,
          computeTokensTotal,
          hnswEnabled
        });
        const backendParallelDispatch = getChunkEmbeddings?.supportsParallelDispatch === true;
        const parallelBatchDispatch = backendParallelDispatch && computeTokensTotal > 1;
        if (fileParallelism > 1) {
          log(`[embeddings] ${mode}: file parallelism enabled (${fileParallelism} workers).`);
        }
        const defaultWriterMaxPending = Math.max(1, Math.min(4, ioTokensTotal * 2));
        const writerMaxPending = schedulerIoMaxPending
          ? Math.max(1, Math.min(defaultWriterMaxPending, schedulerIoMaxPending))
          : defaultWriterMaxPending;
        const writerAdaptiveCeiling = Math.max(writerMaxPending, Math.min(16, writerMaxPending * 2));
        const writerAdaptiveFloor = Math.max(1, Math.min(writerMaxPending, Math.ceil(writerMaxPending * 0.5)));
        const writerAdaptiveStepMs = Number.isFinite(Number(indexingConfig?.embeddings?.writerAdaptiveStepMs))
          ? Math.max(100, Math.floor(Number(indexingConfig.embeddings.writerAdaptiveStepMs)))
          : 500;
        const writerAdaptiveRssLow = Number.isFinite(Number(indexingConfig?.embeddings?.writerAdaptiveRssLow))
          ? Math.max(0, Math.min(1, Number(indexingConfig.embeddings.writerAdaptiveRssLow)))
          : 0.62;
        const writerAdaptiveRssHigh = Number.isFinite(Number(indexingConfig?.embeddings?.writerAdaptiveRssHigh))
          ? Math.max(writerAdaptiveRssLow, Math.min(1, Number(indexingConfig.embeddings.writerAdaptiveRssHigh)))
          : 0.9;
        let writerAdaptiveLimit = writerMaxPending;
        let writerAdaptiveLastAdjustAt = 0;
        const resolveAdaptiveWriterLimit = () => {
          const nowMs = Date.now();
          if ((nowMs - writerAdaptiveLastAdjustAt) < writerAdaptiveStepMs) {
            return writerAdaptiveLimit;
          }
          const schedulerStats = scheduler?.stats?.();
          const memorySignals = schedulerStats?.adaptive?.signals?.memory || null;
          const rssUtilization = Number(memorySignals?.rssUtilization);
          const gcPressure = Number(memorySignals?.gcPressureScore);
          if (!Number.isFinite(rssUtilization) || !Number.isFinite(gcPressure)) {
            return writerAdaptiveLimit;
          }
          if (rssUtilization >= writerAdaptiveRssHigh || gcPressure >= 0.4) {
            writerAdaptiveLimit = Math.max(writerAdaptiveFloor, writerAdaptiveLimit - 1);
            writerAdaptiveLastAdjustAt = nowMs;
            return writerAdaptiveLimit;
          }
          if (rssUtilization <= writerAdaptiveRssLow && gcPressure <= 0.2) {
            writerAdaptiveLimit = Math.min(writerAdaptiveCeiling, writerAdaptiveLimit + 1);
            writerAdaptiveLastAdjustAt = nowMs;
            return writerAdaptiveLimit;
          }
          return writerAdaptiveLimit;
        };
        const writerQueue = createBoundedWriterQueue({
          scheduleIo,
          maxPending: writerMaxPending,
          resolveMaxPending: resolveAdaptiveWriterLimit
        });
        const cacheShardHandlePool = createShardAppendHandlePool();
        const progressHeartbeatMs = resolveEmbeddingsProgressHeartbeatMs(indexingConfig);
        const progressStartedAtMs = Date.now();
        let lastProgressEmitMs = 0;
        let progressTimer = null;
        const emitProgressSnapshot = ({ force = false } = {}) => {
          const nowMs = Date.now();
          if (!force && (nowMs - lastProgressEmitMs) < progressHeartbeatMs) return;
          lastProgressEmitMs = nowMs;
          const elapsedSec = Math.max(0.001, (nowMs - progressStartedAtMs) / 1000);
          const filesPerSec = processedFiles / elapsedSec;
          const chunksPerSec = processedChunks / elapsedSec;
          const remainingChunks = Math.max(0, sampledChunkCount - processedChunks);
          const etaSeconds = chunksPerSec > 0 ? (remainingChunks / chunksPerSec) : null;
          const cacheHitRate = cacheAttempts > 0 ? ((cacheHits / cacheAttempts) * 100) : null;
          const writerStats = writerQueue.stats();
          const schedulerStats = scheduler?.stats?.();
          const computeQueueStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsCompute] || {};
          const ioQueueStats = schedulerStats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo] || {};
          const filesMessage = [
            `${processedFiles}/${sampledFileEntries.length} files`,
            `${processedChunks}/${sampledChunkCount} chunks`,
            `${filesPerSec.toFixed(1)} files/s`,
            `${chunksPerSec.toFixed(1)} chunks/s`,
            `eta ${formatEta(etaSeconds)}`,
            `cache ${cacheHitRate == null ? 'n/a' : `${cacheHitRate.toFixed(1)}%`}`,
            `writer ${writerStats.pending}/${writerStats.currentMaxPending}`,
            `q(c=${Number(computeQueueStats.pending || 0)},io=${Number(ioQueueStats.pending || 0)})`
          ].join(' | ');
          fileTask.set(processedFiles, sampledFileEntries.length, {
            message: filesMessage,
            throughput: {
              filesPerSec,
              chunksPerSec
            },
            etaSeconds,
            cache: {
              attempts: cacheAttempts,
              hits: cacheHits,
              misses: cacheMisses,
              rejected: cacheRejected,
              fastRejects: cacheFastRejects,
              hitRate: cacheHitRate
            },
            writer: writerStats,
            queue: {
              computePending: Number(computeQueueStats.pending || 0),
              ioPending: Number(ioQueueStats.pending || 0)
            },
            completed: {
              files: processedFiles,
              chunks: processedChunks,
              cacheHitFiles,
              computedFiles,
              skippedFiles
            }
          });
          chunkTask.set(Math.min(processedChunks, sampledChunkCount), sampledChunkCount, {
            message: `${processedChunks}/${sampledChunkCount} chunks | ${chunksPerSec.toFixed(1)} chunks/s | eta ${formatEta(etaSeconds)}`,
            throughput: {
              chunksPerSec
            },
            etaSeconds
          });
        };
        const stopProgressTimer = () => {
          if (!progressTimer) return;
          clearInterval(progressTimer);
          progressTimer = null;
        };
        progressTimer = setInterval(() => {
          try {
            emitProgressSnapshot();
          } catch {
            // Progress reporting must never fail the embedding pass.
          }
        }, progressHeartbeatMs);

        let sharedZeroVec = new Float32Array(0);
        const markFileProcessed = async ({ chunkCount = 0, source = 'computed', skipped = false } = {}) => {
          processedFiles += 1;
          processedChunks += Math.max(0, Math.floor(Number(chunkCount) || 0));
          if (source === 'cache') cacheHitFiles += 1;
          if (source === 'computed') computedFiles += 1;
          if (skipped) skippedFiles += 1;
          filesSinceCacheIndexFlush += 1;
          await flushCacheIndexMaybe();
          emitProgressSnapshot({ force: processedFiles === sampledFileEntries.length });
          if (traceArtifactIo && (processedFiles % 8 === 0 || processedFiles === sampledFileEntries.length)) {
            log(
              `[embeddings] ${mode}: processed ${processedFiles}/${sampledFileEntries.length} files ` +
              `(${processedChunks}/${sampledChunkCount} chunks)`
            );
          }
        };
        const processFileEmbeddings = async (entry) => {
          const codeEmbeds = entry.codeEmbeds || [];
          const docVectorsRaw = entry.docVectorsRaw || [];
          const reuse = entry.reuse || null;
          if (!Array.isArray(codeEmbeds) || codeEmbeds.length !== entry.items.length) {
            throw new Error(
              `[embeddings] ${mode} code batch size mismatch (expected ${entry.items.length}, got ${codeEmbeds?.length ?? 0}).`
            );
          }
          if (!Array.isArray(docVectorsRaw) || docVectorsRaw.length !== entry.items.length) {
            throw new Error(
              `[embeddings] ${mode} doc batch size mismatch (expected ${entry.items.length}, got ${docVectorsRaw?.length ?? 0}).`
            );
          }
          const fileCodeEmbeds = ensureVectorArrays(codeEmbeds, entry.items.length);
          for (const vec of fileCodeEmbeds) {
            if (isVectorLike(vec) && vec.length) assertDims(vec.length);
          }
          for (const vec of docVectorsRaw) {
            if (isVectorLike(vec) && vec.length) assertDims(vec.length);
          }

          const dims = dimsValidator.getDims();
          if (dims && sharedZeroVec.length !== dims) {
            sharedZeroVec = new Float32Array(dims);
          }
          const zeroVec = sharedZeroVec;

          const cachedCodeVectors = [];
          const cachedDocVectors = [];
          const cachedMergedVectors = [];
          for (let i = 0; i < entry.items.length; i += 1) {
            const chunkIndex = entry.items[i].index;
            const reusedCode = reuse?.code?.[i];
            const reusedDoc = reuse?.doc?.[i];
            const reusedMerged = reuse?.merged?.[i];
            if (isNonEmptyVector(reusedCode) && isNonEmptyVector(reusedDoc) && isNonEmptyVector(reusedMerged)) {
              assertDims(reusedCode.length);
              assertDims(reusedDoc.length);
              assertDims(reusedMerged.length);
              codeVectors[chunkIndex] = reusedCode;
              docVectors[chunkIndex] = reusedDoc;
              mergedVectors[chunkIndex] = reusedMerged;
              if (hnswEnabled) {
                addHnswFromQuantized('merged', chunkIndex, reusedMerged);
                addHnswFromQuantized('doc', chunkIndex, reusedDoc);
                addHnswFromQuantized('code', chunkIndex, reusedCode);
              }
              cachedCodeVectors.push(reusedCode);
              cachedDocVectors.push(reusedDoc);
              cachedMergedVectors.push(reusedMerged);
              continue;
            }
            const embedCode = isVectorLike(fileCodeEmbeds[i]) ? fileCodeEmbeds[i] : [];
            const embedDoc = isVectorLike(docVectorsRaw[i]) ? docVectorsRaw[i] : zeroVec;
            const quantized = buildQuantizedVectors({
              chunkIndex,
              codeVector: embedCode,
              docVector: embedDoc,
              zeroVector: zeroVec,
              addHnswVectors: hnswEnabled ? {
                merged: (id, vec) => addHnswFloatVector('merged', id, vec),
                doc: (id, vec) => addHnswFloatVector('doc', id, vec),
                code: (id, vec) => addHnswFloatVector('code', id, vec)
              } : null,
              quantization,
              normalize: embeddingNormalize
            });
            codeVectors[chunkIndex] = quantized.quantizedCode;
            docVectors[chunkIndex] = quantized.quantizedDoc;
            mergedVectors[chunkIndex] = quantized.quantizedMerged;
            cachedCodeVectors.push(quantized.quantizedCode);
            cachedDocVectors.push(quantized.quantizedDoc);
            cachedMergedVectors.push(quantized.quantizedMerged);
          }

          if (entry.cacheKey && entry.cacheDir) {
            try {
              const cacheDirLocal = entry.cacheDir;
              const cacheKeyLocal = entry.cacheKey;
              const normalizedRelLocal = entry.normalizedRel;
              const fileHashLocal = entry.fileHash;
              const chunkSignatureLocal = entry.chunkSignature;
              const chunkHashesLocal = entry.chunkHashes;
              const chunkHashesFingerprintLocal = entry.chunkHashesFingerprint || null;
              const cachePayload = {
                key: cacheKeyLocal,
                file: normalizedRelLocal,
                hash: fileHashLocal,
                chunkSignature: chunkSignatureLocal,
                chunkHashes: chunkHashesLocal,
                cacheMeta: {
                  schemaVersion: 1,
                  identityKey: cacheIdentityKey,
                  identity: cacheIdentity,
                  createdAt: new Date().toISOString()
                },
                codeVectors: cachedCodeVectors,
                docVectors: cachedDocVectors,
                mergedVectors: cachedMergedVectors
              };
              const encodedPayload = await encodeCacheEntryPayload(cachePayload);
              await writerQueue.enqueue(async () => {
                const shardEntry = await writeCacheEntry(cacheDirLocal, cacheKeyLocal, cachePayload, {
                  index: cacheIndex,
                  encodedBuffer: encodedPayload,
                  shardHandlePool: cacheShardHandlePool
                });
                if (shardEntry) {
                  upsertCacheIndexEntry(cacheIndex, cacheKeyLocal, {
                    key: cacheKeyLocal,
                    file: normalizedRelLocal,
                    hash: fileHashLocal,
                    chunkSignature: chunkSignatureLocal,
                    chunkCount: entry.items.length,
                    chunkHashesFingerprint: chunkHashesFingerprintLocal,
                    chunkHashesCount: Array.isArray(chunkHashesLocal) ? chunkHashesLocal.length : null
                  }, shardEntry);
                  markCacheIndexDirty();
                }
              });
            } catch {
            // Ignore cache write failures.
            }
          }

          await markFileProcessed({
            chunkCount: entry.items.length,
            source: 'computed'
          });
        };

        const computeFileEmbeddings = createFileEmbeddingsProcessor({
          embeddingBatchSize,
          getChunkEmbeddings,
          runBatched,
          assertVectorArrays,
          scheduleCompute,
          processFileEmbeddings,
          mode,
          parallelDispatch: parallelBatchDispatch
        });
        try {
          const processFileEntry = async ([relPath, items]) => {
            const normalizedRel = toPosix(relPath);
            const chunkSignature = buildChunkSignature(items);
            const manifestEntry = manifestFiles[normalizedRel] || null;
            const manifestHash = typeof manifestEntry?.hash === 'string' ? manifestEntry.hash : null;
            let fileHash = manifestHash;
            let cacheKey = buildCacheKey({
              file: normalizedRel,
              hash: fileHash,
              signature: chunkSignature,
              identityKey: cacheIdentityKey,
              repoId: cacheRepoId,
              mode,
              featureFlags: cacheKeyFlags,
              pathPolicy: 'posix'
            });
            let cachedResult = null;
            const canLookupWithManifestHash = cacheEligible && cacheKey && !!fileHash;
            if (canLookupWithManifestHash) {
              cacheAttempts += 1;
              if (shouldFastRejectCacheLookup({
                cacheIndex,
                cacheKey,
                identityKey: cacheIdentityKey,
                fileHash,
                chunkSignature
              })) {
                cacheFastRejects += 1;
              } else {
                cachedResult = await scheduleIo(() => readCacheEntry(cacheDir, cacheKey, cacheIndex));
              }
            }
            const cached = cachedResult?.entry;
            if (!cached && canLookupWithManifestHash) {
              cacheMisses += 1;
            }
            if (cached) {
              try {
                const cacheIdentityMatches = cached.cacheMeta?.identityKey === cacheIdentityKey;
                if (cacheIdentityMatches) {
                  const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
                  validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
                  validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
                  validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
                }
                if (isCacheValid({
                  cached,
                  signature: chunkSignature,
                  identityKey: cacheIdentityKey,
                  hash: fileHash
                })) {
                  const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
                  const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
                  const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
                  let hasEmptyCached = false;
                  for (let i = 0; i < items.length; i += 1) {
                    const chunkIndex = items[i].index;
                    const codeVec = cachedCode[i] || [];
                    const docVec = cachedDoc[i] || [];
                    const mergedVec = cachedMerged[i] || [];
                    if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                      hasEmptyCached = true;
                      break;
                    }
                    assertDims(codeVec.length);
                    assertDims(docVec.length);
                    assertDims(mergedVec.length);
                    codeVectors[chunkIndex] = codeVec;
                    docVectors[chunkIndex] = docVec;
                    mergedVectors[chunkIndex] = mergedVec;
                    if (hnswEnabled) {
                      addHnswFromQuantized('merged', chunkIndex, mergedVec);
                      addHnswFromQuantized('doc', chunkIndex, docVec);
                      addHnswFromQuantized('code', chunkIndex, codeVec);
                    }
                  }
                  if (hasEmptyCached) {
                    throw new Error(`[embeddings] ${mode} cached vectors incomplete; recomputing ${normalizedRel}.`);
                  }
                  if (cacheIndex && cacheKey) {
                    updateCacheIndexAccess(cacheIndex, cacheKey);
                    if (!cacheIndex.files || typeof cacheIndex.files !== 'object') {
                      cacheIndex.files = {};
                    }
                    if (!cacheIndex.files[normalizedRel]) {
                      cacheIndex.files[normalizedRel] = cacheKey;
                    }
                    markCacheIndexDirty();
                  }
                  cacheHits += 1;
                  await markFileProcessed({
                    chunkCount: items.length,
                    source: 'cache'
                  });
                  return;
                }
              } catch (err) {
                if (isDimsMismatch(err)) throw err;
                // Ignore cache parse errors.
                cacheRejected += 1;
              }
            }

            const candidates = (() => {
              if (mode !== 'records') {
                return [path.resolve(root, fromPosix(normalizedRel))];
              }
              const resolvedRecordsDir = typeof recordsDir === 'string' && recordsDir
                ? recordsDir
                : root;
              if (normalizedRel.startsWith('triage/records/')) {
                const stripped = normalizedRel.slice('triage/records/'.length);
                return [
                  path.resolve(resolvedRecordsDir, fromPosix(stripped)),
                  path.resolve(root, fromPosix(normalizedRel))
                ];
              }
              return [
                path.resolve(root, fromPosix(normalizedRel)),
                path.resolve(resolvedRecordsDir, fromPosix(normalizedRel))
              ];
            })();
            let absPath = candidates[0];
            let textInfo = null;
            let lastErr = null;
            try {
              for (const candidate of candidates) {
                absPath = candidate;
                try {
                  textInfo = await scheduleIo(() => readTextFileWithHash(candidate));
                  lastErr = null;
                  break;
                } catch (err) {
                  lastErr = err;
                  if (mode === 'records' && err?.code === 'ENOENT') {
                    continue;
                  }
                  break;
                }
              }
              if (!textInfo) {
                throw lastErr || new Error('Unknown read error');
              }
            } catch (err) {
              const reason = err?.code ? `${err.code}: ${err.message || err}` : (err?.message || err);
              warn(`[embeddings] ${mode}: Failed to read ${normalizedRel}; skipping (${reason}).`);
              await markFileProcessed({
                chunkCount: items.length,
                source: 'skipped',
                skipped: true
              });
              return;
            }
            const text = textInfo.text;
            if (!fileHash) {
              fileHash = textInfo.hash;
              cacheKey = buildCacheKey({
                file: normalizedRel,
                hash: fileHash,
                signature: chunkSignature,
                identityKey: cacheIdentityKey,
                repoId: cacheRepoId,
                mode,
                featureFlags: cacheKeyFlags,
                pathPolicy: 'posix'
              });
              let cachedAfterHash = null;
              if (cacheEligible && cacheKey) {
                cacheAttempts += 1;
                if (shouldFastRejectCacheLookup({
                  cacheIndex,
                  cacheKey,
                  identityKey: cacheIdentityKey,
                  fileHash,
                  chunkSignature
                })) {
                  cacheFastRejects += 1;
                } else {
                  cachedAfterHash = await scheduleIo(() => readCacheEntry(cacheDir, cacheKey, cacheIndex));
                }
              }
              const cached = cachedAfterHash?.entry;
              if (!cached && cacheEligible && cacheKey) {
                cacheMisses += 1;
              }
              if (cached) {
                try {
                  const cacheIdentityMatches = cached.cacheMeta?.identityKey === cacheIdentityKey;
                  if (cacheIdentityMatches) {
                    const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
                    validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
                    validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
                    validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
                  }
                  if (isCacheValid({
                    cached,
                    signature: chunkSignature,
                    identityKey: cacheIdentityKey,
                    hash: fileHash
                  })) {
                    const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
                    const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
                    const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
                    let hasEmptyCached = false;
                    for (let i = 0; i < items.length; i += 1) {
                      const chunkIndex = items[i].index;
                      const codeVec = cachedCode[i] || [];
                      const docVec = cachedDoc[i] || [];
                      const mergedVec = cachedMerged[i] || [];
                      if (!isNonEmptyVector(codeVec) || !isNonEmptyVector(docVec) || !isNonEmptyVector(mergedVec)) {
                        hasEmptyCached = true;
                        break;
                      }
                      assertDims(codeVec.length);
                      assertDims(docVec.length);
                      assertDims(mergedVec.length);
                      codeVectors[chunkIndex] = codeVec;
                      docVectors[chunkIndex] = docVec;
                      mergedVectors[chunkIndex] = mergedVec;
                      if (hnswEnabled) {
                        addHnswFromQuantized('merged', chunkIndex, mergedVec);
                        addHnswFromQuantized('doc', chunkIndex, docVec);
                        addHnswFromQuantized('code', chunkIndex, codeVec);
                      }
                    }
                    if (hasEmptyCached) {
                      throw new Error(`[embeddings] ${mode} cached vectors incomplete; recomputing ${normalizedRel}.`);
                    }
                    if (cacheIndex && cacheKey) {
                      updateCacheIndexAccess(cacheIndex, cacheKey);
                      if (!cacheIndex.files || typeof cacheIndex.files !== 'object') {
                        cacheIndex.files = {};
                      }
                      if (!cacheIndex.files[normalizedRel]) {
                        cacheIndex.files[normalizedRel] = cacheKey;
                      }
                      markCacheIndexDirty();
                    }
                    cacheHits += 1;
                    await markFileProcessed({
                      chunkCount: items.length,
                      source: 'cache'
                    });
                    return;
                  }
                } catch (err) {
                  if (isDimsMismatch(err)) throw err;
                  // Ignore cache parse errors.
                  cacheRejected += 1;
                }
              }
            }

            const codeTexts = [];
            const docTexts = [];
            const codeMapping = [];
            const docMapping = [];
            const chunkHashes = new Array(items.length);
            const chunkCodeTexts = new Array(items.length);
            const chunkDocTexts = new Array(items.length);
            for (let i = 0; i < items.length; i += 1) {
              const { chunk } = items[i];
              const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
              const end = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
              const codeText = text.slice(start, end);
              const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
              const trimmedDoc = docText.trim() ? docText : '';
              chunkCodeTexts[i] = codeText;
              chunkDocTexts[i] = trimmedDoc;
              chunkHashes[i] = sha1(`${codeText}\n${trimmedDoc}`);
            }
            const chunkHashesFingerprint = buildChunkHashesFingerprint(chunkHashes);
            const reuse = {
              code: new Array(items.length).fill(null),
              doc: new Array(items.length).fill(null),
              merged: new Array(items.length).fill(null)
            };
            if (cacheEligible) {
              const priorKey = cacheIndex?.files?.[normalizedRel];
              if (priorKey && priorKey !== cacheKey) {
                const priorIndexEntry = cacheIndex?.entries?.[priorKey] || null;
                const canCheckFingerprint = typeof chunkHashesFingerprint === 'string'
                && !!priorIndexEntry?.chunkHashesFingerprint;
                const fingerprintMatches = !canCheckFingerprint
                || priorIndexEntry.chunkHashesFingerprint === chunkHashesFingerprint;
                const priorResult = fingerprintMatches
                  ? await scheduleIo(() => readCacheEntry(cacheDir, priorKey, cacheIndex))
                  : null;
                const priorEntry = priorResult?.entry;
                if (priorEntry && Array.isArray(priorEntry.chunkHashes)) {
                  const hashMap = new Map();
                  for (let i = 0; i < priorEntry.chunkHashes.length; i += 1) {
                    const hash = priorEntry.chunkHashes[i];
                    if (!hash) continue;
                    const list = hashMap.get(hash) || [];
                    list.push(i);
                    hashMap.set(hash, list);
                  }
                  const priorCode = ensureVectorArrays(priorEntry.codeVectors, priorEntry.chunkHashes.length);
                  const priorDoc = ensureVectorArrays(priorEntry.docVectors, priorEntry.chunkHashes.length);
                  const priorMerged = ensureVectorArrays(priorEntry.mergedVectors, priorEntry.chunkHashes.length);
                  for (let i = 0; i < items.length; i += 1) {
                    const hash = chunkHashes[i];
                    const list = hashMap.get(hash);
                    if (!list || !list.length) continue;
                    const priorIndex = list.shift();
                    const codeVec = priorCode[priorIndex] || null;
                    const docVec = priorDoc[priorIndex] || null;
                    const mergedVec = priorMerged[priorIndex] || null;
                    if (isNonEmptyVector(codeVec) && isNonEmptyVector(docVec) && isNonEmptyVector(mergedVec)) {
                      reuse.code[i] = codeVec;
                      reuse.doc[i] = docVec;
                      reuse.merged[i] = mergedVec;
                    }
                  }
                  updateCacheIndexAccess(cacheIndex, priorKey);
                  markCacheIndexDirty();
                }
              }
            }
            for (let i = 0; i < items.length; i += 1) {
              if (reuse.code[i] && reuse.doc[i] && reuse.merged[i]) {
                continue;
              }
              codeMapping.push(i);
              codeTexts.push(chunkCodeTexts[i]);
              docMapping.push(i);
              docTexts.push(chunkDocTexts[i]);
            }
            await computeFileEmbeddings({
              normalizedRel,
              items,
              cacheKey,
              cacheDir,
              fileHash,
              chunkSignature,
              chunkHashes,
              chunkHashesFingerprint,
              codeTexts,
              docTexts,
              codeMapping,
              docMapping,
              reuse
            });
          };
          if (fileParallelism <= 1 || sampledFileEntries.length <= 1) {
            for (const entry of sampledFileEntries) {
              await processFileEntry(entry);
            }
          } else {
            await runWithConcurrency(
              sampledFileEntries,
              fileParallelism,
              async (entry) => processFileEntry(entry),
              { collectResults: false }
            );
          }
        } finally {
          stopProgressTimer();
          await writerQueue.onIdle();
          await cacheShardHandlePool.close();
          emitProgressSnapshot({ force: true });
        }
        await flushCacheIndexMaybe({ force: true });

        stageCheckpoints.record({
          stage: 'stage3',
          step: 'vectors-filled',
          extra: {
            vectors: {
              merged: countNonEmptyVectors(mergedVectors),
              doc: countNonEmptyVectors(docVectors),
              code: countNonEmptyVectors(codeVectors)
            }
          }
        });

        const observedDims = dimsValidator.getDims();
        if (configuredDims && observedDims && configuredDims !== observedDims) {
          throw new Error(
            `[embeddings] ${mode} embedding dims mismatch (configured=${configuredDims}, observed=${observedDims}).`
          );
        }
        const finalDims = observedDims
        || configuredDims
        || (useStubEmbeddings ? resolveStubDims(configuredDims) : DEFAULT_STUB_DIMS);
        fillMissingVectors(codeVectors, finalDims);
        fillMissingVectors(docVectors, finalDims);
        fillMissingVectors(mergedVectors, finalDims);
        clampQuantizedVectorsInPlace(codeVectors);
        clampQuantizedVectorsInPlace(docVectors);
        clampQuantizedVectorsInPlace(mergedVectors);

        const refreshedBundles = await refreshIncrementalBundlesWithEmbeddings({
          mode,
          incremental,
          chunksByFile: sampledChunksByFile,
          mergedVectors,
          embeddingMode: resolvedEmbeddingMode,
          embeddingIdentityKey: cacheIdentityKey,
          lowYieldBailout: extractedProseLowYieldBailout,
          scheduleIo,
          log,
          warn
        });
        if (refreshedBundles.attempted > 0 && !refreshedBundles.completeCoverage) {
          warn(
            `[embeddings] ${mode}: incremental bundle embedding coverage incomplete; ` +
            'sqlite incremental builds may fall back to artifacts.'
          );
        }

        const mergedVectorsPath = path.join(indexDir, 'dense_vectors_uint8.json');
        const docVectorsPath = path.join(indexDir, 'dense_vectors_doc_uint8.json');
        const codeVectorsPath = path.join(indexDir, 'dense_vectors_code_uint8.json');
        if (traceArtifactIo) {
          log(`[embeddings] ${mode}: writing vectors to ${mergedVectorsPath}`);
          log(`[embeddings] ${mode}: writing vectors to ${docVectorsPath}`);
          log(`[embeddings] ${mode}: writing vectors to ${codeVectorsPath}`);
        }
        const vectorFields = {
          model: modelId,
          dims: finalDims,
          scale: denseScale,
          minVal: quantization.minVal,
          maxVal: quantization.maxVal,
          levels: quantization.levels
        };
        await Promise.all([
          scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName: 'dense_vectors_uint8',
            vectorFields,
            vectors: mergedVectors,
            writeBinary: binaryDenseVectors
          })),
          scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName: 'dense_vectors_doc_uint8',
            vectorFields,
            vectors: docVectors,
            writeBinary: binaryDenseVectors
          })),
          scheduleIo(() => writeDenseVectorArtifacts({
            indexDir,
            baseName: 'dense_vectors_code_uint8',
            vectorFields,
            vectors: codeVectors,
            writeBinary: binaryDenseVectors
          }))
        ]);
        logArtifactLocation(mode, 'dense_vectors_uint8', mergedVectorsPath);
        logArtifactLocation(mode, 'dense_vectors_doc_uint8', docVectorsPath);
        logArtifactLocation(mode, 'dense_vectors_code_uint8', codeVectorsPath);

        const backendStageRoot = path.join(modeIndexRoot || indexDir, '.embeddings-backend-staging');
        const backendStageDir = path.join(backendStageRoot, `index-${mode}`);
        await scheduleIo(async () => {
          await fs.rm(backendStageDir, { recursive: true, force: true });
          await fs.mkdir(backendStageDir, { recursive: true });
        });
        const stagedHnswPaths = {
          merged: resolveHnswPaths(backendStageDir, 'merged'),
          doc: resolveHnswPaths(backendStageDir, 'doc'),
          code: resolveHnswPaths(backendStageDir, 'code')
        };
        try {
          Object.assign(hnswResults, await scheduleIo(() => writeHnswBackends({
            mode,
            hnswConfig,
            hnswIsolate,
            isolateState: hnswIsolateState,
            hnswBuilders,
            hnswPaths: stagedHnswPaths,
            vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors },
            vectorsPaths: { merged: mergedVectorsPath, doc: docVectorsPath, code: codeVectorsPath },
            modelId,
            dims: finalDims,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            logger,
            log,
            warn
          })));

          await scheduleIo(() => writeLanceDbBackends({
            mode,
            indexDir: backendStageDir,
            lanceConfig,
            vectors: { merged: mergedVectors, doc: docVectors, code: codeVectors },
            vectorsPaths: { merged: mergedVectorsPath, doc: docVectorsPath, code: codeVectorsPath },
            dims: finalDims,
            modelId,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            logger,
            warn
          }));
          await scheduleIo(() => promoteBackendArtifacts({
            stageDir: backendStageDir,
            indexDir
          }));
        } finally {
          await scheduleIo(() => fs.rm(backendStageDir, { recursive: true, force: true }));
        }

        let sqliteVecState = { enabled: false, available: false };
        if (mode === 'code' || mode === 'prose') {
          const sqlitePathsForMode = resolveSqlitePaths(root, userConfig, { indexRoot: modeIndexRoot });
          const sqliteSharedDbForMode = sqlitePathsForMode?.codePath
            && sqlitePathsForMode?.prosePath
            && path.resolve(sqlitePathsForMode.codePath) === path.resolve(sqlitePathsForMode.prosePath);
          const sqliteResult = await scheduleIo(() => updateSqliteDense({
            Database,
            root,
            userConfig,
            indexRoot: modeIndexRoot,
            mode,
            vectors: mergedVectors,
            dims: finalDims,
            scale: denseScale,
            modelId,
            quantization,
            sharedDb: sqliteSharedDbForMode,
            emitOutput: true,
            warnOnMissing: false,
            logger
          }));
          const vectorAnn = sqliteResult?.vectorAnn || null;
          sqliteVecState = {
            enabled: vectorAnn?.enabled === true,
            available: vectorAnn?.available === true
          };
          if (sqliteVecState.available) {
            sqliteVecState.dims = finalDims;
            sqliteVecState.count = totalChunks;
          }
          const sqliteMetaPath = path.join(indexDir, 'dense_vectors_sqlite_vec.meta.json');
          if (vectorAnn?.available && vectorAnn?.table) {
            const sqliteMeta = {
              version: 1,
              generatedAt: new Date().toISOString(),
              model: modelId || null,
              dims: finalDims,
              count: totalChunks,
              table: vectorAnn.table,
              embeddingColumn: vectorAnn.column || null,
              idColumn: vectorAnn.idColumn || 'rowid',
              ingestEncoding: sqliteResult?.ingestEncoding || 'float32',
              scale: denseScale,
              minVal: quantization.minVal,
              maxVal: quantization.maxVal,
              levels: quantization.levels
            };
            try {
              await scheduleIo(() => writeJsonObjectFile(sqliteMetaPath, { fields: sqliteMeta, atomic: true }));
            } catch {
            // Ignore sqlite vec meta write failures.
            }
          } else {
            try {
              if (traceArtifactIo) {
                log(`[embeddings] ${mode}: deleting optional sqlite vec meta ${sqliteMetaPath}`);
              }
              await scheduleIo(() => fs.rm(sqliteMetaPath, { force: true }));
              logArtifactLocation(mode, 'dense_vectors_sqlite_vec_meta', sqliteMetaPath);
            } catch {}
          }
          queueBackgroundSqliteMaintenance({
            mode,
            denseCount: Number.isFinite(sqliteResult?.count) ? Number(sqliteResult.count) : totalChunks,
            modeIndexRoot,
            sqlitePathsForMode
          });
        }

        const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
        const hnswTargetPaths = resolveHnswPaths(indexDir, hnswTarget);
        const hnswMeta = await scheduleIo(() => readJsonOptional(hnswTargetPaths.metaPath));
        const hnswIndexExists = fsSync.existsSync(hnswTargetPaths.indexPath)
        || fsSync.existsSync(`${hnswTargetPaths.indexPath}.bak`);
        const hnswAvailable = Boolean(hnswMeta) && hnswIndexExists;
        const hnswState = {
          enabled: hnswConfig.enabled !== false,
          available: hnswAvailable,
          target: hnswTarget
        };
        if (hnswMeta) {
          hnswState.dims = Number.isFinite(Number(hnswMeta.dims)) ? Number(hnswMeta.dims) : finalDims;
          hnswState.count = Number.isFinite(Number(hnswMeta.count)) ? Number(hnswMeta.count) : totalChunks;
        }

        const lancePaths = resolveLanceDbPaths(indexDir);
        const lanceTarget = resolveLanceDbTarget(mode, denseVectorMode);
        const targetPaths = lancePaths?.[lanceTarget] || lancePaths?.merged || {};
        const lanceMeta = await scheduleIo(() => readJsonOptional(targetPaths.metaPath));
        const lanceAvailable = Boolean(lanceMeta)
        && Boolean(targetPaths.dir)
        && fsSync.existsSync(targetPaths.dir);
        const lancedbState = {
          enabled: lanceConfig.enabled !== false,
          available: lanceAvailable,
          target: lanceTarget
        };
        if (lanceMeta) {
          lancedbState.dims = Number.isFinite(Number(lanceMeta.dims)) ? Number(lanceMeta.dims) : finalDims;
          lancedbState.count = Number.isFinite(Number(lanceMeta.count)) ? Number(lanceMeta.count) : totalChunks;
        }

        stageCheckpoints.record({
          stage: 'stage3',
          step: 'write',
          extra: {
            vectors: {
              merged: countNonEmptyVectors(mergedVectors),
              doc: countNonEmptyVectors(docVectors),
              code: countNonEmptyVectors(codeVectors)
            },
            hnsw: hnswState.available ? (hnswState.count || 0) : 0,
            lancedb: lancedbState.available ? (lancedbState.count || 0) : 0,
            sqliteVec: sqliteVecState.available ? (sqliteVecState.count || 0) : 0
          }
        });

        const now = new Date().toISOString();
        indexState.generatedAt = indexState.generatedAt || now;
        indexState.updatedAt = now;
        indexState.mode = indexState.mode || mode;
        indexState.embeddings = {
          ...(indexState.embeddings || {}),
          enabled: true,
          ready: true,
          pending: false,
          mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
          service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
          embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
          lastError: null,
          cacheStats: {
            attempts: cacheAttempts,
            hits: cacheHits,
            misses: cacheMisses,
            rejected: cacheRejected,
            fastRejects: cacheFastRejects
          },
          backends: {
            ...(indexState.embeddings?.backends || {}),
            hnsw: hnswState,
            lancedb: lancedbState,
            sqliteVec: sqliteVecState
          },
          updatedAt: now
        };
        if (indexState.enrichment && indexState.enrichment.enabled) {
          indexState.enrichment = {
            ...indexState.enrichment,
            pending: false,
            stage: indexState.enrichment.stage || indexState.stage || 'stage2'
          };
        }
        try {
          await scheduleIo(() => writeIndexState(statePath, indexState));
        } catch {
        // Ignore index state write failures.
        }

        try {
          await scheduleIo(() => updatePieceManifest({ indexDir, mode, totalChunks, dims: finalDims }));
          logArtifactLocation(mode, 'pieces_manifest', path.join(indexDir, 'pieces', 'manifest.json'));
        } catch {
        // Ignore piece manifest write failures.
        }
        logExpectedArtifacts(mode, indexDir, 'pre-validate');

        const validation = await scheduleIo(() => validateIndexArtifacts({
          root,
          indexRoot: modeIndexRoot,
          modes: [mode],
          userConfig,
          sqliteEnabled: false
        }));
        if (!validation.ok) {
          if (validation.issues?.length) {
            error('Index validation issues (first 10):');
            validation.issues.slice(0, 10).forEach((issue) => {
              error(`- ${issue}`);
            });
          }
          if (validation.warnings?.length) {
            warn('Index validation warnings (first 10):');
            validation.warnings.slice(0, 10).forEach((warning) => {
              warn(`- ${warning}`);
            });
          }
          crashLogger.logError({
            phase: `embeddings:${mode}`,
            stage: 'validation',
            message: `[embeddings] ${mode} index validation failed`,
            issues: validation.issues || [],
            warnings: validation.warnings || [],
            hints: validation.hints || []
          });
          throw new Error(`[embeddings] ${mode} index validation failed; see index-validate output for details.`);
        }

        const cacheMetaNow = new Date().toISOString();
        const cacheMetaPayload = {
          version: 1,
          identityKey: cacheIdentityKey,
          identity: cacheIdentity,
          dims: finalDims,
          mode,
          provider: embeddingProvider,
          modelId: modelId || null,
          normalize: embeddingNormalize,
          createdAt: cacheMetaMatches ? (cacheMeta?.createdAt || cacheMetaNow) : cacheMetaNow,
          updatedAt: cacheMetaNow
        };
        try {
          await scheduleIo(() => writeCacheMeta(cacheRoot, cacheIdentity, mode, cacheMetaPayload));
        } catch {
        // Ignore cache meta write failures.
        }

        {
          const vectorSummary = `[embeddings] ${mode}: wrote ${totalChunks} vectors (dims=${finalDims}).`;
          if (typeof display?.logLine === 'function') {
            display.logLine(vectorSummary, { kind: 'status' });
          } else {
            log(vectorSummary);
          }
        }
        writerStatsByMode[mode] = writerQueue.stats();
        const schedulerStats = scheduler?.stats?.();
        const starvationCount = schedulerStats?.counters?.starvation ?? 0;
        if (starvationCount > 0) {
          const starvedQueues = Object.entries(schedulerStats?.queues || {})
            .filter(([, stats]) => stats.starvation > 0)
            .map(([name, stats]) => `${name}:${stats.starvation}`)
            .join(', ');
          warn(`[embeddings] scheduler starvation events: ${starvationCount}${starvedQueues ? ` (${starvedQueues})` : ''}`);
        }
        finishMode(`built ${mode}`);
      } catch (err) {
        logExpectedArtifacts(mode, indexDir, 'failure');
        const now = new Date().toISOString();
        const failureState = loadIndexState(statePath);
        failureState.generatedAt = failureState.generatedAt || now;
        failureState.updatedAt = now;
        failureState.mode = failureState.mode || mode;
        failureState.embeddings = {
          ...(failureState.embeddings || {}),
          enabled: true,
          ready: false,
          pending: false,
          mode: failureState.embeddings?.mode || resolvedEmbeddingMode,
          service: failureState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
          embeddingIdentity: cacheIdentity || failureState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || failureState.embeddings?.embeddingIdentityKey || null,
          lastError: err?.message || String(err),
          updatedAt: now
        };
        if (failureState.enrichment && failureState.enrichment.enabled) {
          failureState.enrichment = {
            ...failureState.enrichment,
            pending: false,
            stage: failureState.enrichment.stage || failureState.stage || 'stage2'
          };
        }
        try {
          await scheduleIo(() => writeIndexState(statePath, failureState));
        } catch {
          // Ignore index state write failures.
        }
        throw err;
      } finally {
        if (stageCheckpoints) {
          await stageCheckpoints.flush();
        }
      }
    }

    for (const tracker of buildStateTrackers.values()) {
      if (!tracker?.hasBuildState || !tracker.runningMarked) continue;
      await markBuildPhase(tracker.root, 'stage3', 'done');
    }
    return { modes, scheduler: scheduler?.stats?.(), writer: writerStatsByMode };
  } catch (err) {
    crashLogger.logError({
      phase: 'stage3',
      stage: 'embeddings',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
    throw err;
  } finally {
    scheduler?.shutdown?.();
    finalize();
  }
}

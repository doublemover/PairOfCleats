import path from 'node:path';
import { createHash } from 'node:crypto';
import { toPosix } from '../../../shared/files.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { DOCUMENT_CHUNKER_VERSION } from '../../chunking/formats/document-common.js';
import { DOCUMENT_EXTRACTION_REASON_CODES } from '../../extractors/common.js';

const DOCUMENT_SOURCE_EXT_TO_TYPE = new Map([
  ['.pdf', 'pdf'],
  ['.docx', 'docx']
]);

const DOCUMENT_EXTRACTION_REASON_SET = new Set(DOCUMENT_EXTRACTION_REASON_CODES);

const sha256Hex = (value) => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const INDEX_STATE_NONDETERMINISTIC_FIELDS = Object.freeze([
  {
    path: 'generatedAt',
    category: 'time',
    reason: 'generatedAt is stamped per run and expected to drift.',
    source: 'src/index/build/indexer/steps/write.js',
    excludeFromStableHash: true
  },
  {
    path: 'updatedAt',
    category: 'time',
    reason: 'updatedAt is refreshed by post-build stages and tools.',
    source: 'tools/build/sqlite/index-state.js',
    excludeFromStableHash: true
  },
  {
    path: 'embeddings.updatedAt',
    category: 'time',
    reason: 'embeddings updatedAt reflects stage3 execution timing per run.',
    source: 'tools/build/embeddings/runner.js',
    excludeFromStableHash: true
  },
  {
    path: 'buildId',
    category: 'run_identity',
    reason: 'buildId includes timestamp and invocation identity.',
    source: 'src/index/build/runtime/runtime.js',
    excludeFromStableHash: true
  },
  {
    path: 'stage',
    category: 'run_identity',
    reason: 'stage reflects current lifecycle and may vary by run mode.',
    source: 'src/index/build/indexer/steps/write.js',
    excludeFromStableHash: false
  },
  {
    path: 'enrichment.pending',
    category: 'run_outcome',
    reason: 'enrichment pending status depends on asynchronous stage completion.',
    source: 'src/index/build/indexer/steps/write.js',
    excludeFromStableHash: false
  },
  {
    path: 'enrichment.stage',
    category: 'run_outcome',
    reason: 'enrichment stage is updated by downstream build tools.',
    source: 'tools/build/embeddings/runner.js',
    excludeFromStableHash: false
  },
  {
    path: 'repoId',
    category: 'environment',
    reason: 'repoId is derived from absolute path context.',
    source: 'tools/dict-utils/paths/repo.js',
    excludeFromStableHash: false
  },
  {
    path: 'sqlite',
    category: 'runtime_capacity',
    reason: 'sqlite state contains run-local timing, capacity, and machine-specific paths.',
    source: 'tools/build/sqlite/index-state.js',
    excludeFromStableHash: true
  },
  {
    path: 'lmdb',
    category: 'runtime_capacity',
    reason: 'lmdb state includes machine-local sizing and execution status.',
    source: 'tools/build/lmdb-index.js',
    excludeFromStableHash: true
  },
  {
    path: 'sqlite.threadLimits',
    category: 'runtime_capacity',
    reason: 'sqlite thread limits derive from host/runtime envelope.',
    source: 'tools/build/sqlite/runner.js',
    excludeFromStableHash: true
  },
  {
    path: 'shards.enabled',
    category: 'runtime_capacity',
    reason: 'shard mode toggles execution strategy, not indexed corpus content.',
    source: 'src/index/build/shards.js',
    excludeFromStableHash: true
  },
  {
    path: 'shards.plan',
    category: 'runtime_capacity',
    reason: 'shard planning includes perf-derived cost estimates.',
    source: 'src/index/build/shards.js',
    excludeFromStableHash: true
  }
]);

const cloneJsonValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {}
  }
  return JSON.parse(JSON.stringify(value));
};

const deletePath = (target, pathValue) => {
  if (!target || typeof target !== 'object') return;
  const segments = String(pathValue || '').split('.').filter(Boolean);
  if (!segments.length) return;
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    if (!cursor || typeof cursor !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(cursor, key)) return;
    cursor = cursor[key];
  }
  if (cursor && typeof cursor === 'object') {
    delete cursor[segments[segments.length - 1]];
  }
};

const normalizeExtractionFilePath = (file, root) => {
  const raw = String(file || '');
  if (!raw) return raw;
  const normalizedRaw = toPosix(raw);
  if (!root || !path.isAbsolute(raw)) return normalizedRaw;
  const rel = toPosix(path.relative(root, raw));
  return rel && !rel.startsWith('..') ? rel : normalizedRaw;
};

const resolveDocumentSourceType = (filePath, fallback = null) => {
  if (fallback === 'pdf' || fallback === 'docx') return fallback;
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return DOCUMENT_SOURCE_EXT_TO_TYPE.get(ext) || null;
};

const buildExtractionIdentityHash = ({
  bytesHash,
  extractorVersion,
  normalizationPolicy,
  chunkerVersion,
  extractionConfigDigest
}) => sha256Hex([
  String(bytesHash || ''),
  String(extractorVersion || ''),
  String(normalizationPolicy || ''),
  String(chunkerVersion || ''),
  String(extractionConfigDigest || '')
].join('|'));

/**
 * Build deterministic extracted-document provenance report rows.
 *
 * Includes successful extraction identity hashes and skipped-file reasons so
 * incremental/report consumers can explain coverage changes.
 *
 * @param {{state:object,root:string,mode:string,documentExtractionConfig?:object}} input
 * @returns {object}
 */
export const buildExtractionReport = ({
  state,
  root,
  mode,
  documentExtractionConfig
}) => {
  const configDigest = sha256Hex(stableStringifyForSignature(documentExtractionConfig || {}));
  const entries = new Map();
  const fileInfoByPath = state?.fileInfoByPath;
  if (fileInfoByPath && typeof fileInfoByPath.entries === 'function') {
    for (const [file, info] of fileInfoByPath.entries()) {
      const extraction = info?.extraction;
      if (!extraction || extraction.status !== 'ok') continue;
      const normalizedFile = normalizeExtractionFilePath(file, root);
      const sourceType = resolveDocumentSourceType(normalizedFile, extraction.sourceType || null);
      if (!sourceType) continue;
      const extractorVersion = extraction?.extractor?.version || null;
      entries.set(normalizedFile, {
        file: normalizedFile,
        sourceType,
        status: 'ok',
        reason: null,
        extractor: extraction.extractor || null,
        sourceBytesHash: extraction.sourceBytesHash || null,
        sourceBytesHashAlgo: extraction.sourceBytesHashAlgo || 'sha256',
        normalizationPolicy: extraction.normalizationPolicy || null,
        chunkerVersion: DOCUMENT_CHUNKER_VERSION,
        extractionConfigDigest: configDigest,
        extractionIdentityHash: buildExtractionIdentityHash({
          bytesHash: extraction.sourceBytesHash,
          extractorVersion,
          normalizationPolicy: extraction.normalizationPolicy,
          chunkerVersion: DOCUMENT_CHUNKER_VERSION,
          extractionConfigDigest: configDigest
        }),
        unitCounts: {
          pages: Number(extraction?.counts?.pages) || 0,
          paragraphs: Number(extraction?.counts?.paragraphs) || 0,
          totalUnits: Number(extraction?.counts?.totalUnits) || 0
        },
        warnings: Array.isArray(extraction?.warnings) ? extraction.warnings : []
      });
    }
  }
  for (const skipped of state?.skippedFiles || []) {
    const filePath = normalizeExtractionFilePath(skipped?.file, root);
    const sourceType = resolveDocumentSourceType(filePath, skipped?.sourceType || null);
    if (!filePath || !sourceType) continue;
    if (entries.get(filePath)?.status === 'ok') continue;
    const reasonRaw = String(skipped?.reason || 'extract_failed');
    const reason = DOCUMENT_EXTRACTION_REASON_SET.has(reasonRaw) ? reasonRaw : 'extract_failed';
    entries.set(filePath, {
      file: filePath,
      sourceType,
      status: 'skipped',
      reason,
      extractor: null,
      sourceBytesHash: null,
      sourceBytesHashAlgo: null,
      normalizationPolicy: null,
      chunkerVersion: DOCUMENT_CHUNKER_VERSION,
      extractionConfigDigest: configDigest,
      extractionIdentityHash: null,
      unitCounts: null,
      warnings: Array.isArray(skipped?.warnings) ? skipped.warnings : []
    });
  }
  const files = Array.from(entries.values()).sort((a, b) => (
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  ));
  const byReason = {};
  let okCount = 0;
  let skippedCount = 0;
  for (const file of files) {
    if (file.status === 'ok') {
      okCount += 1;
      continue;
    }
    skippedCount += 1;
    const reason = file.reason || 'extract_failed';
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  const extractorMap = new Map();
  for (const file of files) {
    if (!file.extractor) continue;
    const key = [
      file.extractor?.name || '',
      file.extractor?.version || '',
      file.extractor?.target || ''
    ].join('|');
    if (!extractorMap.has(key)) {
      extractorMap.set(key, {
        name: file.extractor?.name || null,
        version: file.extractor?.version || null,
        target: file.extractor?.target || null
      });
    }
  }
  return {
    schemaVersion: 1,
    mode,
    generatedAt: new Date().toISOString(),
    chunkerVersion: DOCUMENT_CHUNKER_VERSION,
    extractionConfigDigest: configDigest,
    counts: {
      total: files.length,
      ok: okCount,
      skipped: skippedCount,
      byReason
    },
    extractors: Array.from(extractorMap.values()),
    files
  };
};

export const getIndexStateNondeterministicFields = () => (
  INDEX_STATE_NONDETERMINISTIC_FIELDS.map((entry) => ({ ...entry }))
);

export const stripIndexStateNondeterministicFields = (indexState, { forStableHash = true } = {}) => {
  if (!indexState || typeof indexState !== 'object') return indexState;
  const next = cloneJsonValue(indexState);
  const applicable = INDEX_STATE_NONDETERMINISTIC_FIELDS.filter((entry) => (
    forStableHash ? entry.excludeFromStableHash : true
  ));
  for (const entry of applicable) {
    deletePath(next, entry.path);
  }
  return next;
};

export const buildDeterminismReport = ({ mode, indexState } = {}) => {
  const stripped = stripIndexStateNondeterministicFields(indexState, { forStableHash: true });
  const normalizedStateHash = stripped && typeof stripped === 'object'
    ? sha256Hex(stableStringifyForSignature(stripped))
    : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: mode || null,
    stableHashExclusions: INDEX_STATE_NONDETERMINISTIC_FIELDS
      .filter((entry) => entry.excludeFromStableHash)
      .map((entry) => entry.path),
    sourceReasons: INDEX_STATE_NONDETERMINISTIC_FIELDS.map((entry) => ({
      path: entry.path,
      category: entry.category,
      reason: entry.reason,
      source: entry.source
    })),
    normalizedStateHash
  };
};

/**
 * Build per-file lexicon relation filter drop report.
 * Captures dropped calls/usages plus category breakdowns and deterministic
 * sorting so report diffs remain stable across runs.
 *
 * @param {{state:object,mode:string}} input
 * @returns {object}
 */
export const buildLexiconRelationFilterReport = ({ state, mode }) => {
  const relationStats = state?.lexiconRelationFilterByFile;
  const entries = relationStats && typeof relationStats.entries === 'function'
    ? Array.from(relationStats.entries())
    : [];
  const files = entries
    .map(([file, stats]) => ({
      file,
      languageId: stats?.languageId || null,
      droppedCalls: Number(stats?.droppedCalls) || 0,
      droppedUsages: Number(stats?.droppedUsages) || 0,
      droppedCallDetails: Number(stats?.droppedCallDetails) || 0,
      droppedCallDetailsWithRange: Number(stats?.droppedCallDetailsWithRange) || 0,
      droppedTotal: Number(stats?.droppedTotal) || 0,
      droppedCallsByCategory: {
        ...(stats?.droppedCallsByCategory || {})
      },
      droppedUsagesByCategory: {
        ...(stats?.droppedUsagesByCategory || {})
      }
    }))
    .sort((a, b) => (a.file < b.file ? -1 : (a.file > b.file ? 1 : 0)));

  const totals = {
    files: files.length,
    droppedCalls: 0,
    droppedUsages: 0,
    droppedCallDetails: 0,
    droppedCallDetailsWithRange: 0,
    droppedTotal: 0
  };
  for (const entry of files) {
    totals.droppedCalls += entry.droppedCalls;
    totals.droppedUsages += entry.droppedUsages;
    totals.droppedCallDetails += entry.droppedCallDetails;
    totals.droppedCallDetailsWithRange += entry.droppedCallDetailsWithRange;
    totals.droppedTotal += entry.droppedTotal;
  }

  return {
    schemaVersion: 1,
    mode,
    totals,
    files
  };
};

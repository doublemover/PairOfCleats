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

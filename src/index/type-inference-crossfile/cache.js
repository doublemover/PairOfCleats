import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot, getRepoRoot } from '../../shared/dict-utils.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

export const CROSS_FILE_CACHE_SCHEMA_VERSION = 1;
export const CROSS_FILE_CACHE_DIRNAME = 'cross-file-inference';
export const DEFAULT_CROSS_FILE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CROSS_FILE_CACHE_READ_MAX_BYTES = 12 * 1024 * 1024;
const CROSS_FILE_CACHE_ROW_VALUE_PRIORITY = Object.freeze({
  'relations+docmeta': 3,
  'relations-only': 2,
  'docmeta-only': 1,
  empty: 0
});

const compareStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

/**
 * Normalize fileRelations into deterministic, content-sensitive signatures.
 *
 * Counts alone are not sufficient because different relation payloads can share
 * identical usage totals and would otherwise collide in cache fingerprints.
 *
 * @param {object|Map<string,object>|null} fileRelations
 * @returns {Array<{file:string,usages:number,relationHash:string}>|null}
 */
const resolveFileRelationSignatures = (fileRelations) => {
  if (!fileRelations) return null;
  try {
    const entries = typeof fileRelations.entries === 'function'
      ? Array.from(fileRelations.entries())
      : Object.entries(fileRelations);
    return entries
      .map(([file, relation]) => ({
        file,
        usages: Array.isArray(relation?.usages) ? relation.usages.length : 0,
        relationHash: sha1(stableStringify(relation || null))
      }))
      .sort((a, b) => compareStrings(String(a.file || ''), String(b.file || '')));
  } catch {
    return null;
  }
};

const normalizeCacheMaxBytes = (value) => {
  if (value === null || value === undefined) return DEFAULT_CROSS_FILE_CACHE_MAX_BYTES;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CROSS_FILE_CACHE_MAX_BYTES;
  return Math.max(0, Math.floor(parsed));
};

const normalizeCacheStats = (cacheStats) => ({
  linkedCalls: Number(cacheStats?.linkedCalls) || 0,
  linkedUsages: Number(cacheStats?.linkedUsages) || 0,
  inferredReturns: Number(cacheStats?.inferredReturns) || 0,
  riskFlows: Number(cacheStats?.riskFlows) || 0,
  toolingDegradedProviders: Number(cacheStats?.toolingDegradedProviders) || 0,
  toolingDegradedWarnings: Number(cacheStats?.toolingDegradedWarnings) || 0,
  toolingDegradedErrors: Number(cacheStats?.toolingDegradedErrors) || 0,
  toolingProvidersExecuted: Number(cacheStats?.toolingProvidersExecuted) || 0,
  toolingProvidersContributed: Number(cacheStats?.toolingProvidersContributed) || 0,
  toolingRequests: Number(cacheStats?.toolingRequests) || 0,
  toolingRequestFailures: Number(cacheStats?.toolingRequestFailures) || 0,
  toolingRequestTimeouts: Number(cacheStats?.toolingRequestTimeouts) || 0,
  droppedCallLinks: Number(cacheStats?.droppedCallLinks) || 0,
  droppedCallSummaries: Number(cacheStats?.droppedCallSummaries) || 0,
  droppedUsageLinks: Number(cacheStats?.droppedUsageLinks) || 0,
  bundleSizing: cacheStats?.bundleSizing || null,
  inferenceLiteEnabled: cacheStats?.inferenceLiteEnabled === true
});

const classifyCrossFileCacheRow = (row) => {
  const hasRelations = row?.codeRelations && typeof row.codeRelations === 'object';
  const hasDocmeta = row?.docmeta && typeof row.docmeta === 'object';
  if (hasRelations && hasDocmeta) return 'relations+docmeta';
  if (hasRelations) return 'relations-only';
  if (hasDocmeta) return 'docmeta-only';
  return 'empty';
};

const buildAdmissionBreakdown = (entries = []) => {
  const counts = Object.create(null);
  const bytes = Object.create(null);
  for (const entry of entries) {
    const rowClass = classifyCrossFileCacheRow(entry?.row);
    counts[rowClass] = (counts[rowClass] || 0) + 1;
    bytes[rowClass] = (bytes[rowClass] || 0) + Math.max(0, Math.floor(Number(entry?.rowBytes) || 0));
  }
  return {
    counts,
    bytes
  };
};

const selectCrossFileCacheRowsForAdmission = ({
  rowEntries,
  baseBytes,
  maxBytes
}) => {
  const ranked = [...rowEntries].sort((left, right) => {
    const leftClass = classifyCrossFileCacheRow(left?.row);
    const rightClass = classifyCrossFileCacheRow(right?.row);
    const priorityDelta = (CROSS_FILE_CACHE_ROW_VALUE_PRIORITY[rightClass] || 0)
      - (CROSS_FILE_CACHE_ROW_VALUE_PRIORITY[leftClass] || 0);
    if (priorityDelta !== 0) return priorityDelta;
    const byteDelta = Math.max(0, Math.floor(Number(left?.rowBytes) || 0))
      - Math.max(0, Math.floor(Number(right?.rowBytes) || 0));
    if (byteDelta !== 0) return byteDelta;
    return compareStrings(String(left?.row?.id || ''), String(right?.row?.id || ''));
  });
  const retained = [];
  const dropped = [];
  let estimatedBytes = Math.max(0, Math.floor(Number(baseBytes) || 0));
  for (const entry of ranked) {
    const rowBytes = Math.max(0, Math.floor(Number(entry?.rowBytes) || 0));
    const rowOverhead = retained.length ? 1 : 0;
    if (maxBytes > 0 && (estimatedBytes + rowOverhead + rowBytes) > maxBytes) {
      dropped.push(entry);
      continue;
    }
    retained.push(entry);
    estimatedBytes += rowOverhead + rowBytes;
  }
  return {
    retained: retained.sort((left, right) => (Number(left?.index) || 0) - (Number(right?.index) || 0)),
    dropped,
    estimatedBytes
  };
};

const applyCachedCrossFileOutput = ({ chunks, cacheRows }) => {
  if (!Array.isArray(cacheRows) || !cacheRows.length) return false;
  const chunkById = new Map();
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    chunkById.set(resolveChunkIdentity(chunk, index), chunk);
  }
  let applied = 0;
  for (const row of cacheRows) {
    const id = typeof row?.id === 'string' ? row.id : null;
    if (!id) continue;
    const chunk = chunkById.get(id);
    if (!chunk) continue;
    if (row.codeRelations && typeof row.codeRelations === 'object') {
      chunk.codeRelations = row.codeRelations;
    }
    if (row.docmeta && typeof row.docmeta === 'object') {
      chunk.docmeta = row.docmeta;
    }
    applied += 1;
  }
  return applied > 0;
};

const resolveCrossFileCacheRoot = ({ cacheRoot, rootDir }) => {
  if (typeof cacheRoot === 'string' && cacheRoot.trim()) {
    return cacheRoot.trim();
  }
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    return null;
  }
  try {
    const repoRoot = getRepoRoot(null, rootDir);
    return getRepoCacheRoot(repoRoot);
  } catch {
    return null;
  }
};

export const resolveChunkIdentity = (chunk, index) => {
  if (!chunk || typeof chunk !== 'object') return `idx:${index}`;
  return chunk.chunkUid
    || chunk.metaV2?.chunkUid
    || `${chunk.file || '<unknown>'}:${chunk.name || '<anon>'}:${chunk.start || 0}:${chunk.end || 0}:${index}`;
};

export const resolveCrossFileCacheLocation = ({
  cacheRoot = null,
  cacheEnabled = true,
  rootDir
}) => {
  const resolvedCacheRoot = cacheEnabled === false
    ? null
    : resolveCrossFileCacheRoot({ cacheRoot, rootDir });
  const cacheDir = resolvedCacheRoot
    ? path.join(resolvedCacheRoot, CROSS_FILE_CACHE_DIRNAME)
    : null;
  return {
    cacheDir,
    cachePath: cacheDir ? path.join(cacheDir, 'output-cache.json') : null
  };
};

export const buildCrossFileFingerprint = ({
  chunks,
  enableTypeInference,
  enableRiskCorrelation,
  useTooling,
  fileRelations,
  inferenceLite = false,
  inferenceLiteHighSignalOnly = true
}) => {
  const fileRelationSignatures = resolveFileRelationSignatures(fileRelations);
  const chunkSignatures = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk || typeof chunk !== 'object') continue;
    const relations = chunk.codeRelations || {};
    const relationPayload = {
      calls: Array.isArray(relations.calls) ? relations.calls : [],
      callDetails: Array.isArray(relations.callDetails)
        ? relations.callDetails.map((entry) => ({
          callee: entry?.callee || null,
          args: Array.isArray(entry?.args) ? entry.args : [],
          targetChunkUid: entry?.targetChunkUid || null,
          targetCandidates: Array.isArray(entry?.targetCandidates) ? entry.targetCandidates : []
        }))
        : [],
      usages: Array.isArray(relations.usages) ? relations.usages : []
    };
    chunkSignatures.push({
      id: resolveChunkIdentity(chunk, index),
      file: chunk.file || null,
      name: chunk.name || null,
      kind: chunk.kind || null,
      start: Number.isFinite(chunk.start) ? chunk.start : 0,
      end: Number.isFinite(chunk.end) ? chunk.end : 0,
      relationHash: sha1(stableStringify(relationPayload)),
      docmetaHash: sha1(stableStringify(chunk.docmeta || null))
    });
  }
  return sha1(stableStringify({
    schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
    enableTypeInference: enableTypeInference === true,
    enableRiskCorrelation: enableRiskCorrelation === true,
    useTooling: useTooling === true,
    inferenceLite: inferenceLite === true,
    inferenceLiteHighSignalOnly: inferenceLiteHighSignalOnly !== false,
    chunks: chunkSignatures,
    fileRelations: fileRelationSignatures
  }));
};

export const readCrossFileInferenceCache = async ({
  cachePath,
  chunks,
  crossFileFingerprint,
  log = () => {},
  maxReadBytes = DEFAULT_CROSS_FILE_CACHE_READ_MAX_BYTES
}) => {
  if (!cachePath) return null;
  try {
    if (Number.isFinite(maxReadBytes) && maxReadBytes > 0) {
      const stat = await fs.stat(cachePath);
      if (Number.isFinite(stat?.size) && stat.size > maxReadBytes) {
        if (typeof log === 'function') {
          log(
            `[perf] cross-file cache read skipped: cache size ${stat.size} bytes exceeds max ${maxReadBytes} bytes.`
          );
        }
        return null;
      }
    }
    const raw = await fs.readFile(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    const cacheStats = cached?.stats && typeof cached.stats === 'object'
      ? cached.stats
      : null;
    const admission = cached?.admission && typeof cached.admission === 'object'
      ? cached.admission
      : null;
    if (
      Number(cached?.schemaVersion) === CROSS_FILE_CACHE_SCHEMA_VERSION
      && typeof cached?.fingerprint === 'string'
      && cached.fingerprint === crossFileFingerprint
      && Array.isArray(cached?.rows)
    ) {
      const applied = applyCachedCrossFileOutput({
        chunks,
        cacheRows: cached.rows
      });
      if (applied) {
        if (typeof log === 'function') {
          const droppedRows = Math.max(0, Math.floor(Number(admission?.droppedRows) || 0));
          log(
            droppedRows > 0
              ? `[perf] cross-file cache hit: restored ${cached.rows.length} chunk updates (partial, dropped=${droppedRows}).`
              : `[perf] cross-file cache hit: restored ${cached.rows.length} chunk updates.`
          );
        }
        return normalizeCacheStats(cacheStats);
      }
    }
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return null;
    }
    if (typeof log === 'function') {
      log(`[perf] cross-file cache read failed: ${err?.message || err}`);
    }
  }
  return null;
};

/**
 * Persist cross-file inference output only when the projected JSON payload
 * remains within the configured byte cap. Oversized payloads are skipped so
 * this cache cannot grow without bound on large repos.
 *
 * @param {{
 *   cacheDir:string|null,
 *   cachePath:string|null,
 *   chunks:Array<object>,
 *   crossFileFingerprint:string,
 *   stats:object,
 *   maxBytes?:number,
 *   log?:(line:string)=>void
 * }} input
 * @returns {Promise<void>}
 */
export const writeCrossFileInferenceCache = async ({
  cacheDir,
  cachePath,
  chunks,
  crossFileFingerprint,
  stats,
  maxBytes = DEFAULT_CROSS_FILE_CACHE_MAX_BYTES,
  log = () => {}
}) => {
  if (!cacheDir || !cachePath) return;
  try {
    const generatedAt = new Date().toISOString();
    const normalizedStats = normalizeCacheStats(stats);
    const cacheMaxBytes = normalizeCacheMaxBytes(maxBytes);
    const baseBytes = Buffer.byteLength(JSON.stringify({
      schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
      generatedAt,
      fingerprint: crossFileFingerprint,
      stats: normalizedStats,
      admission: null,
      rows: []
    }), 'utf8');
    const rowEntries = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const row = {
        id: resolveChunkIdentity(chunk, index),
        codeRelations: chunk?.codeRelations && typeof chunk.codeRelations === 'object'
          ? chunk.codeRelations
          : null,
        docmeta: chunk?.docmeta && typeof chunk.docmeta === 'object'
          ? chunk.docmeta
          : null
      };
      const rowJson = JSON.stringify(row);
      const rowBytes = Buffer.byteLength(rowJson, 'utf8');
      rowEntries.push({ index, row, rowBytes });
    }
    const admissionSelection = selectCrossFileCacheRowsForAdmission({
      rowEntries,
      baseBytes,
      maxBytes: cacheMaxBytes
    });
    const rows = admissionSelection.retained.map((entry) => entry.row);
    if (!rows.length && rowEntries.length > 0) {
      if (typeof log === 'function') {
        log(
          `[perf] cross-file cache write skipped: no cache rows fit within max ${cacheMaxBytes} bytes.`
        );
      }
      return;
    }
    const retainedBreakdown = buildAdmissionBreakdown(admissionSelection.retained);
    const droppedBreakdown = buildAdmissionBreakdown(admissionSelection.dropped);
    const admission = {
      mode: admissionSelection.dropped.length > 0 ? 'value-ranked-partial' : 'full',
      maxBytes: cacheMaxBytes,
      retainedRows: rows.length,
      droppedRows: admissionSelection.dropped.length,
      retainedBytes: admissionSelection.estimatedBytes,
      estimatedFullBytes: baseBytes
        + rowEntries.reduce((sum, entry, index) => (
          sum + Math.max(0, Math.floor(Number(entry?.rowBytes) || 0)) + (index > 0 ? 1 : 0)
        ), 0),
      breakdown: {
        retained: retainedBreakdown,
        dropped: droppedBreakdown
      }
    };
    if (typeof log === 'function' && admissionSelection.dropped.length > 0) {
      log(
        `[perf] cross-file cache write truncated: retained ${rows.length}/${rowEntries.length} rows `
        + `within ${cacheMaxBytes} bytes (dropped=${admissionSelection.dropped.length}).`
      );
    }
    await writeJsonObjectFile(cachePath, {
      trailingNewline: false,
      fields: {
        schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
        generatedAt,
        fingerprint: crossFileFingerprint,
        stats: normalizedStats,
        admission
      },
      arrays: { rows },
      atomic: true
    });
  } catch (err) {
    if (typeof log === 'function') {
      log(`[perf] cross-file cache write failed: ${err?.message || err}`);
    }
  }
};

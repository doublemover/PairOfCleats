import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot, getRepoRoot } from '../../shared/dict-utils.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

export const CROSS_FILE_CACHE_SCHEMA_VERSION = 1;
export const CROSS_FILE_CACHE_DIRNAME = 'cross-file-inference';
export const DEFAULT_CROSS_FILE_CACHE_MAX_BYTES = 8 * 1024 * 1024;

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
  droppedCallLinks: Number(cacheStats?.droppedCallLinks) || 0,
  droppedCallSummaries: Number(cacheStats?.droppedCallSummaries) || 0,
  droppedUsageLinks: Number(cacheStats?.droppedUsageLinks) || 0,
  bundleSizing: cacheStats?.bundleSizing || null,
  inferenceLiteEnabled: cacheStats?.inferenceLiteEnabled === true
});

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
  fileRelations
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
    chunks: chunkSignatures,
    fileRelations: fileRelationSignatures
  }));
};

export const readCrossFileInferenceCache = async ({
  cachePath,
  chunks,
  crossFileFingerprint,
  log = () => {}
}) => {
  if (!cachePath) return null;
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    const cacheStats = cached?.stats && typeof cached.stats === 'object'
      ? cached.stats
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
          log(`[perf] cross-file cache hit: restored ${cached.rows.length} chunk updates.`);
        }
        return normalizeCacheStats(cacheStats);
      }
    }
  } catch {}
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
    let estimatedBytes = Buffer.byteLength(JSON.stringify({
      schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
      generatedAt,
      fingerprint: crossFileFingerprint,
      stats: normalizedStats,
      rows: []
    }), 'utf8');
    const rows = [];
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
      const rowOverhead = rows.length ? 1 : 0;
      if (cacheMaxBytes > 0 && (estimatedBytes + rowOverhead + rowBytes) > cacheMaxBytes) {
        if (typeof log === 'function') {
          log(
            `[perf] cross-file cache write skipped: projected size ${estimatedBytes + rowOverhead + rowBytes} bytes exceeds max ${cacheMaxBytes} bytes.`
          );
        }
        return;
      }
      rows.push(row);
      estimatedBytes += rowOverhead + rowBytes;
    }
    await writeJsonObjectFile(cachePath, {
      trailingNewline: false,
      fields: {
        schemaVersion: CROSS_FILE_CACHE_SCHEMA_VERSION,
        generatedAt,
        fingerprint: crossFileFingerprint,
        stats: normalizedStats
      },
      arrays: { rows }
    });
  } catch {}
};

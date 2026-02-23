import fsSync from 'node:fs';
import path from 'node:path';
import { readJsonFile, readJsonLinesArraySync } from '../../shared/artifact-io.js';
import { estimateIndexBytes } from './options.js';

const MAX_CHUNK_META_COUNT_PARSE_BYTES = 5 * 1024 * 1024;

/**
 * Read a JSON artifact with a strict byte budget and return `null` on any
 * parse/load failure so callers can continue through fallback probes.
 *
 * @param {string} filePath
 * @returns {any|null}
 */
const readJsonArtifactSafe = (filePath) => {
  try {
    return readJsonFile(filePath, { maxBytes: MAX_CHUNK_META_COUNT_PARSE_BYTES });
  } catch {
    return null;
  }
};

/**
 * Best-effort chunk count extraction across chunk-meta storage variants.
 *
 * Probe order is chosen to prioritize cheap metadata first, then full row
 * formats with bounded read size. Returning `null` signals that count-based
 * auto-thresholds should not be applied.
 *
 * @param {string} indexDir
 * @returns {number|null}
 */
const resolveChunkCountFromChunkArtifacts = (indexDir) => {
  const shardedMeta = readJsonArtifactSafe(path.join(indexDir, 'chunk_meta.meta.json'));
  const shardedFields = shardedMeta?.fields && typeof shardedMeta.fields === 'object'
    ? shardedMeta.fields
    : shardedMeta;
  if (Number.isFinite(shardedFields?.totalRecords)) return shardedFields.totalRecords;
  if (Number.isFinite(shardedFields?.totalChunks)) return shardedFields.totalChunks;

  const binaryMeta = readJsonArtifactSafe(path.join(indexDir, 'chunk_meta.binary-columnar.meta.json'));
  const binaryFields = binaryMeta?.fields && typeof binaryMeta.fields === 'object'
    ? binaryMeta.fields
    : binaryMeta;
  if (Number.isFinite(binaryFields?.count)) return binaryFields.count;
  if (Number.isFinite(binaryFields?.totalRecords)) return binaryFields.totalRecords;

  const jsonRows = readJsonArtifactSafe(path.join(indexDir, 'chunk_meta.json'));
  if (Array.isArray(jsonRows)) return jsonRows.length;

  try {
    const jsonlRows = readJsonLinesArraySync(path.join(indexDir, 'chunk_meta.jsonl'), {
      maxBytes: MAX_CHUNK_META_COUNT_PARSE_BYTES
    });
    if (Array.isArray(jsonlRows)) return jsonlRows.length;
  } catch {}

  const columnar = readJsonArtifactSafe(path.join(indexDir, 'chunk_meta.columnar.json'));
  if (Array.isArray(columnar)) return columnar.length;
  if (Number.isFinite(columnar?.count)) return columnar.count;
  if (Number.isFinite(columnar?.totalRecords)) return columnar.totalRecords;
  if (Array.isArray(columnar?.ids)) return columnar.ids.length;

  return null;
};

/**
 * Resolve per-index statistics used by auto-backend selection heuristics.
 *
 * `chunkCount` prefers manifest-reported counts when available; otherwise it
 * falls back to artifact probes. `artifactBytes` is derived from artifact-size
 * estimation unless already provided by manifest piece metadata.
 *
 * @param {string|null|undefined} indexDir
 * @returns {{chunkCount:number|null,artifactBytes:number|null,missing:boolean}}
 */
export const resolveIndexStats = (indexDir) => {
  if (!indexDir || !fsSync.existsSync(indexDir)) {
    return { chunkCount: null, artifactBytes: null, missing: true };
  }
  let chunkCount = null;
  let artifactBytes = null;
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  const manifest = fsSync.existsSync(manifestPath) ? readJsonArtifactSafe(manifestPath) : null;
  const manifestFields = manifest?.fields && typeof manifest.fields === 'object' ? manifest.fields : manifest;
  if (Array.isArray(manifestFields?.pieces)) {
    let count = 0;
    let countSeen = false;
    let bytes = 0;
    let bytesSeen = false;
    for (const piece of manifestFields.pieces) {
      if (Number.isFinite(piece?.bytes)) {
        bytes += piece.bytes;
        bytesSeen = true;
      }
      if (piece?.type === 'chunks' && piece?.name === 'chunk_meta' && Number.isFinite(piece?.count)) {
        count += piece.count;
        countSeen = true;
      }
    }
    if (countSeen) chunkCount = count;
    if (bytesSeen) artifactBytes = bytes;
  }
  if (chunkCount === null) {
    chunkCount = resolveChunkCountFromChunkArtifacts(indexDir);
  }
  if (artifactBytes === null) {
    artifactBytes = estimateIndexBytes(indexDir);
  }
  return { chunkCount, artifactBytes, missing: false };
};

/**
 * Evaluate whether aggregate index stats satisfy auto-SQLite thresholds.
 *
 * @param {{
 *   stats:Array<{chunkCount:number|null,artifactBytes:number|null}>,
 *   chunkThreshold:number|null|undefined,
 *   artifactThreshold:number|null|undefined
 * }} input
 * @returns {{allowed:boolean,reason:string|null}}
 */
export const evaluateAutoSqliteThresholds = ({
  stats,
  chunkThreshold,
  artifactThreshold
}) => {
  const autoChunkThreshold = Number.isFinite(chunkThreshold) ? Math.max(0, Math.floor(chunkThreshold)) : 0;
  const autoArtifactThreshold = Number.isFinite(artifactThreshold)
    ? Math.max(0, Math.floor(artifactThreshold))
    : 0;
  const thresholdsEnabled = autoChunkThreshold > 0 || autoArtifactThreshold > 0;
  if (!thresholdsEnabled) return { allowed: true, reason: null };

  const totalChunks = stats.every((entry) => entry.chunkCount !== null)
    ? stats.reduce((sum, entry) => sum + entry.chunkCount, 0)
    : null;
  const totalBytes = stats.every((entry) => entry.artifactBytes !== null)
    ? stats.reduce((sum, entry) => sum + entry.artifactBytes, 0)
    : null;
  const meetsChunkThreshold = autoChunkThreshold > 0
    ? totalChunks !== null && totalChunks >= autoChunkThreshold
    : false;
  const meetsBytesThreshold = autoArtifactThreshold > 0
    ? totalBytes !== null && totalBytes >= autoArtifactThreshold
    : false;
  if (meetsChunkThreshold || meetsBytesThreshold) return { allowed: true, reason: null };

  if (totalChunks === null && autoChunkThreshold > 0) {
    return {
      allowed: false,
      reason: 'auto sqlite thresholds require chunk counts, but chunk stats are unavailable'
    };
  }
  if (totalBytes === null && autoArtifactThreshold > 0) {
    return {
      allowed: false,
      reason: 'auto sqlite thresholds require artifact bytes, but artifact bytes are unavailable'
    };
  }
  return {
    allowed: false,
    reason: `auto sqlite thresholds not met (chunks ${totalChunks ?? 'unknown'}/${autoChunkThreshold || 'n/a'}, bytes ${totalBytes ?? 'unknown'}/${autoArtifactThreshold || 'n/a'})`
  };
};

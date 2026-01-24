import fsSync from 'node:fs';
import path from 'node:path';
import { estimateIndexBytes } from './options.js';

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

export const resolveIndexStats = (indexDir) => {
  if (!indexDir || !fsSync.existsSync(indexDir)) {
    return { chunkCount: null, artifactBytes: null, missing: true };
  }
  let chunkCount = null;
  let artifactBytes = null;
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  const manifest = fsSync.existsSync(manifestPath) ? readJsonFile(manifestPath) : null;
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
    const chunkMetaMetaPath = path.join(indexDir, 'chunk_meta.meta.json');
    if (fsSync.existsSync(chunkMetaMetaPath)) {
      const meta = readJsonFile(chunkMetaMetaPath);
      const metaFields = meta?.fields && typeof meta.fields === 'object' ? meta.fields : meta;
      if (Number.isFinite(metaFields?.totalRecords)) chunkCount = metaFields.totalRecords;
      if (chunkCount === null && Number.isFinite(metaFields?.totalChunks)) chunkCount = metaFields.totalChunks;
    } else {
      const chunkMetaPath = path.join(indexDir, 'chunk_meta.json');
      if (fsSync.existsSync(chunkMetaPath)) {
        try {
          const stat = fsSync.statSync(chunkMetaPath);
          if (stat.size <= 5 * 1024 * 1024) {
            const data = readJsonFile(chunkMetaPath);
            if (Array.isArray(data)) chunkCount = data.length;
          }
        } catch {}
      }
    }
  }
  if (artifactBytes === null) {
    artifactBytes = estimateIndexBytes(indexDir);
  }
  return { chunkCount, artifactBytes, missing: false };
};

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

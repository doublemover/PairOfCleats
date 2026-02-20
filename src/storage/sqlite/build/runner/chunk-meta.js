import fsSync from 'node:fs';
import path from 'node:path';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  resolveArtifactPresence
} from '../../../../shared/artifact-io.js';

const CHUNK_META_PROBE_MAX_BYTES = 64 * 1024;
const CHUNK_META_WHITESPACE = /\s/u;

const isChunkMetaWhitespace = (char) => {
  return char === '\uFEFF' || CHUNK_META_WHITESPACE.test(char);
};

const toNonNegativeInteger = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
};

const resolveChunkMetaCountFromMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  const direct = toNonNegativeInteger(meta.totalRecords ?? meta.total ?? meta.count);
  if (direct != null) return direct;
  if (!Array.isArray(meta.parts) || !meta.parts.length) return null;
  let total = 0;
  for (const part of meta.parts) {
    if (!part || typeof part !== 'object') return null;
    const count = toNonNegativeInteger(part.records ?? part.count);
    if (count == null) return null;
    total += count;
  }
  return total;
};

const resolveChunkMetaCountFromManifest = (manifest) => {
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  if (!pieces.length) return null;
  let sawChunkMeta = false;
  let total = 0;
  for (const piece of pieces) {
    if (piece?.name !== 'chunk_meta') continue;
    sawChunkMeta = true;
    const count = toNonNegativeInteger(piece?.count);
    if (count == null) return null;
    total += count;
  }
  return sawChunkMeta ? total : null;
};

const isUncompressedJsonPath = (targetPath) => {
  return typeof targetPath === 'string'
    && targetPath.endsWith('.json')
    && !targetPath.endsWith('.json.gz')
    && !targetPath.endsWith('.json.zst');
};

const isUncompressedJsonlPath = (targetPath) => {
  return typeof targetPath === 'string'
    && targetPath.endsWith('.jsonl')
    && !targetPath.endsWith('.jsonl.gz')
    && !targetPath.endsWith('.jsonl.zst');
};

const probeChunkMetaJsonArrayEmpty = (filePath, maxProbeBytes = CHUNK_META_PROBE_MAX_BYTES) => {
  if (!isUncompressedJsonPath(filePath) || !Number.isFinite(maxProbeBytes) || maxProbeBytes <= 0) return null;
  let fd = null;
  try {
    fd = fsSync.openSync(filePath, 'r');
    const chunkSize = 2048;
    const buffer = Buffer.alloc(chunkSize);
    let state = 0;
    let consumed = 0;
    let bytesRead = 0;
    while (consumed < maxProbeBytes
      && (bytesRead = fsSync.readSync(fd, buffer, 0, Math.min(chunkSize, maxProbeBytes - consumed), null)) > 0) {
      consumed += bytesRead;
      const chunk = buffer.toString('utf8', 0, bytesRead);
      for (const char of chunk) {
        if (isChunkMetaWhitespace(char)) continue;
        if (state === 0) {
          if (char === '[') {
            state = 1;
            continue;
          }
          return null;
        }
        if (state === 1) {
          if (char === ']') return true;
          return false;
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fsSync.closeSync(fd);
      } catch {}
    }
  }
};

const probeChunkMetaJsonlIsEmpty = (filePath, maxProbeBytes = CHUNK_META_PROBE_MAX_BYTES) => {
  if (!isUncompressedJsonlPath(filePath) || !Number.isFinite(maxProbeBytes) || maxProbeBytes <= 0) return null;
  let fd = null;
  try {
    fd = fsSync.openSync(filePath, 'r');
    const chunkSize = 4096;
    const buffer = Buffer.alloc(chunkSize);
    let bytesRead = 0;
    let carry = '';
    let consumed = 0;
    while (consumed < maxProbeBytes
      && (bytesRead = fsSync.readSync(fd, buffer, 0, Math.min(chunkSize, maxProbeBytes - consumed), null)) > 0) {
      consumed += bytesRead;
      carry += buffer.toString('utf8', 0, bytesRead);
      if (carry && carry.charCodeAt(0) === 0xfeff) {
        carry = carry.slice(1);
      }
      let newlineIndex = carry.indexOf('\n');
      while (newlineIndex >= 0) {
        let line = carry.slice(0, newlineIndex);
        carry = carry.slice(newlineIndex + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        if (line.trim().length > 0) {
          return false;
        }
        newlineIndex = carry.indexOf('\n');
      }
    }
    if (consumed >= maxProbeBytes) return null;
    return carry.trim().length === 0;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fsSync.closeSync(fd);
      } catch {}
    }
  }
};

/**
 * Best-effort chunk count probe used to skip redundant empty-mode rebuilds.
 *
 * Prefers `chunk_meta.meta.json` when present, then falls back to legacy
 * monolithic JSON/JSONL artifacts. Returns `null` when count cannot be
 * determined safely from on-disk metadata.
 *
 * @param {string} indexDir
 * @returns {number|null}
 */
export const resolveChunkMetaTotalRecords = (indexDir) => {
  if (!indexDir || typeof indexDir !== 'string') return null;
  const readJsonSafe = (targetPath) => {
    try {
      return JSON.parse(fsSync.readFileSync(targetPath, 'utf8'));
    } catch {
      return null;
    }
  };
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  const manifestBakPath = `${manifestPath}.bak`;
  let manifest = null;
  if (fsSync.existsSync(manifestPath) || fsSync.existsSync(manifestBakPath)) {
    try {
      manifest = loadPiecesManifest(indexDir, {
        maxBytes: MAX_JSON_BYTES,
        strict: false
      });
    } catch {}
  }
  let presence = null;
  if (manifest) {
    try {
      presence = resolveArtifactPresence(indexDir, 'chunk_meta', {
        manifest,
        maxBytes: MAX_JSON_BYTES,
        strict: false
      });
    } catch {}
  }
  const metaCount = resolveChunkMetaCountFromMeta(presence?.meta);
  if (metaCount != null) return metaCount;
  const localMetaPath = path.join(indexDir, 'chunk_meta.meta.json');
  if (fsSync.existsSync(localMetaPath)) {
    const metaRaw = readJsonSafe(localMetaPath);
    const localMeta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const localMetaCount = resolveChunkMetaCountFromMeta(localMeta);
    if (localMetaCount != null) return localMetaCount;
  }
  const manifestCount = resolveChunkMetaCountFromManifest(manifest);
  if (manifestCount != null) return manifestCount;
  const presencePaths = Array.isArray(presence?.paths) ? presence.paths : [];
  if (presencePaths.length && presencePaths.every((targetPath) => isUncompressedJsonPath(targetPath))) {
    if (presencePaths.length === 1) {
      const empty = probeChunkMetaJsonArrayEmpty(presencePaths[0]);
      if (empty === true) return 0;
      if (empty === false) return null;
    }
  }
  if (presencePaths.length && presencePaths.every((targetPath) => isUncompressedJsonlPath(targetPath))) {
    let allEmpty = true;
    for (const targetPath of presencePaths) {
      const empty = probeChunkMetaJsonlIsEmpty(targetPath);
      if (empty === false) return null;
      if (empty == null) {
        allEmpty = false;
        break;
      }
    }
    if (allEmpty) return 0;
  }
  const jsonCandidates = [
    path.join(indexDir, 'chunk_meta.json')
  ];
  for (const candidate of jsonCandidates) {
    if (!fsSync.existsSync(candidate)) continue;
    const empty = probeChunkMetaJsonArrayEmpty(candidate);
    if (empty === true) return 0;
    if (empty === false) return null;
  }
  const jsonlCandidates = [
    path.join(indexDir, 'chunk_meta.jsonl')
  ];
  for (const candidate of jsonlCandidates) {
    if (!fsSync.existsSync(candidate)) continue;
    const empty = probeChunkMetaJsonlIsEmpty(candidate);
    if (empty === true) return 0;
    if (empty === false) return null;
  }
  return null;
};

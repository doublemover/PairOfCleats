import { fromPosix } from '../../files.js';
import { isPathUnderDir, joinPathSafe } from '../../path-normalize.js';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import {
  OFFSETS_COMPRESSION,
  OFFSETS_FORMAT,
  OFFSETS_FORMAT_VERSION,
  readJsonlRowsAt,
  readOffsetsAt,
  resolveOffsetsCount
} from '../offsets.js';
import { readVarintDeltasAt } from '../varint.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';
import { readJsonFileCached, ensureOffsetsValid } from './shared.js';
import { loadJsonArrayArtifact } from './core.js';

/**
 * Resolve by-file metadata artifact path for a symbol artifact.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{ manifest: object|null, strict: boolean, maxBytes: number }} options
 * @returns {string|null}
 */
const resolvePerFileMetaPath = (dir, baseName, { manifest, strict, maxBytes }) => {
  const metaName = `${baseName}_by_file_meta`;
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name: metaName,
    strict,
    maxBytes
  });
  if (sources?.paths?.length) {
    const candidate = sources.paths[0];
    if (!candidate || !isPathUnderDir(dir, candidate)) return null;
    return candidate;
  }
  return null;
};

/**
 * Load and normalize by-file metadata envelope for indexed symbol artifacts.
 *
 * @param {string} dir
 * @param {string} baseName
 * @param {{ manifest: object|null, strict: boolean, maxBytes: number }} options
 * @returns {{ meta: any, metaPath: string }|null}
 */
const loadPerFileIndexMeta = (dir, baseName, { manifest, strict, maxBytes }) => {
  const metaPath = resolvePerFileMetaPath(dir, baseName, { manifest, strict, maxBytes });
  if (!metaPath) return null;
  const metaRaw = readJsonFileCached(metaPath, { maxBytes });
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  if (!meta || typeof meta !== 'object') return null;
  return { meta, metaPath };
};

/**
 * Resolve JSONL part and offsets paths from by-file metadata.
 *
 * @param {string} dir
 * @param {any} meta
 * @returns {{ parts: string[], offsets: string[], counts: number[] }|null}
 */
const resolveRowSourcesFromPerFileMeta = (dir, meta) => {
  const jsonl = meta?.jsonl && typeof meta.jsonl === 'object' ? meta.jsonl : null;
  const parts = Array.isArray(jsonl?.parts) ? jsonl.parts : [];
  const counts = Array.isArray(jsonl?.counts) ? jsonl.counts : [];
  const offsets = Array.isArray(jsonl?.offsets) ? jsonl.offsets : [];
  if (!parts.length || parts.length !== counts.length || offsets.length !== parts.length) {
    return null;
  }
  const resolveUnderIndexRoot = (relativePath) => {
    if (typeof relativePath !== 'string' || !relativePath) return null;
    const normalizedRelative = fromPosix(relativePath);
    return joinPathSafe(dir, [normalizedRelative]);
  };
  const resolvedParts = parts.map(resolveUnderIndexRoot);
  const resolvedOffsets = offsets.map(resolveUnderIndexRoot);
  if (resolvedParts.some((entry) => !entry) || resolvedOffsets.some((entry) => !entry)) {
    return null;
  }
  return { parts: resolvedParts, offsets: resolvedOffsets, counts };
};

/**
 * Map a global row index into a shard part index/local index pair.
 *
 * @param {number[]} counts
 * @param {number} index
 * @returns {{ partIndex: number, localIndex: number }|null}
 */
const resolvePartIndex = (counts, index) => {
  let cursor = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const count = Number.isFinite(counts[i]) ? counts[i] : 0;
    if (index < cursor + count) {
      return { partIndex: i, localIndex: index - cursor };
    }
    cursor += count;
  }
  return null;
};

/**
 * Load symbol rows for a single file using by-file indexes when available.
 *
 * Falls back to full-artifact filtering when indexed row sources are unavailable
 * or fail validation.
 *
 * @param {string} dir
 * @param {'symbol_occurrences'|'symbol_edges'} baseName
 * @param {{
 *   fileId?: number,
 *   filePath?: string,
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean
 * }} [options]
 * @returns {Promise<any[]>}
 */
const loadSymbolRowsForFile = async (
  dir,
  baseName,
  {
    fileId,
    filePath,
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  let resolvedFileId = Number.isFinite(fileId) ? fileId : null;
  let resolvedFilePath = filePath || null;
  if ((!Number.isFinite(resolvedFileId) && filePath) || (!resolvedFilePath && Number.isFinite(resolvedFileId))) {
    try {
      const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', {
        maxBytes,
        manifest: resolvedManifest,
        strict
      });
      if (Array.isArray(fileMeta)) {
        for (const entry of fileMeta) {
          if (!entry || typeof entry !== 'object') continue;
          if (!Number.isFinite(resolvedFileId) && entry.file === filePath && Number.isFinite(entry.id)) {
            resolvedFileId = entry.id;
          }
          if (!resolvedFilePath && Number.isFinite(resolvedFileId) && entry.id === resolvedFileId && entry.file) {
            resolvedFilePath = entry.file;
          }
          if (Number.isFinite(resolvedFileId) && resolvedFilePath) break;
        }
      }
    } catch {}
  }
  if (!Number.isFinite(resolvedFileId)) {
    return [];
  }

  const loadFullRows = async () => {
    if (!resolvedFilePath) return [];
    const full = await loadJsonArrayArtifact(dir, baseName, {
      maxBytes,
      manifest: resolvedManifest,
      strict
    });
    const filterField = baseName === 'symbol_edges' ? 'from' : 'host';
    return Array.isArray(full)
      ? full.filter((row) => row?.[filterField]?.file === resolvedFilePath)
      : [];
  };

  const perFileMeta = loadPerFileIndexMeta(dir, baseName, {
    manifest: resolvedManifest,
    strict,
    maxBytes
  });
  if (!perFileMeta?.meta) {
    return loadFullRows();
  }

  const meta = perFileMeta.meta;
  const offsetsInfo = meta?.offsets && typeof meta.offsets === 'object' ? meta.offsets : null;
  if (!offsetsInfo?.path || !meta?.data) return loadFullRows();
  if (offsetsInfo.format && offsetsInfo.format !== OFFSETS_FORMAT) return loadFullRows();
  if (offsetsInfo.version && offsetsInfo.version !== OFFSETS_FORMAT_VERSION) return loadFullRows();
  if (offsetsInfo.compression && offsetsInfo.compression !== OFFSETS_COMPRESSION) return loadFullRows();
  const dataPath = joinPathSafe(dir, [fromPosix(meta.data)]);
  const offsetsPath = joinPathSafe(dir, [fromPosix(offsetsInfo.path)]);
  if (!dataPath || !offsetsPath) return loadFullRows();
  const sources = resolveRowSourcesFromPerFileMeta(dir, meta);
  if (!sources) return loadFullRows();
  if (!existsOrBak(dataPath) || !existsOrBak(offsetsPath)) return loadFullRows();
  if (!sources.parts.every(existsOrBak) || !sources.offsets.every(existsOrBak)) {
    return loadFullRows();
  }
  const resolvedDataPath = resolvePathOrBak(dataPath);
  const resolvedOffsetsPath = resolvePathOrBak(offsetsPath);
  const resolvedParts = sources.parts.map((entry) => resolvePathOrBak(entry));
  const resolvedPartOffsets = sources.offsets.map((entry) => resolvePathOrBak(entry));
  let offsetsCount;
  let start;
  let end;
  let rowIndexes;
  try {
    offsetsCount = await resolveOffsetsCount(resolvedOffsetsPath);
    if (resolvedFileId + 1 >= offsetsCount) return loadFullRows();
    const offsets = await readOffsetsAt(resolvedOffsetsPath, [resolvedFileId, resolvedFileId + 1]);
    start = offsets.get(resolvedFileId);
    end = offsets.get(resolvedFileId + 1);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return loadFullRows();
    if (end < start) return loadFullRows();
    if (end === start) return [];
    rowIndexes = await readVarintDeltasAt(resolvedDataPath, start, end);
  } catch {
    return loadFullRows();
  }
  if (!rowIndexes.length) {
    return end > start ? loadFullRows() : [];
  }
  const requiredKeys = resolveJsonlRequiredKeys(baseName);
  const rows = [];
  const validatedParts = new Set();
  const rowsByPart = new Map();
  for (const rowIndex of rowIndexes) {
    const resolved = resolvePartIndex(sources.counts, rowIndex);
    if (!resolved) continue;
    const partPath = resolvedParts[resolved.partIndex];
    const partOffsets = resolvedPartOffsets[resolved.partIndex];
    if (!validatedParts.has(resolved.partIndex)) {
      try {
        await ensureOffsetsValid(partPath, partOffsets);
        validatedParts.add(resolved.partIndex);
      } catch {
        return loadFullRows();
      }
    }
    const key = String(resolved.partIndex);
    const bucket = rowsByPart.get(key) || {
      partPath,
      partOffsets,
      localIndexes: []
    };
    bucket.localIndexes.push(resolved.localIndex);
    rowsByPart.set(key, bucket);
  }
  for (const bucket of rowsByPart.values()) {
    const fetched = await readJsonlRowsAt(
      bucket.partPath,
      bucket.partOffsets,
      bucket.localIndexes,
      { maxBytes, requiredKeys }
    );
    for (const row of fetched) {
      if (row) rows.push(row);
    }
  }
  return rows;
};

/**
 * Load symbol occurrence rows scoped to a single file.
 *
 * @param {string} dir
 * @param {Parameters<typeof loadSymbolRowsForFile>[2]} [options]
 * @returns {Promise<any[]>}
 */
export const loadSymbolOccurrencesByFile = async (dir, options = {}) => (
  loadSymbolRowsForFile(dir, 'symbol_occurrences', options)
);

/**
 * Load symbol edge rows scoped to a single file.
 *
 * @param {string} dir
 * @param {Parameters<typeof loadSymbolRowsForFile>[2]} [options]
 * @returns {Promise<any[]>}
 */
export const loadSymbolEdgesByFile = async (dir, options = {}) => (
  loadSymbolRowsForFile(dir, 'symbol_edges', options)
);

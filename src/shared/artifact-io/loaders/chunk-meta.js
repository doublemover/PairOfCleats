import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak } from '../fs.js';
import { readJsonFile, readJsonLinesArray } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import { loadPiecesManifest, resolveManifestArtifactSources } from '../manifest.js';
import { decodeVarint64List } from '../varint.js';
import { mergeChunkMetaColdFields } from '../../chunk-meta-cold.js';
import { normalizeMetaV2ForRead } from '../../meta-v2.js';
import { formatHash64 } from '../../token-id.js';
import {
  warnNonStrictJsonFallback,
  resolveJsonlArtifactSources,
  resolveJsonlFallbackSources,
  inflateColumnarRows
} from './shared.js';
import { tryLoadChunkMetaBinaryColumnar } from './binary-columnar.js';

/**
 * Inflate packed token id payloads into canonical `tokenIds` arrays.
 *
 * @param {any[]|any} chunkMeta
 * @returns {any[]|any}
 */
const inflatePackedTokenIds = (chunkMeta) => {
  if (!Array.isArray(chunkMeta)) return chunkMeta;
  for (const entry of chunkMeta) {
    if (!entry || typeof entry !== 'object') continue;
    if (Array.isArray(entry.tokenIds)) continue;
    const packed = entry.token_ids_packed;
    if (typeof packed !== 'string' || !packed) continue;
    const buffer = Buffer.from(packed, 'base64');
    const decoded = decodeVarint64List(buffer);
    entry.tokenIds = decoded.map((value) => formatHash64(value));
  }
  return chunkMeta;
};

/**
 * Conditionally inflate packed token IDs for callers that need materialized tokens.
 *
 * @param {any[]|any} chunkMeta
 * @param {boolean} materializeTokenIds
 * @returns {any[]|any}
 */
const maybeInflatePackedTokenIds = (chunkMeta, materializeTokenIds) => (
  materializeTokenIds ? inflatePackedTokenIds(chunkMeta) : chunkMeta
);

/**
 * Load optional `chunk_meta_cold` rows from manifest-aware sources.
 *
 * @param {{
 *   dir: string,
 *   maxBytes: number,
 *   manifest: object|null,
 *   strict: boolean,
 *   validationMode: 'strict'|'trusted'
 * }} input
 * @returns {Promise<any[]|null>}
 */
const loadChunkMetaColdRows = async ({
  dir,
  maxBytes,
  manifest,
  strict,
  validationMode
}) => {
  const requiredKeys = ['id'];
  const sources = resolveManifestArtifactSources({
    dir,
    manifest,
    name: 'chunk_meta_cold',
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, 'chunk_meta_cold');
  if (!sources?.paths?.length) return null;
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for chunk_meta_cold');
    }
    const rows = readJsonFile(sources.paths[0], { maxBytes });
    return Array.isArray(rows) ? rows : null;
  }
  if (sources.format === 'columnar') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous columnar sources for chunk_meta_cold');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error('Invalid columnar chunk_meta_cold payload');
    return inflated;
  }
  return await readJsonLinesArray(sources.paths, {
    maxBytes,
    requiredKeys,
    validationMode
  });
};

/**
 * Merge cold fields into hot chunk rows by numeric `id`.
 *
 * @param {any[]} hotRows
 * @param {any[]|null} coldRows
 * @returns {any[]}
 */
const mergeChunkMetaColdRows = (hotRows, coldRows) => {
  if (!Array.isArray(hotRows) || !Array.isArray(coldRows) || !coldRows.length) {
    return hotRows;
  }
  const coldById = new Map();
  for (const row of coldRows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    coldById.set(id, row);
  }
  if (!coldById.size) return hotRows;
  for (let i = 0; i < hotRows.length; i += 1) {
    const hot = hotRows[i];
    const id = Number(hot?.id);
    if (!Number.isFinite(id)) continue;
    const cold = coldById.get(id);
    if (!cold) continue;
    hotRows[i] = mergeChunkMetaColdFields(hot, cold);
  }
  return hotRows;
};

/**
 * Normalize `metaV2` payload for each chunk row in-place.
 *
 * @param {any[]|any} rows
 * @returns {any[]|any}
 */
const normalizeChunkMetaMetaV2 = (rows) => {
  if (!Array.isArray(rows) || !rows.length) return rows;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(row, 'metaV2')) continue;
    row.metaV2 = normalizeMetaV2ForRead(row.metaV2);
  }
  return rows;
};

/**
 * Load `chunk_meta` with support for JSON, JSONL, columnar, and binary-columnar formats.
 *
 * Optionally merges `chunk_meta_cold` and inflates packed token IDs.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   preferBinaryColumnar?: boolean,
 *   materializeTokenIds?: boolean,
 *   includeCold?: boolean
 * }} [options]
 * @returns {Promise<any[]>}
 */
export const loadChunkMeta = async (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    preferBinaryColumnar = false,
    materializeTokenIds = false,
    includeCold = true
  } = {}
) => {
  const requiredKeys = resolveJsonlRequiredKeys('chunk_meta');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const maybeMergeCold = async (rows) => {
    if (!includeCold) return normalizeChunkMetaMetaV2(rows);
    const coldRows = await loadChunkMetaColdRows({
      dir,
      maxBytes,
      manifest: resolvedManifest,
      strict,
      validationMode
    });
    return normalizeChunkMetaMetaV2(mergeChunkMetaColdRows(rows, coldRows));
  };
  const loadChunkMetaJsonlFallback = async () => {
    const fallback = resolveJsonlFallbackSources(dir, 'chunk_meta');
    if (!fallback?.paths?.length) return null;
    const rows = await readJsonLinesArray(fallback.paths, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    const merged = await maybeMergeCold(rows);
    return maybeInflatePackedTokenIds(merged, materializeTokenIds);
  };
  if (preferBinaryColumnar) {
    const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
    if (binaryRows) {
      const merged = await maybeMergeCold(binaryRows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
  }
  if (strict) {
    const sources = resolveManifestArtifactSources({
      dir,
      manifest: resolvedManifest,
      name: 'chunk_meta',
      strict: true,
      maxBytes
    });
    if (sources?.paths?.length) {
      if (sources.format === 'json') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous JSON sources for chunk_meta');
        }
        const rows = readJsonFile(sources.paths[0], { maxBytes });
        const merged = await maybeMergeCold(rows);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      }
      if (sources.format === 'columnar') {
        if (sources.paths.length > 1) {
          throw new Error('Ambiguous columnar sources for chunk_meta');
        }
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
        const merged = await maybeMergeCold(inflated);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      }
      if (sources.format === 'binary-columnar') {
        const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
        if (!binaryRows) {
          throw new Error('Invalid binary-columnar chunk_meta payload');
        }
        const merged = await maybeMergeCold(binaryRows);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      }
      const rows = await readJsonLinesArray(sources.paths, {
        maxBytes,
        requiredKeys,
        validationMode
      });
      const merged = await maybeMergeCold(rows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
    throw new Error('Missing manifest entry for chunk_meta');
  }

  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'chunk_meta',
    strict: false,
    maxBytes
  }) || resolveJsonlArtifactSources(dir, 'chunk_meta');
  if (sources?.paths?.length) {
    if (sources.format === 'json') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous JSON sources for chunk_meta');
      }
      try {
        const rows = readJsonFile(sources.paths[0], { maxBytes });
        const merged = await maybeMergeCold(rows);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      } catch (err) {
        if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
        const fallbackRows = await loadChunkMetaJsonlFallback();
        if (fallbackRows) return fallbackRows;
        throw err;
      }
    }
    if (sources.format === 'columnar') {
      if (sources.paths.length > 1) {
        throw new Error('Ambiguous columnar sources for chunk_meta');
      }
      try {
        const payload = readJsonFile(sources.paths[0], { maxBytes });
        const inflated = inflateColumnarRows(payload);
        if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
        const merged = await maybeMergeCold(inflated);
        return maybeInflatePackedTokenIds(merged, materializeTokenIds);
      } catch (err) {
        if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
        const fallbackRows = await loadChunkMetaJsonlFallback();
        if (fallbackRows) return fallbackRows;
        throw err;
      }
    }
    if (sources.format === 'binary-columnar') {
      const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
      if (!binaryRows) {
        throw new Error('Invalid binary-columnar chunk_meta payload');
      }
      const merged = await maybeMergeCold(binaryRows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
    const rows = await readJsonLinesArray(sources.paths, {
      maxBytes,
      requiredKeys,
      validationMode
    });
    const merged = await maybeMergeCold(rows);
    return maybeInflatePackedTokenIds(merged, materializeTokenIds);
  }

  const columnarPath = path.join(dir, 'chunk_meta.columnar.json');
  const binaryMetaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (existsOrBak(binaryMetaPath)) {
    warnNonStrictJsonFallback(dir, 'chunk_meta');
    const binaryRows = tryLoadChunkMetaBinaryColumnar(dir, { maxBytes });
    if (binaryRows) {
      const merged = await maybeMergeCold(binaryRows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    }
  }
  if (existsOrBak(columnarPath)) {
    warnNonStrictJsonFallback(dir, 'chunk_meta');
    const payload = readJsonFile(columnarPath, { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) throw new Error('Invalid columnar chunk_meta payload');
    const merged = await maybeMergeCold(inflated);
    return maybeInflatePackedTokenIds(merged, materializeTokenIds);
  }
  const jsonPath = path.join(dir, 'chunk_meta.json');
  if (existsOrBak(jsonPath)) {
    try {
      const rows = readJsonFile(jsonPath, { maxBytes });
      const merged = await maybeMergeCold(rows);
      return maybeInflatePackedTokenIds(merged, materializeTokenIds);
    } catch (err) {
      if (err?.code !== 'ERR_JSON_TOO_LARGE') throw err;
      const fallbackRows = await loadChunkMetaJsonlFallback();
      if (fallbackRows) return fallbackRows;
      throw err;
    }
  }
  throw new Error('Missing index artifact: chunk_meta.json');
};

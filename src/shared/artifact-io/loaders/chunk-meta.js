import { MAX_JSON_BYTES } from '../constants.js';
import { readJsonFile, readJsonLinesArray, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources,
  resolveManifestBinaryColumnarPreference
} from '../manifest.js';
import { decodeVarint64List } from '../varint.js';
import { mergeChunkMetaColdFields } from '../../chunk-meta-cold.js';
import { normalizeMetaV2ForRead } from '../../meta-v2.js';
import { formatHash64 } from '../../token-id.js';
import {
  createLoaderError,
  inflateColumnarRows
} from './shared.js';
import {
  iterateChunkMetaBinaryColumnarRows
} from './binary-columnar.js';

const inflatePackedTokenIdsEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  if (Array.isArray(entry.tokenIds)) return entry;
  const packed = entry.token_ids_packed;
  if (typeof packed !== 'string' || !packed) return entry;
  const buffer = Buffer.from(packed, 'base64');
  const decoded = decodeVarint64List(buffer);
  entry.tokenIds = decoded.map((value) => formatHash64(value));
  return entry;
};

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
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) return null;
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw createLoaderError('ERR_MANIFEST_SOURCE_AMBIGUOUS', 'Ambiguous JSON sources for chunk_meta_cold');
    }
    const rows = readJsonFile(sources.paths[0], { maxBytes });
    return Array.isArray(rows) ? rows : null;
  }
  if (sources.format === 'columnar') {
    if (sources.paths.length > 1) {
      throw createLoaderError(
        'ERR_MANIFEST_SOURCE_AMBIGUOUS',
        'Ambiguous columnar sources for chunk_meta_cold'
      );
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid columnar chunk_meta_cold payload');
    }
    return inflated;
  }
  return await readJsonLinesArray(sources.paths, {
    maxBytes,
    requiredKeys,
    validationMode
  });
};

/**
 * Build lookup map for cold rows keyed by numeric chunk id.
 *
 * @param {any[]|null} rows
 * @returns {Map<number, object>|null}
 */
const buildChunkMetaColdById = (rows) => {
  if (!Array.isArray(rows) || !rows.length) return null;
  const coldById = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    coldById.set(id, row);
  }
  return coldById.size ? coldById : null;
};

const transformChunkMetaRow = (row, { coldById = null, materializeTokenIds = false } = {}) => {
  if (!row || typeof row !== 'object') return row;
  let next = row;
  if (coldById) {
    const id = Number(row?.id);
    if (Number.isFinite(id)) {
      const cold = coldById.get(id);
      if (cold) {
        next = mergeChunkMetaColdFields(next, cold);
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(next, 'metaV2')) {
    next.metaV2 = normalizeMetaV2ForRead(next.metaV2);
  }
  if (materializeTokenIds) {
    inflatePackedTokenIdsEntry(next);
  }
  return next;
};

/**
 * Stream `chunk_meta` rows with support for JSON, JSONL, columnar, and binary-columnar formats.
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   preferBinaryColumnar?: boolean,
 *   materializeTokenIds?: boolean,
 *   includeCold?: boolean,
 *   enforceBinaryDataBudget?: boolean
 * }} [options]
 * @returns {AsyncGenerator<any, void, unknown>}
 */
export const loadChunkMetaRows = async function* (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    preferBinaryColumnar = true,
    materializeTokenIds = false,
    includeCold = true,
    enforceBinaryDataBudget = false
  } = {}
) {
  const requiredKeys = resolveJsonlRequiredKeys('chunk_meta');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const useBinaryColumnar = resolveManifestBinaryColumnarPreference(resolvedManifest, {
    fallback: preferBinaryColumnar
  });
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'chunk_meta',
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw createLoaderError('ERR_MANIFEST_ENTRY_MISSING', 'Missing manifest entry for chunk_meta');
  }
  const coldRows = includeCold
    ? await loadChunkMetaColdRows({
      dir,
      maxBytes,
      manifest: resolvedManifest,
      strict,
      validationMode
    })
    : null;
  const coldById = buildChunkMetaColdById(coldRows);
  const transform = (row) => transformChunkMetaRow(row, {
    coldById,
    materializeTokenIds
  });
  if (useBinaryColumnar) {
    const binaryRows = iterateChunkMetaBinaryColumnarRows(dir, {
      maxBytes,
      enforceDataBudget: enforceBinaryDataBudget
    });
    if (binaryRows) {
      for (const row of binaryRows) {
        yield transform(row);
      }
      return;
    }
  }
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw createLoaderError('ERR_MANIFEST_SOURCE_AMBIGUOUS', 'Ambiguous JSON sources for chunk_meta');
    }
    const rows = readJsonFile(sources.paths[0], { maxBytes });
    if (!Array.isArray(rows)) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid json chunk_meta payload');
    }
    for (const row of rows) {
      yield transform(row);
    }
    return;
  }
  if (sources.format === 'columnar') {
    if (sources.paths.length > 1) {
      throw createLoaderError('ERR_MANIFEST_SOURCE_AMBIGUOUS', 'Ambiguous columnar sources for chunk_meta');
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid columnar chunk_meta payload');
    }
    for (const row of inflated) {
      yield transform(row);
    }
    return;
  }
  if (sources.format === 'binary-columnar') {
    const binaryRows = iterateChunkMetaBinaryColumnarRows(dir, {
      maxBytes,
      enforceDataBudget: enforceBinaryDataBudget
    });
    if (!binaryRows) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid binary-columnar chunk_meta payload');
    }
    for (const row of binaryRows) {
      yield transform(row);
    }
    return;
  }
  for (const partPath of sources.paths) {
    for await (const row of readJsonLinesIterator(partPath, {
      maxBytes,
      requiredKeys,
      validationMode
    })) {
      yield transform(row);
    }
  }
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
    preferBinaryColumnar = true,
    materializeTokenIds = false,
    includeCold = true
  } = {}
) => {
  const rows = [];
  for await (const row of loadChunkMetaRows(dir, {
    maxBytes,
    manifest,
    strict,
    preferBinaryColumnar,
    materializeTokenIds,
    includeCold,
    enforceBinaryDataBudget: true
  })) {
    rows.push(row);
  }
  return rows;
};

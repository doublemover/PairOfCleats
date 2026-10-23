import { MAX_JSON_BYTES } from '../constants.js';
import { readJsonFile, readJsonLinesIterator } from '../json.js';
import { resolveJsonlRequiredKeys } from '../jsonl.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources,
  resolveManifestBinaryColumnarPreference
} from '../manifest.js';
import { decodeVarint64List } from '../varint.js';
import { mergeChunkMetaColdFields } from '../../chunk-meta-cold.js';
import { normalizeMetaV2ForRead } from '../../../index/metadata/meta-v2.js';
import { formatHash64 } from '../../token-id.js';
import { inflateColumnarRows } from '../columnar-rows.js';
import { createLoaderError } from './shared.js';
import path from 'node:path';
import { existsOrBak } from '../fs.js';

const iterateChunkMetaBinaryColumnarRowsLazy = async (dir, options) => {
  const { iterateChunkMetaBinaryColumnarRows } = await import('./binary-columnar-chunk-meta.js');
  return iterateChunkMetaBinaryColumnarRows(dir, options);
};

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
 * @returns {AsyncGenerator<any>}
 */
const loadChunkMetaColdRows = async function* ({
  dir,
  maxBytes,
  manifest,
  strict,
  validationMode
}) {
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
    const rows = readJsonFile(sources.paths[0], { maxBytes, containedRoot: sources.containedRoot });
    if (Array.isArray(rows)) yield* rows;
    return;
  }
  if (sources.format === 'columnar') {
    if (sources.paths.length > 1) {
      throw createLoaderError(
        'ERR_MANIFEST_SOURCE_AMBIGUOUS',
        'Ambiguous columnar sources for chunk_meta_cold'
      );
    }
    const payload = readJsonFile(sources.paths[0], { maxBytes, containedRoot: sources.containedRoot });
    const inflated = inflateColumnarRows(payload);
    if (!inflated) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', 'Invalid columnar chunk_meta_cold payload');
    }
    yield* inflated;
    return;
  }
  for (const partPath of sources.paths) {
    yield* readJsonLinesIterator(partPath, {
      maxBytes, containedRoot: sources.containedRoot, requiredKeys, validationMode
    });
  }
};

/**
 * Build lookup map for cold rows keyed by numeric chunk id.
 *
 * @param {any[]|null} rows
 * @returns {Map<number, object>|null}
 */
const pickIdentityFields = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = {};
  for (const key of keys) if (Object.hasOwn(value, key)) result[key] = value[key];
  return result;
};
const projectIdentitySegment = value => pickIdentityFields(value, [
  'segmentUid', 'segmentId', 'virtualPath', 'file', 'languageId', 'start', 'end', 'segmentStart', 'segmentEnd'
]);
const projectChunkIdentityRow = value => {
  const projected = pickIdentityFields(value, [
    'id', 'docId', 'chunkUid', 'chunkId', 'file', 'virtualPath', 'lang', 'start', 'end', 'identity'
  ]);
  if (!projected || typeof projected !== 'object') return projected;
  if (Object.hasOwn(value, 'segment')) projected.segment = projectIdentitySegment(value.segment);
  if (Object.hasOwn(value, 'metaV2')) {
    projected.metaV2 = pickIdentityFields(value.metaV2, [
      'schemaVersion', 'chunkUid', 'chunkId', 'file', 'virtualPath', 'lang',
      'mintedByStage', 'disambiguation', 'canonicalEnvelopeVersion'
    ]);
    if (value.metaV2 && Object.hasOwn(value.metaV2, 'segment')) projected.metaV2.segment = projectIdentitySegment(value.metaV2.segment);
  }
  return projected;
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
    enforceBinaryDataBudget = false,
    identityOnly = false
  } = {}
) {
  const requiredKeys = resolveJsonlRequiredKeys('chunk_meta');
  const validationMode = strict ? 'strict' : 'trusted';
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  let useBinaryColumnar = resolveManifestBinaryColumnarPreference(resolvedManifest, {
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
  const primaryPieces = resolvedManifest?.pieces?.filter(piece => piece?.name === 'chunk_meta') || [];
  const plans = primaryPieces.map(piece => piece.extensions?.representationPlan).filter(plan => plan != null);
  let requireColdRows = false;
  if (plans.length) {
    const plan = plans[0], primary = sources.format === 'sharded' ? 'jsonl' : sources.format;
    if (plans.length !== primaryPieces.length || plan.schemaVersion !== 1 || plan.family !== 'chunk-meta'
      || plan.primary !== primary || typeof plan.emitBinaryColumnar !== 'boolean' || typeof plan.hotColdSplit !== 'boolean'
      || !Array.isArray(plan.compatibility) || plan.compatibility.some(format => !['binary-columnar-v1', 'json-array'].includes(format))
      || new Set(plan.compatibility).size !== plan.compatibility.length
      || plan.compatibility.includes('binary-columnar-v1') !== plan.emitBinaryColumnar
      || plans.some(other => JSON.stringify(other) !== JSON.stringify(plan))) {
      throw createLoaderError('ERR_MANIFEST_INVALID', 'Chunk metadata differs from its recorded representation plan.');
    }
    useBinaryColumnar &&= plan.emitBinaryColumnar;
    requireColdRows = plan.hotColdSplit && includeCold;
    if (plan.hotColdSplit && !resolvedManifest.pieces.some(piece => piece.name === 'chunk_meta_cold')) {
      throw createLoaderError('ERR_MANIFEST_INCOMPLETE', 'Chunk metadata requires its declared cold sidecar.');
    }
    if (plan.compatibility.includes('json-array') && !existsOrBak(path.join(dir, 'chunk_meta.json'))) {
      throw createLoaderError('ERR_MANIFEST_INCOMPLETE', 'Chunk metadata requires its declared JSON compatibility copy.');
    }
    if (plan.emitBinaryColumnar) {
      for (const [name, filename] of [
        ['chunk_meta_binary_columnar', 'chunk_meta.binary-columnar.bin'],
        ['chunk_meta_binary_columnar_offsets', 'chunk_meta.binary-columnar.offsets.bin'],
        ['chunk_meta_binary_columnar_lengths', 'chunk_meta.binary-columnar.lengths.varint'],
        ['chunk_meta_binary_columnar_meta', 'chunk_meta.binary-columnar.meta.json']
      ]) {
        const members = resolvedManifest.pieces.filter(piece => piece.name === name);
        if (members.length !== 1 || members[0].path !== filename || !existsOrBak(path.join(dir, filename))) {
          throw createLoaderError('ERR_MANIFEST_INCOMPLETE', `Chunk metadata compatibility is missing ${name}.`);
        }
      }
    }
  }
  let coldById = null;
  if (includeCold) {
    coldById = new Map();
    for await (const row of loadChunkMetaColdRows({ dir, maxBytes, manifest: resolvedManifest, strict, validationMode })) {
      const id = Number(row?.id);
      if (Number.isFinite(id)) {
        if (requireColdRows && coldById.has(id)) throw createLoaderError('ERR_ARTIFACT_INVALID', `Duplicate chunk metadata cold row ${id}.`);
        coldById.set(id, identityOnly ? projectChunkIdentityRow(row) : row);
      }
    }
  }
  const transform = (row) => {
    if (requireColdRows && !coldById.has(Number(row?.id))) {
      throw createLoaderError('ERR_ARTIFACT_INVALID', `Missing required chunk metadata cold row ${row?.id}.`);
    }
    const merged = transformChunkMetaRow(row, { coldById, materializeTokenIds });
    return identityOnly ? projectChunkIdentityRow(merged) : merged;
  };
  if (useBinaryColumnar) {
    const binaryRows = await iterateChunkMetaBinaryColumnarRowsLazy(dir, {
      maxBytes,
      containedRoot: strict ? dir : null,
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
    const rows = readJsonFile(sources.paths[0], { maxBytes, containedRoot: sources.containedRoot });
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
    const payload = readJsonFile(sources.paths[0], { maxBytes, containedRoot: sources.containedRoot });
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
    const binaryRows = await iterateChunkMetaBinaryColumnarRowsLazy(dir, {
      maxBytes,
      containedRoot: strict ? dir : null,
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
      containedRoot: sources.containedRoot,
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
 *   includeCold?: boolean,
 *   enforceBinaryDataBudget?: boolean
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
    includeCold = true,
    enforceBinaryDataBudget = true
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
    enforceBinaryDataBudget
  })) {
    rows.push(row);
  }
  return rows;
};

/** Reconciliation-only projection; full cold decoding/validation still occurs. */
export const loadChunkMetaIdentityRows = (dir, options = {}) => loadChunkMetaRows(dir, {
  ...options, identityOnly: true, materializeTokenIds: false, includeCold: true
});

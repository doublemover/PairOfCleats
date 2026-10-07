import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import { readJsonFileCached, resolveArtifactMetaEnvelope } from './shared.js';
import {
  assertSupportedBinaryColumnarMeta,
  iterateBinaryColumnarRowPayloads,
  resolveSafeLayoutPath,
  resolveStrictNonNegativeSafeInt,
  shouldDegradeUnsupportedMeta
} from './binary-columnar.js';

const resolveChunkMetaBinaryColumnarLayout = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const metaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (!existsOrBak(metaPath)) return null;
  const metaRaw = readJsonFileCached(resolvePathOrBak(metaPath), { maxBytes });
  try {
    assertSupportedBinaryColumnarMeta(metaRaw, 'chunk_meta binary-columnar');
  } catch (error) {
    if (shouldDegradeUnsupportedMeta(error)) return null;
    throw error;
  }
  const { fields: meta, arrays } = resolveArtifactMetaEnvelope(metaRaw);
  const fileTable = Array.isArray(arrays?.fileTable) ? arrays.fileTable : [];
  const count = meta?.count == null
    ? 0
    : resolveStrictNonNegativeSafeInt(meta.count, 'chunk_meta binary-columnar count');
  const dataPath = resolveSafeLayoutPath(
    dir,
    meta?.data,
    'chunk_meta.binary-columnar.bin',
    'chunk_meta binary-columnar data'
  );
  const offsetsPath = resolveSafeLayoutPath(
    dir,
    meta?.offsets,
    'chunk_meta.binary-columnar.offsets.bin',
    'chunk_meta binary-columnar offsets'
  );
  const lengthsPath = resolveSafeLayoutPath(
    dir,
    meta?.lengths,
    'chunk_meta.binary-columnar.lengths.varint',
    'chunk_meta binary-columnar lengths'
  );
  return {
    count,
    fileTable,
    dataPath,
    offsetsPath,
    lengthsPath
  };
};

/**
 * Attempt to iterate `chunk_meta` rows from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number, enforceDataBudget?: boolean }} [options]
 * @returns {Generator<object, void, unknown>|null}
 */
export const iterateChunkMetaBinaryColumnarRows = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    enforceDataBudget = false
  } = {}
) => {
  const layout = resolveChunkMetaBinaryColumnarLayout(dir, { maxBytes });
  if (!layout) return null;
  const {
    count,
    fileTable,
    dataPath,
    offsetsPath,
    lengthsPath
  } = layout;
  if (!count) return (function* () {})();
  const payloads = iterateBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count,
    maxBytes,
    enforceDataBudget
  });
  if (!payloads) return null;
  return (function* () {
    for (const payload of payloads) {
      const row = JSON.parse(payload.toString('utf8'));
      if (row && Number.isInteger(row.fileRef) && (row.file == null)) {
        row.file = fileTable[row.fileRef] ?? null;
        delete row.fileRef;
      }
      yield row;
    }
  })();
};

/**
 * Attempt to load `chunk_meta` from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number }} [options]
 * @returns {object[]|null}
 */
export const tryLoadChunkMetaBinaryColumnar = (dir, { maxBytes = MAX_JSON_BYTES } = {}) => {
  const rows = iterateChunkMetaBinaryColumnarRows(dir, { maxBytes, enforceDataBudget: true });
  if (!rows) return null;
  return Array.from(rows);
};

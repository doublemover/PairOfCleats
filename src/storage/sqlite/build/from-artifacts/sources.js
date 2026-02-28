import fsSync from 'node:fs';
import path from 'node:path';
import {
  normalizeFilePath,
  readJson,
  loadOptionalFileMetaRows,
  loadSqliteIndexOptionalArtifacts
} from '../../utils.js';
import { normalizeManifestFiles } from '../manifest.js';
import {
  CHUNK_META_PARTS_DIR,
  MAX_JSON_BYTES,
  TOKEN_POSTINGS_PART_EXTENSIONS,
  TOKEN_POSTINGS_PART_PREFIX,
  TOKEN_POSTINGS_SHARDS_DIR,
  expandMetaPartPaths,
  listShardFiles,
  locateChunkMetaShards,
  loadChunkMetaRows,
  loadTokenPostings,
  readJsonLinesEachAwait,
  resolveArtifactPresence,
  resolveJsonlRequiredKeys
} from '../../../../shared/artifact-io.js';
import {
  INTEGER_COERCE_MODE_STRICT,
  INTEGER_COERCE_MODE_TRUNCATE,
  coerceNonNegativeInt
} from '../../../../shared/number-coerce.js';

const SQLITE_TOKEN_CARDINALITY_ERROR_CODE = 'ERR_SQLITE_TOKEN_CARDINALITY';

const resolveFirstExistingPath = (basePath) => {
  const candidates = [basePath, `${basePath}.gz`, `${basePath}.zst`];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || null;
};

export const collectManifestByNormalized = (
  records,
  {
    fileFromRecord = (record) => record?.file,
    entryFromRecord = (record) => record?.entry
  } = {}
) => {
  const map = new Map();
  if (!records || typeof records[Symbol.iterator] !== 'function') return map;
  for (const record of records) {
    const file = fileFromRecord(record);
    const normalized = normalizeFilePath(file);
    if (!normalized) continue;
    map.set(normalized, {
      file: typeof file === 'string' && file ? file : normalized,
      normalized,
      entry: entryFromRecord(record)
    });
  }
  return map;
};

export const resolveManifestByNormalized = (manifestLike) => {
  if (manifestLike instanceof Map) return manifestLike;
  if (manifestLike && typeof manifestLike === 'object') {
    if (manifestLike.map instanceof Map) return manifestLike.map;
    if (Array.isArray(manifestLike.entries)) {
      return collectManifestByNormalized(manifestLike.entries, {
        fileFromRecord: (record) => record?.normalized || record?.file,
        entryFromRecord: (record) => record?.entry ?? null
      });
    }
  }
  const entries = Object.entries(manifestLike || {}).map(([file, entry]) => ({ file, entry }));
  return collectManifestByNormalized(entries, {
    fileFromRecord: (record) => record?.file,
    entryFromRecord: (record) => record?.entry ?? null
  });
};

export const createManifestLookup = (manifestFiles) => {
  const lookup = normalizeManifestFiles(manifestFiles || {});
  return {
    entries: Array.isArray(lookup.entries) ? lookup.entries : [],
    map: resolveManifestByNormalized(lookup),
    conflicts: Array.isArray(lookup.conflicts) ? lookup.conflicts : []
  };
};

export const inflateColumnarRows = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!arrays) return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : Object.keys(arrays);
  if (!columns.length) return [];
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const length = Number.isFinite(payload.length)
    ? payload.length
    : (Array.isArray(arrays[columns[0]]) ? arrays[columns[0]].length : 0);
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = Array.isArray(values) ? (values[i] ?? null) : null;
      const table = tables && Array.isArray(tables[column]) ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
};

export const resolveChunkMetaSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const presence = resolveArtifactPresence(dir, 'chunk_meta', {
    maxBytes: MAX_JSON_BYTES,
    strict: false
  });
  if (presence?.missingMeta && presence?.metaPath) {
    throw new Error(`[sqlite] chunk_meta meta missing: ${presence.metaPath}`);
  }
  if (Array.isArray(presence?.missingPaths) && presence.missingPaths.length) {
    throw new Error(`[sqlite] chunk_meta parts missing: ${presence.missingPaths.join(', ')}`);
  }
  if (Array.isArray(presence?.paths) && presence.paths.length) {
    return {
      format: (
        presence.format === 'json'
        || presence.format === 'columnar'
        || presence.format === 'binary-columnar'
      )
        ? presence.format
        : 'jsonl',
      paths: presence.paths,
      dir,
      metaPath: presence.metaPath || null,
      meta: presence.meta || null
    };
  }
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const partsDir = path.join(dir, CHUNK_META_PARTS_DIR);
  if (fsSync.existsSync(metaPath) || fsSync.existsSync(partsDir)) {
    const located = locateChunkMetaShards(dir, {
      metaPath,
      partsDir,
      maxBytes: MAX_JSON_BYTES
    });
    if (Array.isArray(located.missing) && located.missing.length) {
      throw new Error(`[sqlite] chunk_meta parts missing: ${located.missing.join(', ')}`);
    }
    if (Array.isArray(located.parts) && located.parts.length) {
      return {
        format: 'jsonl',
        paths: located.parts,
        dir,
        metaPath: located.metaPath || null,
        meta: located.meta || null
      };
    }
  }

  const jsonlResolved = resolveFirstExistingPath(path.join(dir, 'chunk_meta.jsonl'));
  if (jsonlResolved) {
    return { format: 'jsonl', paths: [jsonlResolved], dir, metaPath: null, meta: null };
  }
  const jsonResolved = resolveFirstExistingPath(path.join(dir, 'chunk_meta.json'));
  if (jsonResolved) {
    return { format: 'json', paths: [jsonResolved], dir, metaPath: null, meta: null };
  }
  return null;
};

export const resolveChunkMetaShardedLayout = (dir, chunkMetaSources = null) => {
  if (!dir || typeof dir !== 'string') return null;
  const sources = chunkMetaSources || resolveChunkMetaSources(dir);
  if (!sources || resolveChunkMetaSourceKind(sources.format) !== 'jsonl') return null;
  const parts = Array.isArray(sources.paths) ? sources.paths.filter(Boolean) : [];
  if (!parts.length) return null;
  const rawMeta = sources.meta;
  const metaFields = rawMeta?.fields && typeof rawMeta.fields === 'object'
    ? rawMeta.fields
    : rawMeta;
  return {
    sources,
    parts,
    metaPath: sources.metaPath || path.join(dir, 'chunk_meta.meta.json'),
    partsDir: path.join(dir, CHUNK_META_PARTS_DIR),
    metaFields
  };
};

export const resolveTokenPostingsSources = (dir) => {
  if (!dir || typeof dir !== 'string') {
    dir = typeof dir?.dir === 'string' ? dir.dir : null;
  }
  if (!dir) return null;
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const shardsDir = path.join(dir, TOKEN_POSTINGS_SHARDS_DIR);
  if (!fsSync.existsSync(metaPath) && !fsSync.existsSync(shardsDir)) return null;
  let parts = [];
  let metaError = null;
  if (fsSync.existsSync(metaPath)) {
    try {
      const metaRaw = readJson(metaPath);
      const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
      const declaredPartsCount = Array.isArray(meta?.parts) ? meta.parts.length : 0;
      parts = expandMetaPartPaths(meta?.parts, dir);
      if (declaredPartsCount > 0 && parts.length !== declaredPartsCount) {
        throw new Error('[sqlite] token_postings.meta.json contains invalid shard paths');
      }
    } catch (err) {
      metaError = err;
    }
  }
  if (metaError) {
    throw metaError;
  }
  if (!parts.length) {
    parts = listShardFiles(shardsDir, TOKEN_POSTINGS_PART_PREFIX, TOKEN_POSTINGS_PART_EXTENSIONS);
  }
  return parts.length ? { metaPath, parts } : null;
};

export const normalizeTfPostingRows = (
  posting,
  {
    mode = INTEGER_COERCE_MODE_TRUNCATE,
    rejectInvalid = false,
    contextLabel = 'token_postings posting row'
  } = {}
) => {
  if (!Array.isArray(posting) || posting.length <= 1) return Array.isArray(posting) ? posting : [];
  const coerceValue = (value) => coerceNonNegativeInt(value, { mode });
  let previousDocId = -1;
  let alreadySortedUnique = true;
  for (const entry of posting) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docId = coerceValue(entry[0]);
    if (docId == null) {
      if (rejectInvalid) {
        const error = new Error(
          `[sqlite] ${contextLabel} cardinality invariant failed: ` +
          `non-integer docId (${String(entry[0])}) is not allowed in strict mode.`
        );
        error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
        throw error;
      }
      continue;
    }
    if (docId <= previousDocId) {
      alreadySortedUnique = false;
      break;
    }
    previousDocId = docId;
  }
  if (alreadySortedUnique && mode === INTEGER_COERCE_MODE_STRICT) {
    for (const entry of posting) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const tf = coerceValue(entry[1]);
      if (tf == null) {
        if (rejectInvalid) {
          const error = new Error(
            `[sqlite] ${contextLabel} cardinality invariant failed: ` +
            `non-integer tf (${String(entry[1])}) is not allowed in strict mode.`
          );
          error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
          throw error;
        }
        alreadySortedUnique = false;
        break;
      }
    }
  }
  if (alreadySortedUnique) return posting;
  const merged = new Map();
  for (const entry of posting) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docId = coerceValue(entry[0]);
    const tf = coerceValue(entry[1]);
    if (docId == null || tf == null) {
      if (rejectInvalid) {
        const error = new Error(
          `[sqlite] ${contextLabel} cardinality invariant failed: must contain non-negative integer [docId, tf] pairs; ` +
          `received [${String(entry[0])}, ${String(entry[1])}].`
        );
        error.code = SQLITE_TOKEN_CARDINALITY_ERROR_CODE;
        throw error;
      }
      continue;
    }
    if (!tf) continue;
    merged.set(docId, (merged.get(docId) || 0) + tf);
  }
  if (!merged.size) return [];
  return Array.from(merged.entries()).sort((a, b) => a[0] - b[0]);
};

export const resolveChunkMetaSourceKind = (format) => (
  format === 'jsonl'
    ? 'jsonl'
    : (format === 'columnar'
      ? 'columnar'
      : (format === 'binary-columnar' ? 'binary-columnar' : 'json'))
);

export const CHUNK_META_REQUIRED_KEYS = resolveJsonlRequiredKeys('chunk_meta');

export const readJsonLinesFile = async (
  filePath,
  onEntry,
  { maxBytes = MAX_JSON_BYTES, requiredKeys = null } = {}
) => readJsonLinesEachAwait(filePath, onEntry, { maxBytes, requiredKeys });

export const iterateChunkMetaSources = async (
  sources,
  onEntry,
  {
    requiredKeys = CHUNK_META_REQUIRED_KEYS,
    onSourceFile = null
  } = {}
) => {
  if (!sources || typeof onEntry !== 'function') {
    return { sourceKind: 'json', sourceFiles: 0, count: 0 };
  }
  const sourceKind = resolveChunkMetaSourceKind(sources.format);
  const paths = Array.isArray(sources.paths) ? sources.paths : [];
  let sourceFiles = 0;
  let count = 0;
  const emitSourceFile = async (filePath) => {
    if (!filePath) return;
    sourceFiles += 1;
    if (typeof onSourceFile === 'function') {
      const result = onSourceFile(filePath, sourceKind);
      if (result && typeof result.then === 'function') await result;
    }
  };
  const emitEntry = async (entry) => {
    const result = onEntry(entry, count);
    if (result && typeof result.then === 'function') await result;
    count += 1;
  };
  if (sourceKind === 'json') {
    const sourcePath = paths[0];
    if (sourcePath) {
      await emitSourceFile(sourcePath);
      const rows = readJson(sourcePath);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          await emitEntry(row);
        }
      }
    }
    return { sourceKind, sourceFiles, count };
  }
  if (sourceKind === 'columnar') {
    const sourcePath = paths[0];
    if (sourcePath) {
      await emitSourceFile(sourcePath);
      const rows = inflateColumnarRows(readJson(sourcePath));
      if (Array.isArray(rows)) {
        for (const row of rows) {
          await emitEntry(row);
        }
      }
    }
    return { sourceKind, sourceFiles, count };
  }
  if (sourceKind === 'binary-columnar') {
    for (const sourcePath of paths) {
      await emitSourceFile(sourcePath);
    }
    const sourceDir = typeof sources?.dir === 'string' && sources.dir
      ? sources.dir
      : (paths.length ? path.dirname(paths[0]) : null);
    if (!sourceDir) return { sourceKind, sourceFiles, count };
    for await (const row of loadChunkMetaRows(sourceDir, {
      maxBytes: MAX_JSON_BYTES,
      strict: false,
      includeCold: false,
      materializeTokenIds: false,
      preferBinaryColumnar: true,
      enforceBinaryDataBudget: true
    })) {
      await emitEntry(row);
    }
    return { sourceKind, sourceFiles, count };
  }
  for (const sourcePath of paths) {
    if (!sourcePath) continue;
    await emitSourceFile(sourcePath);
    await readJsonLinesFile(sourcePath, async (entry) => {
      await emitEntry(entry);
    }, { requiredKeys });
  }
  return { sourceKind, sourceFiles, count };
};

/**
 * Load artifact pieces required for sqlite builds.
 * @param {string|{indexDir?:string,modes?:string[],modelId?:string}} dirOrOptions
 * @param {string} [modelId]
 * @returns {object|null}
 */
export const loadIndexPieces = async (dirOrOptions, modelId) => {
  if (dirOrOptions && typeof dirOrOptions === 'object' && !Array.isArray(dirOrOptions)) {
    const { indexDir, modes, modelId: modelIdOverride } = dirOrOptions;
    const baseDir = typeof indexDir === 'string' ? indexDir : null;
    const modeList = Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string') : [];
    const resolvedModelId = modelIdOverride ?? modelId;
    if (baseDir && modeList.length) {
      const piecesByMode = {};
      for (const mode of modeList) {
        const suffix = `${path.sep}index-${mode}`;
        const modeDir = baseDir.endsWith(suffix) ? baseDir : path.join(baseDir, `index-${mode}`);
        const pieces = await loadIndexPieces(modeDir, resolvedModelId);
        if (pieces) piecesByMode[mode] = pieces;
      }
      return piecesByMode;
    }
    dirOrOptions = baseDir;
    modelId = resolvedModelId;
  }
  const dir = dirOrOptions;
  if (!dir || typeof dir !== 'string') return null;
  const sources = resolveChunkMetaSources(dir);
  if (!sources) return null;
  const optional = loadSqliteIndexOptionalArtifacts(dir, { modelId });
  return {
    chunkMeta: null,
    dir,
    fileMeta: optional.fileMeta,
    denseVec: optional.denseVec,
    phraseNgrams: optional.phraseNgrams,
    chargrams: optional.chargrams,
    minhash: optional.minhash,
    tokenPostings: null,
    chunkMetaSources: sources,
    tokenPostingsSources: resolveTokenPostingsSources(dir)
  };
};

export { loadOptionalFileMetaRows, loadTokenPostings, readJson, MAX_JSON_BYTES };

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadTokenPostings,
  loadMinhashSignatureRows,
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows,
  loadFileMetaRows,
  readJsonFile
} from '../../shared/artifact-io.js';
import { normalizeFilePath as normalizeFilePathShared } from '../../shared/path-normalize.js';
import { logLine } from '../../shared/progress.js';

/**
 * Split an array into fixed-size chunks.
 * @param {Array<any>} items
 * @param {number} [size]
 * @returns {Array<Array<any>>}
 */
export function chunkArray(items, size = 900) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const SQLITE_BATCH_MIN = 50;
const SQLITE_BATCH_MAX = 2000;
const BYTES_PER_MB = 1024 * 1024;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Resolve a batch size for sqlite inserts based on input size.
 * @param {{batchSize?:number|null,inputBytes?:number|null,rowCount?:number|null}} [options]
 * @returns {number}
 */
export function resolveSqliteBatchSize(options = {}) {
  const requested = Number(options.batchSize);
  if (Number.isFinite(requested) && requested > 0) {
    return clamp(Math.floor(requested), SQLITE_BATCH_MIN, SQLITE_BATCH_MAX);
  }
  let resolved = 1000;
  const inputBytes = Number(options.inputBytes);
  if (Number.isFinite(inputBytes) && inputBytes > 0) {
    if (inputBytes >= 2048 * BYTES_PER_MB) resolved = 200;
    else if (inputBytes >= 512 * BYTES_PER_MB) resolved = 400;
    else if (inputBytes >= 128 * BYTES_PER_MB) resolved = 700;
  }
  const rowCount = Number(options.rowCount);
  if (Number.isFinite(rowCount) && rowCount > 0) {
    if (rowCount >= 1_000_000) resolved = Math.min(resolved, 200);
    else if (rowCount >= 200_000) resolved = Math.min(resolved, 400);
    else if (rowCount >= 50_000) resolved = Math.min(resolved, 700);
  }
  return clamp(resolved, SQLITE_BATCH_MIN, SQLITE_BATCH_MAX);
}

/**
 * Increment a batch statistic counter when provided.
 * @param {object|null} stats
 * @param {string} key
 */
export function bumpSqliteBatchStat(stats, key) {
  if (!stats || !key) return;
  stats[key] = (stats[key] || 0) + 1;
}

/**
 * Return the set of table names in a SQLite database.
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<string>}
 */
export function getTableNames(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return new Set(rows.map((row) => row.name));
}

/**
 * Check that all required tables exist.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} requiredTables
 * @returns {boolean}
 */
export function hasRequiredTables(db, requiredTables) {
  const tableNames = getTableNames(db);
  return requiredTables.every((name) => tableNames.has(name));
}

/**
 * Normalize a file path to POSIX separators.
 * @param {string} value
 * @returns {string|null}
 */
export function normalizeFilePath(value) {
  if (typeof value !== 'string') return null;
  const normalized = normalizeFilePathShared(value);
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

/**
 * Read and parse JSON from disk.
 * @param {string} filePath
 * @returns {any}
 */
export function readJson(filePath) {
  return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
}

/**
 * Read JSON from disk if it exists; otherwise return null.
 * @param {string} dir
 * @param {string} name
 * @returns {any|null}
 */
export function loadOptional(dir, name) {
  const target = path.join(dir, name);
  const hasTarget = fs.existsSync(target) || fs.existsSync(`${target}.bak`);
  const hasGz = name.endsWith('.json')
    && (fs.existsSync(`${target}.gz`) || fs.existsSync(`${target}.gz.bak`));
  const hasZst = name.endsWith('.json')
    && (fs.existsSync(`${target}.zst`) || fs.existsSync(`${target}.zst.bak`));
  if (!hasTarget && !hasGz && !hasZst) {
    return null;
  }
  try {
    return readJson(target);
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') {
      console.warn(`[sqlite] Skipping ${name}: ${err.message}`);
      return null;
    }
    throw err;
  }
}

const isOptionalArtifactMissingError = (err) => (
  err?.code === 'ERR_ARTIFACT_PARTS_MISSING'
  || err?.code === 'ERR_MANIFEST_MISSING'
  || /Missing index artifact/.test(err?.message || '')
  || /Missing manifest entry for /.test(err?.message || '')
);

export async function loadOptionalArrayArtifact(dir, name) {
  if (!dir || !name) return null;
  try {
    return await loadJsonArrayArtifact(dir, name, { maxBytes: MAX_JSON_BYTES, strict: false });
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') {
      console.warn(`[sqlite] Skipping ${name}: ${err.message}`);
      return null;
    }
    if (isOptionalArtifactMissingError(err)) {
      return null;
    }
    throw err;
  }
}

export function loadOptionalArrayArtifactRows(dir, name, { materialize = false } = {}) {
  return (async function* () {
    if (!dir || !name) return;
    try {
      for await (const row of loadJsonArrayArtifactRows(dir, name, {
        maxBytes: MAX_JSON_BYTES,
        strict: false,
        materialize
      })) {
        yield row;
      }
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(`[sqlite] Skipping ${name}: ${err.message}`);
        return;
      }
      if (isOptionalArtifactMissingError(err)) {
        return;
      }
      throw err;
    }
  })();
}

export function loadOptionalFileMetaRows(
  dir,
  { materialize = false } = {}
) {
  return (async function* () {
    if (!dir) return;
    try {
      for await (const row of loadFileMetaRows(dir, {
        maxBytes: MAX_JSON_BYTES,
        strict: false,
        materialize
      })) {
        yield row;
      }
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(`[sqlite] Skipping file_meta: ${err.message}`);
        return;
      }
      if (isOptionalArtifactMissingError(err)) {
        return;
      }
      throw err;
    }
  })();
}

export function loadOptionalMinhashRows(dir, { materialize = false } = {}) {
  return (async function* () {
    if (!dir) return;
    try {
      for await (const row of loadMinhashSignatureRows(dir, {
        maxBytes: MAX_JSON_BYTES,
        strict: false,
        materialize
      })) {
        yield row;
      }
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        console.warn(`[sqlite] Skipping minhash_signatures: ${err.message}`);
        return;
      }
      if (isOptionalArtifactMissingError(err)) {
        return;
      }
      throw err;
    }
  })();
}

const loadOptionalDenseBinary = (dir, baseName, modelId) => {
  if (!dir || !baseName) return null;
  const metaPath = path.join(dir, `${baseName}.bin.meta.json`);
  if (!fs.existsSync(metaPath)) return null;
  let metaRaw = null;
  try {
    metaRaw = readJson(metaPath);
  } catch {
    return null;
  }
  const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  const relPath = typeof meta?.path === 'string' && meta.path
    ? meta.path
    : `${baseName}.bin`;
  const binPath = path.join(dir, relPath);
  if (!fs.existsSync(binPath)) return null;
  const dims = Number.isFinite(Number(meta?.dims)) ? Math.max(0, Math.floor(Number(meta.dims))) : 0;
  const count = Number.isFinite(Number(meta?.count)) ? Math.max(0, Math.floor(Number(meta.count))) : 0;
  if (!dims || !count) return null;
  try {
    const buffer = fs.readFileSync(binPath);
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const expectedBytes = dims * count;
    if (view.length < expectedBytes) return null;
    const rows = (async function* iterateRows() {
      for (let docId = 0; docId < count; docId += 1) {
        const start = docId * dims;
        const end = start + dims;
        yield { docId, vector: view.subarray(start, end) };
      }
    })();
    return {
      ...meta,
      model: meta?.model || modelId || null,
      dims,
      count,
      path: relPath,
      buffer: view,
      rows
    };
  } catch {
    return null;
  }
};

const normalizeDenseVectorPayload = (denseVec) => {
  if (!denseVec || typeof denseVec !== 'object') return denseVec;
  const fields = denseVec.fields && typeof denseVec.fields === 'object' ? denseVec.fields : null;
  const arrays = denseVec.arrays && typeof denseVec.arrays === 'object' ? denseVec.arrays : null;
  if (!fields && !arrays) return denseVec;
  const vectors = Array.isArray(arrays?.vectors) ? arrays.vectors : denseVec.vectors;
  const normalized = {
    ...denseVec,
    ...(fields || {})
  };
  if (vectors) normalized.vectors = vectors;
  if (fields?.model && !normalized.model) normalized.model = fields.model;
  if (fields?.scale != null && normalized.scale == null) normalized.scale = fields.scale;
  if (fields?.minVal != null && normalized.minVal == null) normalized.minVal = fields.minVal;
  if (fields?.maxVal != null && normalized.maxVal == null) normalized.maxVal = fields.maxVal;
  if (fields?.levels != null && normalized.levels == null) normalized.levels = fields.levels;
  if (fields?.dims != null && !Number.isFinite(Number(normalized.dims))) {
    const dims = Number(fields.dims);
    if (Number.isFinite(dims) && dims > 0) normalized.dims = dims;
  }
  return normalized;
};

const loadDenseVectorArtifact = (dir, baseName, { modelId = null } = {}) => {
  const denseBinary = loadOptionalDenseBinary(dir, baseName, modelId);
  const denseMeta = denseBinary ? null : loadOptional(dir, `${baseName}.meta.json`);
  let denseVec = denseBinary;
  if (!denseVec) {
    if (denseMeta && typeof denseMeta === 'object') {
      const totalRecords = Number.isFinite(Number(denseMeta.totalRecords))
        ? Math.max(0, Math.floor(Number(denseMeta.totalRecords)))
        : 0;
      const hasParts = Array.isArray(denseMeta.parts) && denseMeta.parts.length > 0;
      denseVec = {
        ...denseMeta,
        model: denseMeta.model || modelId || null,
        ...(totalRecords > 0 && hasParts
          ? { rows: loadOptionalArrayArtifactRows(dir, baseName, { materialize: true }) }
          : { vectors: [] })
      };
    } else {
      denseVec = loadOptional(dir, `${baseName}.json`);
      if (denseVec && !denseVec.model) denseVec.model = modelId || null;
    }
  }
  return normalizeDenseVectorPayload(denseVec);
};

export function loadSqliteIndexOptionalArtifacts(dir, { modelId = null } = {}) {
  let denseVec = null;
  const denseCandidates = [
    'dense_vectors_uint8',
    'dense_vectors_code_uint8',
    'dense_vectors_doc_uint8'
  ];
  for (const baseName of denseCandidates) {
    denseVec = loadDenseVectorArtifact(dir, baseName, { modelId });
    if (denseVec) break;
  }
  return {
    fileMeta: loadOptionalFileMetaRows(dir, { materialize: true }),
    minhash: loadOptionalMinhashRows(dir, { materialize: true }),
    denseVec,
    phraseNgrams: loadOptional(dir, 'phrase_ngrams.json'),
    chargrams: loadOptional(dir, 'chargram_postings.json')
  };
}

/**
 * Load file-backed index artifacts from a directory.
 * @param {string} dir
 * @param {string} modelId
 * @returns {object|null}
 */
export async function loadIndex(dir, modelId) {
  const chunkMetaPath = path.join(dir, 'chunk_meta.json');
  const chunkMetaJsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const chunkMetaMetaPath = path.join(dir, 'chunk_meta.meta.json');
  const chunkMetaCompressedPaths = [
    `${chunkMetaPath}.gz`,
    `${chunkMetaPath}.zst`,
    `${chunkMetaJsonlPath}.gz`,
    `${chunkMetaJsonlPath}.zst`
  ];
  if (!fs.existsSync(chunkMetaPath)
    && !fs.existsSync(chunkMetaJsonlPath)
    && !fs.existsSync(chunkMetaMetaPath)
    && !chunkMetaCompressedPaths.some((target) => fs.existsSync(target))) {
    return null;
  }
  const chunkMeta = await loadChunkMeta(dir, { maxBytes: MAX_JSON_BYTES });
  const optional = loadSqliteIndexOptionalArtifacts(dir, { modelId });
  return {
    chunkMeta,
    fileMeta: optional.fileMeta,
    denseVec: optional.denseVec,
    phraseNgrams: optional.phraseNgrams,
    chargrams: optional.chargrams,
    minhash: optional.minhash,
    tokenPostings: (() => {
      const direct = loadOptional(dir, 'token_postings.json');
      if (direct) return direct;
      try {
        return loadTokenPostings(dir, { maxBytes: MAX_JSON_BYTES });
      } catch {
        return null;
      }
    })()
  };
}

const SQLITE_SIDECARS = ['-wal', '-shm'];

/**
 * Remove SQLite WAL/SHM sidecar files for a database path.
 * @param {string} basePath
 * @returns {Promise<void>}
 */
export async function removeSqliteSidecars(basePath) {
  await Promise.all(SQLITE_SIDECARS.map(async (suffix) => {
    try {
      const targetPath = `${basePath}${suffix}`;
      if (fs.existsSync(targetPath)) {
        logLine(`[sqlite-cleanup] remove ${targetPath}`, { kind: 'status' });
      }
      await fsPromises.rm(targetPath, { force: true });
    } catch {}
  }));
}

/**
 * Atomically replace a sqlite database, cleaning up WAL/SHM sidecars.
 * @param {string} tempDbPath
 * @param {string} finalDbPath
 * @param {{keepBackup?:boolean,backupPath?:string}} [options]
 */
export async function replaceSqliteDatabase(tempDbPath, finalDbPath, options = {}) {
  const keepBackup = options.keepBackup === true;
  const backupPath = options.backupPath || `${finalDbPath}.bak`;
  const finalExists = fs.existsSync(finalDbPath);
  if (!fs.existsSync(tempDbPath)) {
    const err = new Error(`Temp sqlite db missing before replace: ${tempDbPath}`);
    err.code = 'ERR_SQLITE_TEMP_MISSING';
    throw err;
  }
  const emit = (message) => {
    if (!message) return;
    if (options.logger?.warn) {
      options.logger.warn(message);
      return;
    }
    if (options.logger?.log) {
      options.logger.log(message);
    }
  };

  await removeSqliteSidecars(tempDbPath);
  await removeSqliteSidecars(finalDbPath);

  let backupAvailable = fs.existsSync(backupPath);
  if (finalExists && !backupAvailable) {
    try {
      await fsPromises.rename(finalDbPath, backupPath);
      backupAvailable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        backupAvailable = fs.existsSync(backupPath);
      }
      if (!backupAvailable) {
        emit(`[sqlite] Failed to move existing db to backup (${err?.message || err}).`);
      }
    }
  }

  try {
    await fsPromises.rename(tempDbPath, finalDbPath);
  } catch (err) {
    if (err?.code !== 'EEXIST' && err?.code !== 'EPERM' && err?.code !== 'ENOTEMPTY') {
      throw err;
    }
    if (!backupAvailable) {
      throw err;
    }
    emit('[sqlite] Falling back to removing existing db before replace.');
    try {
      await fsPromises.rm(finalDbPath, { force: true });
    } catch {}
    await fsPromises.rename(tempDbPath, finalDbPath);
  }

  if (!keepBackup) {
    try {
      await fsPromises.rm(backupPath, { force: true });
    } catch {}
  }
  await removeSqliteSidecars(finalDbPath);
  await removeSqliteSidecars(backupPath);
}

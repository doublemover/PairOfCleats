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
import { joinPathSafe, normalizeFilePath as normalizeFilePathShared } from '../../shared/path-normalize.js';
import { clamp } from '../../shared/limits.js';
import { logLine } from '../../shared/progress.js';
import { loadOptionalSyncWithFallback } from '../../shared/optional-artifact-fallback.js';
import {
  hasChunkMetaArtifactsSync,
  loadOptionalWithFallback,
  iterateOptionalWithFallback
} from '../../shared/index-artifact-helpers.js';

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
const SQLITE_DEFAULT_BATCH = 1000;
const SQLITE_DEFAULT_PAGE_SIZE = 4096;
const BYTES_PER_MB = 1024 * 1024;
const SQLITE_WAL_LOW_BYTES = 4 * BYTES_PER_MB;
const SQLITE_WAL_MEDIUM_BYTES = 24 * BYTES_PER_MB;
const SQLITE_WAL_HIGH_BYTES = 96 * BYTES_PER_MB;
const SQLITE_TX_ROWS_MIN = 2000;
const SQLITE_TX_ROWS_MAX = 250000;
const toPositiveFinite = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};
const normalizeJournalMode = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const resolveSqliteBatchInputs = (options = {}) => {
  const batchHint = options.batchSize && typeof options.batchSize === 'object' && !Array.isArray(options.batchSize)
    ? options.batchSize
    : null;
  const requested = toPositiveFinite(batchHint?.requested ?? batchHint?.batchSize ?? options.batchSize);
  const inputBytes = toPositiveFinite(batchHint?.inputBytes ?? options.inputBytes) || 0;
  const repoBytes = toPositiveFinite(batchHint?.repoBytes ?? options.repoBytes) || inputBytes;
  const rowCount = toPositiveFinite(batchHint?.rowCount ?? options.rowCount) || 0;
  const fileCount = toPositiveFinite(batchHint?.fileCount ?? options.fileCount) || 0;
  const pageSize = Math.max(
    512,
    Math.floor(toPositiveFinite(batchHint?.pageSize ?? options.pageSize) || SQLITE_DEFAULT_PAGE_SIZE)
  );
  const journalMode = normalizeJournalMode(batchHint?.journalMode ?? options.journalMode);
  const walEnabledInput = batchHint?.walEnabled ?? options.walEnabled;
  const walEnabled = typeof walEnabledInput === 'boolean'
    ? walEnabledInput
    : journalMode === 'wal';
  const walBytes = toPositiveFinite(batchHint?.walBytes ?? options.walBytes) || 0;
  return {
    requested,
    inputBytes,
    repoBytes,
    rowCount,
    fileCount,
    pageSize,
    journalMode,
    walEnabled,
    walBytes
  };
};

const resolveSqliteWalPressure = ({ walEnabled, walBytes }) => {
  if (!walEnabled) return 'off';
  if (walBytes >= SQLITE_WAL_HIGH_BYTES) return 'high';
  if (walBytes >= SQLITE_WAL_MEDIUM_BYTES) return 'medium';
  if (walBytes >= SQLITE_WAL_LOW_BYTES) return 'low';
  return 'none';
};

const resolveSqliteBaseBatchSize = ({ requested, inputBytes, rowCount }) => {
  if (requested != null) {
    return clamp(Math.floor(requested), SQLITE_BATCH_MIN, SQLITE_BATCH_MAX);
  }
  let resolved = SQLITE_DEFAULT_BATCH;
  if (inputBytes > 0) {
    if (inputBytes >= 2048 * BYTES_PER_MB) resolved = 200;
    else if (inputBytes >= 512 * BYTES_PER_MB) resolved = 400;
    else if (inputBytes >= 128 * BYTES_PER_MB) resolved = 700;
  }
  if (rowCount > 0) {
    if (rowCount >= 1_000_000) resolved = Math.min(resolved, 200);
    else if (rowCount >= 200_000) resolved = Math.min(resolved, 400);
    else if (rowCount >= 50_000) resolved = Math.min(resolved, 700);
  }
  return clamp(resolved, SQLITE_BATCH_MIN, SQLITE_BATCH_MAX);
};

const applySqliteRuntimeBatchAdjustments = ({
  baseBatchSize,
  pageSize,
  walEnabled,
  walBytes,
  journalMode
}) => {
  let resolved = baseBatchSize;
  if (pageSize >= 16384) resolved = Math.round(resolved * 1.28);
  else if (pageSize >= 8192) resolved = Math.round(resolved * 1.14);
  else if (pageSize <= 2048) resolved = Math.round(resolved * 0.84);
  const walPressure = resolveSqliteWalPressure({ walEnabled, walBytes });
  if (walEnabled) {
    if (walPressure === 'high') resolved = Math.round(resolved * 0.55);
    else if (walPressure === 'medium') resolved = Math.round(resolved * 0.72);
    else if (walPressure === 'low') resolved = Math.round(resolved * 0.86);
  } else if (journalMode && !['off', 'memory'].includes(journalMode)) {
    resolved = Math.round(resolved * 0.9);
  }
  return {
    batchSize: clamp(resolved, SQLITE_BATCH_MIN, SQLITE_BATCH_MAX),
    walPressure
  };
};

const resolveSqliteRepoTier = ({ repoBytes, rowCount }) => {
  if (repoBytes >= 1536 * BYTES_PER_MB || rowCount >= 1_000_000) return 'xlarge';
  if (repoBytes >= 512 * BYTES_PER_MB || rowCount >= 250_000) return 'large';
  if (repoBytes >= 128 * BYTES_PER_MB || rowCount >= 75_000) return 'medium';
  return 'small';
};

const resolveSqliteTransactionRows = ({
  repoTier,
  pageSize,
  walPressure
}) => {
  let rows = 64000;
  if (repoTier === 'xlarge') rows = 12000;
  else if (repoTier === 'large') rows = 22000;
  else if (repoTier === 'medium') rows = 36000;
  if (pageSize >= 16384) rows = Math.round(rows * 1.25);
  else if (pageSize >= 8192) rows = Math.round(rows * 1.12);
  else if (pageSize <= 2048) rows = Math.round(rows * 0.82);
  if (walPressure === 'high') rows = Math.round(rows * 0.45);
  else if (walPressure === 'medium') rows = Math.round(rows * 0.65);
  else if (walPressure === 'low') rows = Math.round(rows * 0.82);
  return clamp(rows, SQLITE_TX_ROWS_MIN, SQLITE_TX_ROWS_MAX);
};

const resolveSqliteRowsPerFile = ({ rowCount, fileCount }) => {
  if (rowCount > 0 && fileCount > 0) {
    return clamp(Math.round(rowCount / fileCount), 1, SQLITE_TX_ROWS_MAX);
  }
  if (rowCount > 0) {
    return clamp(Math.round(Math.sqrt(rowCount)), 1, SQLITE_TX_ROWS_MAX);
  }
  return 12;
};

/**
 * Resolve sqlite ingest shape metadata (batch sizing and transaction hints).
 * @param {{
 *   batchSize?:number|{requested?:number|null,pageSize?:number|null,journalMode?:string|null,walEnabled?:boolean|null,walBytes?:number|null,rowCount?:number|null,fileCount?:number|null,repoBytes?:number|null,inputBytes?:number|null}|null,
 *   inputBytes?:number|null,
 *   repoBytes?:number|null,
 *   rowCount?:number|null,
 *   fileCount?:number|null,
 *   pageSize?:number|null,
 *   journalMode?:string|null,
 *   walEnabled?:boolean|null,
 *   walBytes?:number|null
 * }} [options]
 * @returns {{
 *   batchSize:number,
 *   transactionRows:number,
 *   batchesPerTransaction:number,
 *   filesPerTransaction:number,
 *   rowsPerFile:number,
 *   repoTier:'small'|'medium'|'large'|'xlarge',
 *   walPressure:'off'|'none'|'low'|'medium'|'high',
 *   pageSize:number,
 *   journalMode:string|null,
 *   walEnabled:boolean,
 *   walBytes:number,
 *   rowCount:number,
 *   fileCount:number,
 *   repoBytes:number,
 *   inputBytes:number
 * }}
 */
export function resolveSqliteIngestPlan(options = {}) {
  const input = resolveSqliteBatchInputs(options);
  const baseBatchSize = resolveSqliteBaseBatchSize(input);
  const runtimeAdjusted = input.requested != null
    ? {
      batchSize: clamp(Math.floor(input.requested), SQLITE_BATCH_MIN, SQLITE_BATCH_MAX),
      walPressure: resolveSqliteWalPressure(input)
    }
    : applySqliteRuntimeBatchAdjustments({
      baseBatchSize,
      pageSize: input.pageSize,
      walEnabled: input.walEnabled,
      walBytes: input.walBytes,
      journalMode: input.journalMode
    });
  const batchSize = runtimeAdjusted.batchSize;
  const repoTier = resolveSqliteRepoTier(input);
  const transactionRows = resolveSqliteTransactionRows({
    repoTier,
    pageSize: input.pageSize,
    walPressure: runtimeAdjusted.walPressure
  });
  const rowsPerFile = resolveSqliteRowsPerFile(input);
  const filesPerTransaction = clamp(
    Math.round(transactionRows / Math.max(rowsPerFile, 1)),
    1,
    2000
  );
  const batchesPerTransaction = clamp(
    Math.round(transactionRows / Math.max(batchSize, 1)),
    1,
    2000
  );
  return {
    batchSize,
    transactionRows,
    batchesPerTransaction,
    filesPerTransaction,
    rowsPerFile,
    repoTier,
    walPressure: runtimeAdjusted.walPressure,
    pageSize: input.pageSize,
    journalMode: input.journalMode,
    walEnabled: input.walEnabled,
    walBytes: input.walBytes,
    rowCount: input.rowCount,
    fileCount: input.fileCount,
    repoBytes: input.repoBytes,
    inputBytes: input.inputBytes
  };
};

/**
 * Resolve a batch size for sqlite inserts based on input size.
 * @param {{
 *   batchSize?:number|object|null,
 *   inputBytes?:number|null,
 *   repoBytes?:number|null,
 *   rowCount?:number|null,
 *   fileCount?:number|null,
 *   pageSize?:number|null,
 *   journalMode?:string|null,
 *   walEnabled?:boolean|null,
 *   walBytes?:number|null
 * }} [options]
 * @returns {number}
 */
export function resolveSqliteBatchSize(options = {}) {
  return resolveSqliteIngestPlan(options).batchSize;
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

const warnOptionalTooLarge = (name, err) => {
  console.warn(`[sqlite] Skipping ${name}: ${err.message}`);
};

/**
 * Read JSON from disk if it exists; otherwise return null.
 * @param {string} dir
 * @param {string} name
 * @returns {any|null}
 */
export function loadOptional(dir, name) {
  if (!dir || !name) return null;
  const target = path.join(dir, name);
  return loadOptionalSyncWithFallback(
    () => readJson(target),
    { name, onTooLarge: warnOptionalTooLarge }
  );
}

export async function loadOptionalArrayArtifact(dir, name) {
  if (!dir || !name) return null;
  return loadOptionalWithFallback(
    () => loadJsonArrayArtifact(dir, name, { maxBytes: MAX_JSON_BYTES, strict: false }),
    { name, onTooLarge: warnOptionalTooLarge }
  );
}

export function loadOptionalArrayArtifactRows(dir, name, { materialize = false } = {}) {
  if (!dir || !name) {
    return (async function* () {})();
  }
  return iterateOptionalWithFallback(
    () => loadJsonArrayArtifactRows(dir, name, {
      maxBytes: MAX_JSON_BYTES,
      strict: false,
      materialize
    }),
    { name, onTooLarge: warnOptionalTooLarge }
  );
}

export function loadOptionalFileMetaRows(
  dir,
  { materialize = false } = {}
) {
  if (!dir) {
    return (async function* () {})();
  }
  return iterateOptionalWithFallback(
    () => loadFileMetaRows(dir, {
      maxBytes: MAX_JSON_BYTES,
      strict: false,
      materialize
    }),
    { name: 'file_meta', onTooLarge: warnOptionalTooLarge }
  );
}

export function loadOptionalMinhashRows(dir, { materialize = false } = {}) {
  if (!dir) {
    return (async function* () {})();
  }
  return iterateOptionalWithFallback(
    () => loadMinhashSignatureRows(dir, {
      maxBytes: MAX_JSON_BYTES,
      strict: false,
      materialize
    }),
    { name: 'minhash_signatures', onTooLarge: warnOptionalTooLarge }
  );
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
  const binPath = joinPathSafe(dir, [relPath]);
  if (!binPath) return null;
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
  if (!hasChunkMetaArtifactsSync(dir)) {
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
  /**
   * Move a file into place and transparently handle cross-device (`EXDEV`)
   * boundaries by copy+remove fallback.
   *
   * `preserveSource` is used by rollback restore paths that should leave the
   * backup artifact intact when `keepBackup=true`.
   */
  const moveFileWithCrossDeviceFallback = async (sourcePath, destinationPath, { preserveSource = false } = {}) => {
    if (!preserveSource) {
      try {
        await fsPromises.rename(sourcePath, destinationPath);
        return;
      } catch (err) {
        if (err?.code !== 'EXDEV') throw err;
      }
    }
    await fsPromises.copyFile(sourcePath, destinationPath);
    if (!preserveSource) {
      await fsPromises.rm(sourcePath, { force: true });
    }
  };

  await removeSqliteSidecars(tempDbPath);
  await removeSqliteSidecars(finalDbPath);

  let backupAvailable = fs.existsSync(backupPath);
  if (finalExists && !backupAvailable) {
    try {
      await moveFileWithCrossDeviceFallback(finalDbPath, backupPath);
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

  const tryRestoreBackup = async () => {
    if (!backupAvailable) return;
    if (fs.existsSync(finalDbPath)) return;
    if (!fs.existsSync(backupPath)) return;
    emit('[sqlite] Replace failed; restoring previous database from backup.');
    await moveFileWithCrossDeviceFallback(backupPath, finalDbPath, {
      preserveSource: keepBackup
    });
    if (!keepBackup) {
      backupAvailable = false;
    }
  };

  try {
    try {
      await moveFileWithCrossDeviceFallback(tempDbPath, finalDbPath);
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
      await moveFileWithCrossDeviceFallback(tempDbPath, finalDbPath);
    }
  } catch (err) {
    try {
      await tryRestoreBackup();
    } catch (restoreError) {
      restoreError.message = `[sqlite] Failed to restore backup after replace failure: ${restoreError.message}`;
      throw restoreError;
    }
    throw err;
  }

  if (!keepBackup) {
    try {
      await fsPromises.rm(backupPath, { force: true });
    } catch {}
  }
  await removeSqliteSidecars(finalDbPath);
  await removeSqliteSidecars(backupPath);
}

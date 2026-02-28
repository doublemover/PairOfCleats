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
  loadDenseVectorBinaryFromMetaSync,
  normalizeDenseVectorMeta
} from '../../shared/dense-vector-artifacts.js';
import {
  hasChunkMetaArtifactsSync,
  loadOptionalWithFallback,
  iterateOptionalWithFallback
} from '../../shared/index-artifact-helpers.js';
import { getEnvConfig } from '../../shared/env.js';

/**
 * Split an array into fixed-size chunks.
 * @param {Array<any>} items
 * @param {number} [size]
 * @returns {Array<Array<any>>}
 */
export function chunkArray(items, size = 900) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const parsedSize = Number(size);
  const chunkSize = Number.isFinite(parsedSize) && parsedSize > 0
    ? Math.max(1, Math.floor(parsedSize))
    : 900;
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
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
const DEFAULT_DENSE_BINARY_MAX_INLINE_MB = 512;
const DENSE_BINARY_STREAM_READ_TARGET_BYTES = 4 * BYTES_PER_MB;

const resolveDenseBinaryMaxInlineBytes = () => {
  const envConfig = getEnvConfig();
  const fromMb = Number(envConfig?.denseBinaryMaxInlineMb);
  if (Number.isFinite(fromMb) && fromMb > 0) {
    return Math.floor(fromMb * BYTES_PER_MB);
  }
  return DEFAULT_DENSE_BINARY_MAX_INLINE_MB * BYTES_PER_MB;
};

const createDenseBinaryRowIterator = (binPath, dims, count) => (
  async function* iterateRows() {
    let handle = null;
    const rowsPerRead = Math.max(
      1,
      Math.floor(DENSE_BINARY_STREAM_READ_TARGET_BYTES / Math.max(1, dims))
    );
    const readBytes = Math.max(dims, rowsPerRead * dims);
    const readBuffer = Buffer.allocUnsafe(readBytes);
    try {
      handle = await fsPromises.open(binPath, 'r');
      for (let docId = 0; docId < count;) {
        const remaining = count - docId;
        const rowsThisRead = Math.min(rowsPerRead, remaining);
        const bytesThisRead = rowsThisRead * dims;
        const offset = docId * dims;
        const { bytesRead } = await handle.read(readBuffer, 0, bytesThisRead, offset);
        const rowsRead = Math.floor(bytesRead / dims);
        if (rowsRead <= 0) break;
        for (let rowIndex = 0; rowIndex < rowsRead; rowIndex += 1) {
          const start = rowIndex * dims;
          yield {
            docId: docId + rowIndex,
            vector: Uint8Array.from(readBuffer.subarray(start, start + dims))
          };
        }
        docId += rowsRead;
        if (rowsRead < rowsThisRead) break;
      }
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
    }
  }
)();

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
  const meta = normalizeDenseVectorMeta(metaRaw);
  if (!meta) return null;
  const relPath = typeof meta.path === 'string' && meta.path
    ? meta.path
    : `${baseName}.bin`;
  const binPath = joinPathSafe(dir, [relPath]);
  if (!binPath || !fs.existsSync(binPath)) return null;
  const failDenseBinaryMeta = (reason) => {
    const error = new Error(`[sqlite] dense binary meta invalid for ${baseName}: ${reason}`);
    error.code = 'ERR_SQLITE_DENSE_BINARY_META_INVALID';
    throw error;
  };
  const dims = Number.isFinite(Number(meta.dims)) ? Math.max(0, Math.floor(Number(meta.dims))) : 0;
  if (!dims) {
    failDenseBinaryMeta('missing required positive dims in .bin.meta.json');
  }
  const rawCount = Number(meta.count);
  if (!Number.isFinite(rawCount) || rawCount < 0) {
    failDenseBinaryMeta('missing required non-negative count in .bin.meta.json');
  }
  const count = Math.floor(rawCount);
  const expectedBytes = dims * count;
  let fileBytes = 0;
  try {
    fileBytes = Number(fs.statSync(binPath).size) || 0;
  } catch {
    return null;
  }
  if (fileBytes < expectedBytes) {
    failDenseBinaryMeta(`binary payload too small (expected >= ${expectedBytes} bytes, found ${fileBytes})`);
  }
  if (count === 0) {
    const rows = (async function* iterateRows() {})();
    return {
      ...meta,
      model: meta.model || modelId || null,
      dims,
      count: 0,
      path: relPath,
      buffer: new Uint8Array(0),
      rows,
      streamed: false
    };
  }
  const maxInlineBytes = resolveDenseBinaryMaxInlineBytes();
  if (expectedBytes > maxInlineBytes) {
    return {
      ...meta,
      model: meta.model || modelId || null,
      dims,
      count,
      path: relPath,
      buffer: null,
      rows: createDenseBinaryRowIterator(binPath, dims, count),
      streamed: true
    };
  }
  const dense = loadDenseVectorBinaryFromMetaSync({
    dir,
    baseName,
    meta: metaRaw,
    modelId: modelId || null
  });
  if (!dense) {
    failDenseBinaryMeta('failed to materialize dense vectors from .bin.meta.json');
  }
  const rows = (async function* iterateRows() {
    for (let docId = 0; docId < count; docId += 1) {
      const start = docId * dims;
      const end = start + dims;
      yield { docId, vector: dense.buffer.subarray(start, end) };
    }
  })();
  return {
    ...dense,
    rows
  };
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
  const denseMetaRaw = denseBinary ? null : loadOptional(dir, `${baseName}.meta.json`);
  const denseMeta = normalizeDenseVectorMeta(denseMetaRaw) || denseMetaRaw;
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
  const createCrossDeviceReplaceError = (operation, sourcePath, destinationPath, cause) => {
    const err = new Error(
      `[sqlite] Cross-device replace blocked during ${operation}; SQLite promotion requires temp/output/backup paths on the same volume. `
      + `source=${sourcePath} destination=${destinationPath}`
    );
    err.code = 'ERR_SQLITE_REPLACE_CROSS_DEVICE';
    err.operation = operation;
    err.sourcePath = sourcePath;
    err.destinationPath = destinationPath;
    err.cause = cause || null;
    err.causeCode = cause?.code || null;
    return err;
  };
  /**
   * Move a file into place and fail closed on cross-device (`EXDEV`) boundaries.
   */
  const moveFileOrFailCrossDevice = async (
    sourcePath,
    destinationPath,
    { operation = 'sqlite-replace' } = {}
  ) => {
    try {
      await fsPromises.rename(sourcePath, destinationPath);
    } catch (err) {
      if (err?.code === 'EXDEV') {
        throw createCrossDeviceReplaceError(operation, sourcePath, destinationPath, err);
      }
      throw err;
    }
  };

  await removeSqliteSidecars(tempDbPath);
  await removeSqliteSidecars(finalDbPath);

  let backupAvailable = fs.existsSync(backupPath);
  let backupFromCurrentFinal = false;
  if (finalExists) {
    if (backupAvailable) {
      try {
        await fsPromises.rm(backupPath, { force: true });
      } catch {}
      backupAvailable = fs.existsSync(backupPath);
    }
    if (!backupAvailable) {
      try {
        await moveFileOrFailCrossDevice(finalDbPath, backupPath, {
          operation: 'move-final-to-backup'
        });
        backupAvailable = true;
        backupFromCurrentFinal = true;
      } catch (err) {
        if (err?.code === 'ERR_SQLITE_REPLACE_CROSS_DEVICE') {
          throw err;
        }
        if (err?.code !== 'ENOENT') {
          backupAvailable = fs.existsSync(backupPath);
          if (!backupAvailable) throw err;
        }
        if (!backupAvailable) {
          emit(`[sqlite] Failed to move existing db to backup (${err?.message || err}).`);
        }
      }
    }
  }

  const tryRestoreBackup = async () => {
    if (!backupAvailable || !backupFromCurrentFinal) return;
    if (fs.existsSync(finalDbPath)) return;
    if (!fs.existsSync(backupPath)) return;
    emit('[sqlite] Replace failed; restoring previous database from backup.');
    await moveFileOrFailCrossDevice(backupPath, finalDbPath, {
      operation: 'restore-backup-to-final'
    });
    if (keepBackup) {
      await fsPromises.copyFile(finalDbPath, backupPath);
    } else {
      backupAvailable = false;
      backupFromCurrentFinal = false;
    }
  };

  try {
    try {
      await moveFileOrFailCrossDevice(tempDbPath, finalDbPath, {
        operation: 'promote-temp-to-final'
      });
    } catch (err) {
      if (err?.code !== 'EEXIST' && err?.code !== 'EPERM' && err?.code !== 'ENOTEMPTY') {
        throw err;
      }
      if (!backupFromCurrentFinal) {
        throw err;
      }
      emit('[sqlite] Falling back to removing existing db before replace.');
      try {
        await fsPromises.rm(finalDbPath, { force: true });
      } catch {}
      await moveFileOrFailCrossDevice(tempDbPath, finalDbPath, {
        operation: 'promote-temp-to-final-after-remove'
      });
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

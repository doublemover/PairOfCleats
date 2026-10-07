import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows } from '../../shared/artifact-io/loaders/core.js';
import { loadFileMetaRows } from '../../shared/artifact-io/loaders/core-file-meta.js';
import { loadChunkMeta } from '../../shared/artifact-io/loaders/chunk-meta.js';
import { loadMinhashSignatureRows } from '../../shared/artifact-io/loaders/minhash.js';
import { loadTokenPostings } from '../../shared/artifact-io/loaders/token-postings.js';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import { joinPathSafe, normalizeFilePath as normalizeFilePathShared } from '../../shared/path-normalize.js';
import { clamp } from '../../shared/limits.js';
import { logLine } from '../../shared/progress-runtime.js';
import { hasChunkMetaArtifactsSync } from '../../shared/artifact-io/chunk-meta-presence.js';
import {
  loadOptionalSyncWithFallback,
  loadOptionalWithFallback,
  iterateOptionalWithFallback
} from '../../shared/artifact-io/optional-fallback.js';
import {
  loadDenseVectorBinaryFromMetaSync,
  normalizeDenseVectorMeta
} from '../../shared/dense-vector-artifacts.js';
import { getEnvConfig } from '../../shared/env/runtime.js';

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

export const resolveExpectedDenseCount = (denseVec) => {
  if (!denseVec || typeof denseVec !== 'object') return 0;
  const fields = denseVec.fields && typeof denseVec.fields === 'object' ? denseVec.fields : null;
  const fromCount = Number(denseVec.count ?? fields?.count);
  if (Number.isFinite(fromCount) && fromCount > 0) return Math.floor(fromCount);
  const fromTotalRecords = Number(denseVec.totalRecords ?? fields?.totalRecords);
  if (Number.isFinite(fromTotalRecords) && fromTotalRecords > 0) return Math.floor(fromTotalRecords);
  const vectors = denseVec.vectors ?? denseVec.arrays?.vectors;
  if (Array.isArray(vectors) && vectors.length > 0) return vectors.length;
  return 0;
};

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
const SQLITE_TELEMETRY_MAX_SAMPLES = 12;
const SQLITE_COMMIT_STALL_MS = 200;
const SQLITE_CHECKPOINT_STALL_MS = 500;
const DEFAULT_DENSE_BINARY_MAX_INLINE_MB = 512;
const DENSE_BINARY_STREAM_READ_TARGET_BYTES = 4 * BYTES_PER_MB;
const BENIGN_SQLITE_CLEANUP_CODES = new Set(['ENOENT', 'ENOTDIR']);

const isBenignSqliteCleanupError = (error) => (
  BENIGN_SQLITE_CLEANUP_CODES.has(String(error?.code || '').toUpperCase())
);

const emitSqliteCleanupWarning = (logger, message) => {
  if (!message) return;
  if (logger?.warn) {
    logger.warn(message);
    return;
  }
  logLine(message, { kind: 'warning' });
};

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

const pushBoundedSample = (list, entry, max = SQLITE_TELEMETRY_MAX_SAMPLES) => {
  if (!Array.isArray(list)) return;
  list.push(entry);
  while (list.length > max) {
    list.shift();
  }
};

const getOrCreateSqliteRuntimeTelemetry = (stats) => {
  if (!stats || typeof stats !== 'object') return null;
  const telemetry = stats.runtimeTelemetry && typeof stats.runtimeTelemetry === 'object'
    ? stats.runtimeTelemetry
    : (stats.runtimeTelemetry = {});
  if (!Array.isArray(telemetry.walSnapshots)) telemetry.walSnapshots = [];
  if (!Array.isArray(telemetry.commits)) telemetry.commits = [];
  if (!Array.isArray(telemetry.checkpoints)) telemetry.checkpoints = [];
  if (!Array.isArray(telemetry.stalls)) telemetry.stalls = [];
  if (!telemetry.stallCounts || typeof telemetry.stallCounts !== 'object') {
    telemetry.stallCounts = { commit: 0, checkpoint: 0 };
  }
  return telemetry;
};

const createSqliteWriteStallSample = ({
  kind,
  stage,
  durationMs,
  thresholdMs,
  walBytes = null,
  walPressure = null
}) => ({
  kind,
  stage: stage || null,
  durationMs,
  thresholdMs,
  walBytes,
  walPressure: walPressure || null
});

const maybeRecordSqliteWriteStall = (stats, sample) => {
  if (!sample || !Number.isFinite(sample.durationMs) || !Number.isFinite(sample.thresholdMs)) return;
  if (sample.durationMs < sample.thresholdMs) return;
  const telemetry = getOrCreateSqliteRuntimeTelemetry(stats);
  if (!telemetry) return;
  const key = sample.kind === 'checkpoint' ? 'checkpoint' : 'commit';
  telemetry.stallCounts[key] = (Number(telemetry.stallCounts[key]) || 0) + 1;
  pushBoundedSample(telemetry.stalls, sample);
};

export const readSqliteFileSizes = (dbPath) => {
  const readSize = (targetPath) => {
    try {
      return Number(fs.statSync(targetPath).size) || 0;
    } catch {
      return 0;
    }
  };
  return {
    dbBytes: readSize(dbPath),
    walBytes: readSize(`${dbPath}-wal`),
    shmBytes: readSize(`${dbPath}-shm`)
  };
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
  const adjustments = [];
  if (pageSize >= 16384) {
    resolved = Math.round(resolved * 1.28);
    adjustments.push({ kind: 'page_size', factor: 1.28, reason: 'page_size_ge_16384' });
  } else if (pageSize >= 8192) {
    resolved = Math.round(resolved * 1.14);
    adjustments.push({ kind: 'page_size', factor: 1.14, reason: 'page_size_ge_8192' });
  } else if (pageSize <= 2048) {
    resolved = Math.round(resolved * 0.84);
    adjustments.push({ kind: 'page_size', factor: 0.84, reason: 'page_size_le_2048' });
  }
  const walPressure = resolveSqliteWalPressure({ walEnabled, walBytes });
  if (walEnabled) {
    if (walPressure === 'high') {
      resolved = Math.round(resolved * 0.55);
      adjustments.push({ kind: 'wal_pressure', factor: 0.55, reason: 'wal_pressure_high' });
    } else if (walPressure === 'medium') {
      resolved = Math.round(resolved * 0.72);
      adjustments.push({ kind: 'wal_pressure', factor: 0.72, reason: 'wal_pressure_medium' });
    } else if (walPressure === 'low') {
      resolved = Math.round(resolved * 0.86);
      adjustments.push({ kind: 'wal_pressure', factor: 0.86, reason: 'wal_pressure_low' });
    }
  } else if (journalMode && !['off', 'memory'].includes(journalMode)) {
    resolved = Math.round(resolved * 0.9);
    adjustments.push({ kind: 'journal_mode', factor: 0.9, reason: `journal_mode_${journalMode}` });
  }
  return {
    batchSize: clamp(resolved, SQLITE_BATCH_MIN, SQLITE_BATCH_MAX),
    walPressure,
    adjustments
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
      walPressure: resolveSqliteWalPressure(input),
      adjustments: [{ kind: 'requested', factor: 1, reason: 'requested_batch_size' }]
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
    inputBytes: input.inputBytes,
    telemetry: {
      planVersion: 1,
      baseBatchSize,
      batchAdjustments: runtimeAdjusted.adjustments || [],
      walPressure: runtimeAdjusted.walPressure,
      requestedOverride: input.requested != null
    }
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

export function recordSqlitePlanTelemetry(stats, plan, { source = null } = {}) {
  const telemetry = getOrCreateSqliteRuntimeTelemetry(stats);
  if (!telemetry || !plan || typeof plan !== 'object') return null;
  telemetry.plan = {
    batchSize: plan.batchSize ?? null,
    transactionRows: plan.transactionRows ?? null,
    batchesPerTransaction: plan.batchesPerTransaction ?? null,
    filesPerTransaction: plan.filesPerTransaction ?? null,
    rowsPerFile: plan.rowsPerFile ?? null,
    repoTier: plan.repoTier ?? null,
    walPressure: plan.walPressure ?? null,
    pageSize: plan.pageSize ?? null,
    journalMode: plan.journalMode ?? null,
    walEnabled: plan.walEnabled === true,
    walBytes: plan.walBytes ?? null,
    rowCount: plan.rowCount ?? null,
    fileCount: plan.fileCount ?? null,
    repoBytes: plan.repoBytes ?? null,
    inputBytes: plan.inputBytes ?? null,
    telemetry: plan.telemetry || null,
    source
  };
  return telemetry.plan;
}

export function recordSqliteWalSnapshot(
  stats,
  {
    stage,
    dbPath,
    pageSize = null,
    journalMode = null,
    walEnabled = null,
    walPressure = null,
    source = null,
    durationMs = null,
    checkpointMode = null
  } = {}
) {
  const telemetry = getOrCreateSqliteRuntimeTelemetry(stats);
  if (!telemetry || !dbPath) return null;
  const sizes = readSqliteFileSizes(dbPath);
  const snapshot = {
    stage: stage || null,
    source,
    pageSize,
    journalMode,
    walEnabled,
    walPressure,
    dbBytes: sizes.dbBytes,
    walBytes: sizes.walBytes,
    shmBytes: sizes.shmBytes,
    durationMs,
    checkpointMode
  };
  pushBoundedSample(telemetry.walSnapshots, snapshot);
  return snapshot;
}

export function recordSqliteCommitTelemetry(
  stats,
  {
    stage,
    durationMs,
    dbPath = null,
    pageSize = null,
    journalMode = null,
    walEnabled = null,
    walPressure = null,
    source = null
  } = {}
) {
  const telemetry = getOrCreateSqliteRuntimeTelemetry(stats);
  if (!telemetry || !Number.isFinite(durationMs)) return null;
  const sizes = dbPath ? readSqliteFileSizes(dbPath) : { dbBytes: 0, walBytes: 0, shmBytes: 0 };
  const sample = {
    stage: stage || null,
    source,
    durationMs,
    pageSize,
    journalMode,
    walEnabled,
    walPressure,
    dbBytes: sizes.dbBytes,
    walBytes: sizes.walBytes,
    shmBytes: sizes.shmBytes
  };
  pushBoundedSample(telemetry.commits, sample);
  maybeRecordSqliteWriteStall(stats, createSqliteWriteStallSample({
    kind: 'commit',
    stage,
    durationMs,
    thresholdMs: SQLITE_COMMIT_STALL_MS,
    walBytes: sizes.walBytes,
    walPressure
  }));
  return sample;
}

export function checkpointSqliteWithTelemetry(
  db,
  {
    stats,
    dbPath,
    stage,
    pageSize = null,
    journalMode = null,
    walEnabled = null,
    walPressure = null,
    source = null,
    mode = 'TRUNCATE'
  } = {}
) {
  if (!db) return null;
  const start = performance.now();
  const before = dbPath ? readSqliteFileSizes(dbPath) : { dbBytes: 0, walBytes: 0, shmBytes: 0 };
  const result = db.pragma(`wal_checkpoint(${mode})`);
  const durationMs = performance.now() - start;
  const after = dbPath ? readSqliteFileSizes(dbPath) : { dbBytes: 0, walBytes: 0, shmBytes: 0 };
  const telemetry = getOrCreateSqliteRuntimeTelemetry(stats);
  if (!telemetry) return result;
  const sample = {
    stage: stage || null,
    source,
    mode,
    durationMs,
    pageSize,
    journalMode,
    walEnabled,
    walPressure,
    before,
    after
  };
  pushBoundedSample(telemetry.checkpoints, sample);
  maybeRecordSqliteWriteStall(stats, createSqliteWriteStallSample({
    kind: 'checkpoint',
    stage,
    durationMs,
    thresholdMs: SQLITE_CHECKPOINT_STALL_MS,
    walBytes: after.walBytes,
    walPressure
  }));
  recordSqliteWalSnapshot(stats, {
    stage: stage ? `${stage}:after-checkpoint` : 'after-checkpoint',
    dbPath,
    pageSize,
    journalMode,
    walEnabled,
    walPressure,
    source,
    durationMs,
    checkpointMode: mode
  });
  return result;
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
 * Record per-table sqlite write telemetry when a stats object is active.
 * @param {object|null} tableStats
 * @param {string} name
 * @param {number} rows
 * @param {number} durationMs
 */
export function recordSqliteTableStat(tableStats, name, rows, durationMs) {
  if (!tableStats || !name) return;
  const entry = tableStats[name] || { rows: 0, durationMs: 0, rowsPerSec: null };
  entry.rows += rows;
  entry.durationMs += durationMs;
  entry.rowsPerSec = entry.durationMs > 0
    ? Math.round((entry.rows / entry.durationMs) * 1000)
    : null;
  tableStats[name] = entry;
}

/**
 * Create a no-op-safe table telemetry recorder bound to a sqlite stats object.
 * @param {object|null} stats
 * @returns {(name:string, rows:number, durationMs:number) => void}
 */
export function createSqliteTableStatRecorder(stats) {
  const tableStats = stats && typeof stats === 'object'
    ? (stats.tables || (stats.tables = {}))
    : null;
  return (name, rows, durationMs) => recordSqliteTableStat(tableStats, name, rows, durationMs);
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
export async function removeSqliteSidecars(basePath, { swallowNonBenign = false, logger = null } = {}) {
  await Promise.all(SQLITE_SIDECARS.map(async (suffix) => {
    try {
      const targetPath = `${basePath}${suffix}`;
      if (fs.existsSync(targetPath)) {
        logLine(`[sqlite-cleanup] remove ${targetPath}`, { kind: 'status' });
      }
      await fsPromises.rm(targetPath, { force: true });
    } catch (err) {
      if (isBenignSqliteCleanupError(err)) return;
      emitSqliteCleanupWarning(
        logger,
        `[sqlite-cleanup] failed to remove sidecar ${basePath}${suffix}: ${err?.message || err}`
      );
      if (swallowNonBenign) return;
      throw err;
    }
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
  const removeFileWithDiagnostics = async (targetPath, { context, swallow = true } = {}) => {
    try {
      await fsPromises.rm(targetPath, { force: true });
      return true;
    } catch (err) {
      if (isBenignSqliteCleanupError(err)) return false;
      emitSqliteCleanupWarning(
        options.logger,
        `[sqlite-cleanup] failed to remove ${context || 'path'} ${targetPath}: ${err?.message || err}`
      );
      if (!swallow) throw err;
      return false;
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

  await removeSqliteSidecars(tempDbPath, { logger: options.logger || null });
  await removeSqliteSidecars(finalDbPath, { logger: options.logger || null });

  let backupAvailable = fs.existsSync(backupPath);
  let backupFromCurrentFinal = false;
  if (finalExists) {
    if (backupAvailable) {
      await removeFileWithDiagnostics(backupPath, {
        context: 'existing backup',
        swallow: false
      });
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
      await removeFileWithDiagnostics(finalDbPath, {
        context: 'existing final db',
        swallow: false
      });
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
    await removeFileWithDiagnostics(backupPath, {
      context: 'final backup cleanup',
      swallow: true
    });
  }
  await removeSqliteSidecars(finalDbPath, {
    logger: options.logger || null,
    swallowNonBenign: true
  });
  await removeSqliteSidecars(backupPath, {
    logger: options.logger || null,
    swallowNonBenign: true
  });
}

import { performance } from 'node:perf_hooks';

const BYTES_PER_MB = 1024 * 1024;
const SQLITE_MMAP_TARGET_MB = 8 * 1024;
const ANALYZE_THRESHOLD_BYTES = 128 * BYTES_PER_MB;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const readPragma = (db, pragma) => {
  try {
    return db.pragma(pragma, { simple: true });
  } catch {
    return null;
  }
};

const applyPragma = (db, pragma, label) => {
  try {
    db.pragma(pragma);
  } catch (err) {
    const suffix = label ? ` (${label})` : '';
    console.warn(`[sqlite] Failed to apply pragma${suffix}: ${err?.message || err}`);
  }
};

const resolveBuildPragmas = (options = {}) => {
  const inputBytes = Number(options.inputBytes);
  const inputMb = Number.isFinite(inputBytes) && inputBytes > 0
    ? inputBytes / BYTES_PER_MB
    : null;
  const cacheMb = inputMb === null
    ? 200
    : clamp(Math.round(inputMb * 0.1), 64, 512);
  const mmapMb = SQLITE_MMAP_TARGET_MB;
  const journalLimitBytes = inputMb === null
    ? 64 * BYTES_PER_MB
    : clamp(Math.round(inputBytes * 0.05), 32 * BYTES_PER_MB, 256 * BYTES_PER_MB);
  return {
    journal_mode: 'WAL',
    synchronous: 'OFF',
    temp_store: 'MEMORY',
    cache_size: -cacheMb * 1024,
    mmap_size: mmapMb * BYTES_PER_MB,
    journal_size_limit: journalLimitBytes
  };
};

const resolveReadPragmas = (options = {}) => {
  const dbBytes = Number(options.dbBytes);
  const dbMb = Number.isFinite(dbBytes) && dbBytes > 0
    ? dbBytes / BYTES_PER_MB
    : null;
  const cacheMb = dbMb === null
    ? 64
    : clamp(Math.round(dbMb * 0.1), 32, 256);
  const mmapMb = SQLITE_MMAP_TARGET_MB;
  return {
    temp_store: 'MEMORY',
    cache_size: -cacheMb * 1024,
    mmap_size: mmapMb * BYTES_PER_MB,
    busy_timeout: 5000
  };
};

export const applyBuildPragmas = (db, options = {}) => {
  const before = {
    journal_mode: readPragma(db, 'journal_mode'),
    synchronous: readPragma(db, 'synchronous'),
    temp_store: readPragma(db, 'temp_store'),
    cache_size: readPragma(db, 'cache_size'),
    mmap_size: readPragma(db, 'mmap_size'),
    wal_autocheckpoint: readPragma(db, 'wal_autocheckpoint'),
    journal_size_limit: readPragma(db, 'journal_size_limit'),
    locking_mode: readPragma(db, 'locking_mode'),
    page_size: readPragma(db, 'page_size')
  };
  const resolved = resolveBuildPragmas(options);
  const pageSize = Number.isFinite(before.page_size) && before.page_size > 0 ? before.page_size : 4096;
  const walAutocheckpoint = Math.max(100, Math.round(resolved.journal_size_limit / pageSize));

  applyPragma(db, `journal_mode = ${resolved.journal_mode}`, 'journal_mode');
  applyPragma(db, `synchronous = ${resolved.synchronous}`, 'synchronous');
  applyPragma(db, `temp_store = ${resolved.temp_store}`, 'temp_store');
  applyPragma(db, `cache_size = ${resolved.cache_size}`, 'cache_size');
  applyPragma(db, `mmap_size = ${resolved.mmap_size}`, 'mmap_size');
  applyPragma(db, `journal_size_limit = ${resolved.journal_size_limit}`, 'journal_size_limit');
  applyPragma(db, `wal_autocheckpoint = ${walAutocheckpoint}`, 'wal_autocheckpoint');
  applyPragma(db, 'locking_mode = EXCLUSIVE', 'locking_mode');

  const applied = {
    journal_mode: readPragma(db, 'journal_mode') ?? resolved.journal_mode,
    synchronous: readPragma(db, 'synchronous') ?? resolved.synchronous,
    temp_store: readPragma(db, 'temp_store') ?? resolved.temp_store,
    cache_size: readPragma(db, 'cache_size') ?? resolved.cache_size,
    mmap_size: readPragma(db, 'mmap_size') ?? resolved.mmap_size,
    journal_size_limit: readPragma(db, 'journal_size_limit') ?? resolved.journal_size_limit,
    wal_autocheckpoint: readPragma(db, 'wal_autocheckpoint') ?? walAutocheckpoint,
    locking_mode: readPragma(db, 'locking_mode') ?? 'EXCLUSIVE'
  };

  if (options.stats && typeof options.stats === 'object') {
    options.stats.pragmas = applied;
  }

  return {
    before,
    applied
  };
};

export const applyReadPragmas = (db, options = {}) => {
  if (!db) return null;
  const resolved = resolveReadPragmas(options);
  applyPragma(db, `temp_store = ${resolved.temp_store}`, 'temp_store');
  applyPragma(db, `cache_size = ${resolved.cache_size}`, 'cache_size');
  applyPragma(db, `mmap_size = ${resolved.mmap_size}`, 'mmap_size');
  applyPragma(db, `busy_timeout = ${resolved.busy_timeout}`, 'busy_timeout');
  return {
    temp_store: readPragma(db, 'temp_store') ?? resolved.temp_store,
    cache_size: readPragma(db, 'cache_size') ?? resolved.cache_size,
    mmap_size: readPragma(db, 'mmap_size') ?? resolved.mmap_size,
    busy_timeout: readPragma(db, 'busy_timeout') ?? resolved.busy_timeout
  };
};

export const restoreBuildPragmas = (db, state = null) => {
  const before = state && typeof state === 'object' ? state.before : null;
  const restoreValue = (key, fallback) => {
    if (before && before[key] !== null && before[key] !== undefined) {
      return before[key];
    }
    return fallback;
  };
  const applyIfValue = (label, value) => {
    if (value === null || value === undefined) return;
    applyPragma(db, `${label} = ${value}`, label);
  };

  applyIfValue('journal_mode', restoreValue('journal_mode', null));
  applyIfValue('synchronous', restoreValue('synchronous', 'NORMAL'));
  applyIfValue('temp_store', restoreValue('temp_store', 'DEFAULT'));
  applyIfValue('cache_size', restoreValue('cache_size', null));
  applyIfValue('mmap_size', restoreValue('mmap_size', null));
  applyIfValue('wal_autocheckpoint', restoreValue('wal_autocheckpoint', null));
  applyIfValue('journal_size_limit', restoreValue('journal_size_limit', null));
  applyIfValue('page_size', restoreValue('page_size', null));
  applyIfValue('locking_mode', restoreValue('locking_mode', 'NORMAL'));
};

export const optimizeBuildDatabase = (db, options = {}) => {
  if (!db) return;
  const stats = options.stats && typeof options.stats === 'object' ? options.stats : null;
  const inputBytes = Number(options.inputBytes);
  const shouldAnalyze = Number.isFinite(inputBytes) && inputBytes >= ANALYZE_THRESHOLD_BYTES;
  const start = performance.now();
  let optimized = false;
  let analyzed = false;
  try {
    db.pragma('optimize');
    optimized = true;
  } catch {}
  if (shouldAnalyze) {
    try {
      db.exec('ANALYZE');
      analyzed = true;
    } catch {}
  }
  if (stats) {
    stats.optimize = {
      optimized,
      analyzed,
      durationMs: performance.now() - start
    };
  }
};

export const optimizeFtsTable = (db, tableName, options = {}) => {
  if (!db) return;
  const target = typeof tableName === 'string' ? tableName.trim() : '';
  if (!target) return;
  // Avoid SQL injection. Stage4 only optimizes known internal tables.
  if (target !== 'chunks_fts') {
    throw new Error(`[sqlite] Unsupported FTS optimize target: ${target}`);
  }
  const stats = options.stats && typeof options.stats === 'object' ? options.stats : null;
  const start = performance.now();
  let optimized = false;
  let error = null;
  try {
    db.exec(`INSERT INTO ${target}(${target}) VALUES('optimize')`);
    optimized = true;
  } catch (err) {
    error = err;
  }
  if (stats) {
    stats.ftsOptimize = {
      table: target,
      optimized,
      durationMs: performance.now() - start,
      error: error ? (error?.message || String(error)) : null
    };
  }
  if (error) {
    console.warn(`[sqlite] FTS optimize failed (${target}): ${error?.message || error}`);
  }
};

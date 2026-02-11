import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../schema.js';
import { removeSqliteSidecars, resolveSqliteBatchSize, bumpSqliteBatchStat } from '../utils.js';
import { applyBuildPragmas, optimizeBuildDatabase, optimizeFtsTable, restoreBuildPragmas } from './pragmas.js';
import { validateSqliteDatabase } from './validate.js';
import { createInsertStatements } from './statements.js';
import { createMultiRowInserter } from './multi-row.js';
import { createTempPath, replaceFile } from '../../../shared/json-stream/atomic.js';

const normalizeStatementStrategy = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['prepared', 'multi-row', 'prepare-per-shard'].includes(normalized)
    ? normalized
    : 'multi-row';
};

const SQLITE_DB_PATH_SOFT_LIMIT = 240;
const LONG_PATH_PREFIX = '\\\\?\\';

const stripLongPathPrefix = (value) => (
  typeof value === 'string' && value.startsWith(LONG_PATH_PREFIX)
    ? value.slice(LONG_PATH_PREFIX.length)
    : value
);

const toComparablePath = (value) => path.resolve(stripLongPathPrefix(value));

const buildShortTempDbPath = (outPath) => {
  const hash = crypto.createHash('sha1').update(String(outPath || '')).digest('hex').slice(0, 20);
  const nonce = crypto.randomBytes(4).toString('hex');
  return path.join(os.tmpdir(), 'pairofcleats-sqlite', `${hash}-${process.pid}-${nonce}.db`);
};

const isSqliteCantOpen = (err) => (
  err?.code === 'SQLITE_CANTOPEN'
  || /unable to open database file/i.test(String(err?.message || ''))
);

const openDatabaseWithFallback = (Database, outPath) => {
  const resolvedOutPath = path.resolve(outPath);
  const candidates = [];
  const addCandidate = (openPath, dbPath = openPath, promotePath = null) => {
    if (!openPath) return;
    candidates.push({ openPath, dbPath, promotePath });
  };
  if (process.platform === 'win32') {
    addCandidate(resolvedOutPath, resolvedOutPath, null);
    if (!resolvedOutPath.startsWith(LONG_PATH_PREFIX)) {
      addCandidate(`${LONG_PATH_PREFIX}${resolvedOutPath}`, resolvedOutPath, null);
    }
    const needsCompactPath = resolvedOutPath.length > SQLITE_DB_PATH_SOFT_LIMIT;
    if (needsCompactPath) {
      const compactPath = createTempPath(resolvedOutPath);
      if (compactPath && toComparablePath(compactPath) !== toComparablePath(resolvedOutPath)) {
        addCandidate(compactPath, compactPath, resolvedOutPath);
        addCandidate(`${LONG_PATH_PREFIX}${compactPath}`, compactPath, resolvedOutPath);
      }
    }
    const shortTempPath = buildShortTempDbPath(resolvedOutPath);
    if (shortTempPath && toComparablePath(shortTempPath) !== toComparablePath(resolvedOutPath)) {
      addCandidate(shortTempPath, shortTempPath, resolvedOutPath);
    }
  } else {
    addCandidate(resolvedOutPath, resolvedOutPath, null);
  }
  let lastError = null;
  for (const candidate of candidates) {
    const maxAttempts = candidate.promotePath ? 4 : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const resolvedCandidate = attempt === 0
        ? candidate
        : (candidate.promotePath
          ? (() => {
            const retryTemp = buildShortTempDbPath(resolvedOutPath);
            return {
              openPath: retryTemp,
              dbPath: retryTemp,
              promotePath: candidate.promotePath
            };
          })()
          : candidate);
      try {
        fsSync.mkdirSync(path.dirname(resolvedCandidate.dbPath || resolvedCandidate.openPath), { recursive: true });
        const db = new Database(resolvedCandidate.openPath);
        return {
          db,
          dbPath: resolvedCandidate.dbPath,
          promotePath: resolvedCandidate.promotePath
        };
      } catch (err) {
        lastError = err;
        if (!isSqliteCantOpen(err) || attempt >= maxAttempts - 1) break;
      }
    }
  }
  throw lastError || new Error(`Unable to open sqlite database: ${outPath}`);
};

/**
 * Build shared execution metadata and counters for sqlite artifact ingestion.
 * @param {{batchSize?:number,inputBytes?:number,statementStrategy?:string,stats?:object}} input
 * @returns {{resolvedBatchSize:number,batchStats:object|null,resolvedStatementStrategy:string,recordBatch:function,recordTable:function}}
 */
export const createBuildExecutionContext = ({ batchSize, inputBytes, statementStrategy, stats }) => {
  const resolvedBatchSize = resolveSqliteBatchSize({ batchSize, inputBytes });
  const batchStats = stats && typeof stats === 'object' ? stats : null;
  const resolvedStatementStrategy = normalizeStatementStrategy(statementStrategy);
  if (batchStats) {
    batchStats.batchSize = resolvedBatchSize;
    batchStats.statementStrategy = resolvedStatementStrategy;
  }
  const tableStats = batchStats
    ? (batchStats.tables || (batchStats.tables = {}))
    : null;
  const recordBatch = (key) => bumpSqliteBatchStat(batchStats, key);
  const recordTable = (name, rows, durationMs) => {
    if (!tableStats || !name) return;
    const entry = tableStats[name] || { rows: 0, durationMs: 0, rowsPerSec: null };
    entry.rows += rows;
    entry.durationMs += durationMs;
    entry.rowsPerSec = entry.durationMs > 0
      ? Math.round((entry.rows / entry.durationMs) * 1000)
      : null;
    tableStats[name] = entry;
  };
  return {
    resolvedBatchSize,
    batchStats,
    resolvedStatementStrategy,
    recordBatch,
    recordTable
  };
};

/**
 * Open and initialize the sqlite build database with tuned pragmas.
 * @param {{Database:any,outPath:string,batchStats?:object,inputBytes?:number,useBuildPragmas?:boolean}} input
 * @returns {{db:any,pragmaState:object|null,dbPath:string,promotePath:string|null}}
 */
export const openSqliteBuildDatabase = ({
  Database,
  outPath,
  batchStats,
  inputBytes,
  useBuildPragmas = true
}) => {
  fsSync.mkdirSync(path.dirname(outPath), { recursive: true });
  const { db, dbPath, promotePath } = openDatabaseWithFallback(Database, outPath);
  if (batchStats) {
    const prepareStats = batchStats.prepare || (batchStats.prepare = {});
    if (!Number.isFinite(prepareStats.total)) prepareStats.total = 0;
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      prepareStats.total += 1;
      return originalPrepare(sql);
    };
    const txStats = batchStats.transaction || (batchStats.transaction = {});
    if (!Number.isFinite(txStats.begin)) txStats.begin = 0;
    if (!Number.isFinite(txStats.commit)) txStats.commit = 0;
    if (!Number.isFinite(txStats.rollback)) txStats.rollback = 0;
    const resolvedInputBytes = Number(inputBytes);
    batchStats.inputBytes = Number.isFinite(resolvedInputBytes) && resolvedInputBytes > 0
      ? resolvedInputBytes
      : 0;
  }
  const pragmaState = useBuildPragmas
    ? applyBuildPragmas(db, { inputBytes, stats: batchStats })
    : null;
  db.exec(CREATE_TABLES_BASE_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return { db, pragmaState, dbPath, promotePath };
};

const createOptionalMultiRowInserter = (db, enabled, options) => (
  enabled ? createMultiRowInserter(db, options) : null
);

/**
 * Create prepared/multi-row inserters for all sqlite output tables.
 * @param {any} db
 * @param {{batchStats?:object,resolvedStatementStrategy?:string}} input
 * @returns {object}
 */
export const createSqliteBuildInsertContext = (db, { batchStats, resolvedStatementStrategy }) => {
  const statements = createInsertStatements(db, { updateMode: 'full', stats: batchStats });
  const insertClause = statements.insertClause || batchStats?.insertStatements?.insertClause || 'INSERT';
  const tokenPostingsConflictClause = insertClause === 'INSERT'
    ? 'ON CONFLICT(mode, token_id, doc_id) DO UPDATE SET tf = token_postings.tf + excluded.tf'
    : '';
  const useMultiRow = resolvedStatementStrategy === 'multi-row';
  return {
    ...statements,
    insertClause,
    useMultiRow,
    insertTokenVocabMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'token_vocab',
      columns: ['mode', 'token_id', 'token'],
      insertClause,
      maxRows: 300,
      stats: batchStats
    }),
    insertTokenPostingMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'token_postings',
      columns: ['mode', 'token_id', 'doc_id', 'tf'],
      insertClause,
      conflictClause: tokenPostingsConflictClause,
      dedupeKeyIndices: [0, 1, 2],
      dedupeSumIndex: 3,
      maxRows: 200,
      stats: batchStats
    }),
    insertDocLengthMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'doc_lengths',
      columns: ['mode', 'doc_id', 'len'],
      insertClause,
      maxRows: 300,
      stats: batchStats
    }),
    insertPhraseVocabMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'phrase_vocab',
      columns: ['mode', 'phrase_id', 'ngram'],
      insertClause,
      maxRows: 300,
      stats: batchStats
    }),
    insertPhrasePostingMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'phrase_postings',
      columns: ['mode', 'phrase_id', 'doc_id'],
      insertClause,
      maxRows: 300,
      stats: batchStats
    }),
    insertChargramVocabMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'chargram_vocab',
      columns: ['mode', 'gram_id', 'gram'],
      insertClause,
      maxRows: 300,
      stats: batchStats
    }),
    insertChargramPostingMany: createOptionalMultiRowInserter(db, useMultiRow, {
      table: 'chargram_postings',
      columns: ['mode', 'gram_id', 'doc_id'],
      insertClause,
      maxRows: 300,
      stats: batchStats
    })
  };
};

/**
 * Begin a tracked sqlite transaction.
 * @param {any} db
 * @param {object} [batchStats]
 * @returns {void}
 */
export const beginSqliteBuildTransaction = (db, batchStats) => {
  db.exec('BEGIN');
  if (batchStats?.transaction) batchStats.transaction.begin += 1;
};

/**
 * Commit a tracked sqlite transaction.
 * @param {any} db
 * @param {object} [batchStats]
 * @returns {void}
 */
export const commitSqliteBuildTransaction = (db, batchStats) => {
  db.exec('COMMIT');
  if (batchStats?.transaction) batchStats.transaction.commit += 1;
};

/**
 * Roll back a tracked sqlite transaction when active.
 * @param {any} db
 * @param {object} [batchStats]
 * @returns {void}
 */
export const rollbackSqliteBuildTransaction = (db, batchStats) => {
  if (!db?.inTransaction) return;
  try {
    db.exec('ROLLBACK');
    if (batchStats?.transaction) batchStats.transaction.rollback += 1;
  } catch {}
};

/**
 * Run optimize/validate/checkpoint steps after write transaction completion.
 * @param {object} input
 * @returns {void}
 */
export const runSqliteBuildPostCommit = ({
  db,
  mode,
  validateMode,
  expected,
  emitOutput,
  logger,
  dbPath,
  vectorAnnTable,
  useOptimize,
  inputBytes,
  batchStats
}) => {
  if (useOptimize) {
    optimizeFtsTable(db, 'chunks_fts', { stats: batchStats });
    optimizeBuildDatabase(db, { inputBytes, stats: batchStats });
  }
  const validationStart = performance.now();
  validateSqliteDatabase(db, mode, {
    validateMode,
    expected,
    emitOutput,
    logger,
    dbPath,
    vectorAnnTable
  });
  if (batchStats) {
    batchStats.validationMs = performance.now() - validationStart;
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
};

/**
 * Close sqlite build db and clean sidecars when build fails.
 * @param {{db:any,succeeded:boolean,pragmaState?:object|null,outPath:string,dbPath?:string,promotePath?:string|null,warn?:(err:Error)=>void}} input
 * @returns {Promise<void>}
 */
export const closeSqliteBuildDatabase = async ({
  db,
  succeeded,
  pragmaState,
  outPath,
  dbPath = outPath,
  promotePath = null,
  warn
}) => {
  const resolvedOutPath = toComparablePath(outPath);
  const resolvedDbPath = toComparablePath(dbPath);
  const resolvedPromotePath = promotePath ? toComparablePath(promotePath) : null;
  const needsPromote = Boolean(
    succeeded
    && resolvedPromotePath
    && resolvedDbPath !== resolvedPromotePath
  );
  if (succeeded) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      if (typeof warn === 'function') {
        warn(err);
      }
    }
  }
  if (pragmaState) {
    restoreBuildPragmas(db, pragmaState);
  }
  db.close();
  if (needsPromote) {
    try {
      await removeSqliteSidecars(outPath);
      await replaceFile(dbPath, outPath);
    } catch (err) {
      if (typeof warn === 'function') {
        warn(err);
      }
      throw err;
    } finally {
      await removeSqliteSidecars(dbPath);
    }
  }
  if (!succeeded) {
    try {
      fsSync.rmSync(outPath, { force: true });
    } catch {}
    if (resolvedDbPath !== resolvedOutPath) {
      try {
        fsSync.rmSync(dbPath, { force: true });
      } catch {}
    }
    await removeSqliteSidecars(outPath);
    if (resolvedDbPath !== resolvedOutPath) {
      await removeSqliteSidecars(dbPath);
    }
  }
};

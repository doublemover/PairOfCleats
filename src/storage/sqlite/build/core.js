import fsSync from 'node:fs';
import { performance } from 'node:perf_hooks';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../schema.js';
import { removeSqliteSidecars, resolveSqliteBatchSize, bumpSqliteBatchStat } from '../utils.js';
import { applyBuildPragmas, optimizeBuildDatabase, optimizeFtsTable, restoreBuildPragmas } from './pragmas.js';
import { validateSqliteDatabase } from './validate.js';
import { createInsertStatements } from './statements.js';
import { createMultiRowInserter } from './multi-row.js';

const normalizeStatementStrategy = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['prepared', 'multi-row', 'prepare-per-shard'].includes(normalized)
    ? normalized
    : 'multi-row';
};

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

export const openSqliteBuildDatabase = ({
  Database,
  outPath,
  batchStats,
  inputBytes,
  useBuildPragmas = true
}) => {
  const db = new Database(outPath);
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
  return { db, pragmaState };
};

const createOptionalMultiRowInserter = (db, enabled, options) => (
  enabled ? createMultiRowInserter(db, options) : null
);

export const createSqliteBuildInsertContext = (db, { batchStats, resolvedStatementStrategy }) => {
  const statements = createInsertStatements(db, { updateMode: 'full', stats: batchStats });
  const insertClause = batchStats?.insertStatements?.insertClause || 'INSERT OR REPLACE';
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

export const beginSqliteBuildTransaction = (db, batchStats) => {
  db.exec('BEGIN');
  if (batchStats?.transaction) batchStats.transaction.begin += 1;
};

export const commitSqliteBuildTransaction = (db, batchStats) => {
  db.exec('COMMIT');
  if (batchStats?.transaction) batchStats.transaction.commit += 1;
};

export const rollbackSqliteBuildTransaction = (db, batchStats) => {
  if (!db?.inTransaction) return;
  try {
    db.exec('ROLLBACK');
    if (batchStats?.transaction) batchStats.transaction.rollback += 1;
  } catch {}
};

export const runSqliteBuildPostCommit = ({
  db,
  mode,
  validateMode,
  expected,
  emitOutput,
  logger,
  dbPath,
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
    dbPath
  });
  if (batchStats) {
    batchStats.validationMs = performance.now() - validationStart;
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
};

export const closeSqliteBuildDatabase = async ({
  db,
  succeeded,
  pragmaState,
  outPath,
  warn
}) => {
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
  if (!succeeded) {
    try {
      fsSync.rmSync(outPath, { force: true });
    } catch {}
    await removeSqliteSidecars(outPath);
  }
};

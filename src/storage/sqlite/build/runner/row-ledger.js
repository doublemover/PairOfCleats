import {
  readSqliteDenseModeCount,
  readSqliteModeCount,
  readSqliteTableCount
} from './sqlite-probes.js';

const normalizeCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const hasPartialDenseCoverage = (embedStats) => Boolean(
  Number(embedStats?.filesMissingEmbeddings || 0) > 0
  || Number(embedStats?.filesPartiallyMissingEmbeddings || 0) > 0
  || Number(embedStats?.missingChunks || 0) > 0
  || (
    Number.isFinite(Number(embedStats?.denseChunks))
    && Number.isFinite(Number(embedStats?.totalChunks))
    && Number(embedStats.totalChunks) > 0
    && Number(embedStats.denseChunks) !== Number(embedStats.totalChunks)
  )
  || (
    Number.isFinite(Number(embedStats?.filesWithChunks))
    && Number.isFinite(Number(embedStats?.filesWithEmbeddings))
    && Number(embedStats.filesWithChunks) > Number(embedStats.filesWithEmbeddings)
  )
);

export const SQLITE_ROW_LEDGER_FAILURE = Object.freeze({
  inputInvalid: 'input_invalid',
  rowCountMismatch: 'row_count_mismatch',
  denseCoverageMismatch: 'dense_coverage_mismatch',
  denseCountMismatch: 'dense_count_mismatch',
  postImportValidationMismatch: 'post_import_validation_mismatch'
});

export const createSqliteModeRowLedger = ({
  mode,
  source,
  expectedChunkCount = 0,
  expectedDenseCount = 0,
  expectedFileCount = 0,
  inputRoot = null
} = {}) => ({
  schemaVersion: 1,
  mode: typeof mode === 'string' ? mode : 'unknown',
  source: typeof source === 'string' ? source : 'artifacts',
  inputRoot: typeof inputRoot === 'string' && inputRoot ? inputRoot : null,
  expected: {
    chunks: normalizeCount(expectedChunkCount),
    dense: normalizeCount(expectedDenseCount),
    files: normalizeCount(expectedFileCount)
  }
});

export const resolveSqliteRowLedgerFailureCode = (failureClass, phase = 'build') => {
  switch (failureClass) {
    case SQLITE_ROW_LEDGER_FAILURE.inputInvalid:
      return phase === 'pre-import'
        ? 'ERR_SQLITE_PREIMPORT_INPUT_INVALID'
        : 'ERR_SQLITE_POSTIMPORT_INPUT_INVALID';
    case SQLITE_ROW_LEDGER_FAILURE.rowCountMismatch:
      return phase === 'pre-import'
        ? 'ERR_SQLITE_PREIMPORT_ROW_COUNT_MISMATCH'
        : 'ERR_SQLITE_POSTIMPORT_ROW_COUNT_MISMATCH';
    case SQLITE_ROW_LEDGER_FAILURE.denseCoverageMismatch:
      return phase === 'pre-import'
        ? 'ERR_SQLITE_PREIMPORT_DENSE_COVERAGE_MISMATCH'
        : 'ERR_SQLITE_POSTIMPORT_DENSE_COVERAGE_MISMATCH';
    case SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch:
      return phase === 'pre-import'
        ? 'ERR_SQLITE_PREIMPORT_DENSE_COUNT_MISMATCH'
        : 'ERR_SQLITE_POSTIMPORT_DENSE_COUNT_MISMATCH';
    case SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch:
      return 'ERR_SQLITE_POSTIMPORT_VALIDATION_MISMATCH';
    default:
      return 'ERR_SQLITE_ROW_LEDGER_MISMATCH';
  }
};

export const validateSqliteRowLedgerPreImport = ({
  rowLedger,
  bundleResult,
  denseArtifactsRequired = false
} = {}) => {
  const ledger = rowLedger && typeof rowLedger === 'object'
    ? rowLedger
    : createSqliteModeRowLedger();
  const expectedChunks = normalizeCount(ledger?.expected?.chunks);
  const expectedDense = normalizeCount(ledger?.expected?.dense);
  const observedChunks = normalizeCount(bundleResult?.count);
  const observedDense = normalizeCount(bundleResult?.denseCount);
  const embedStats = bundleResult?.embedStats || null;
  const explicitReason = typeof bundleResult?.reason === 'string'
    ? bundleResult.reason.trim()
    : '';

  if (explicitReason) {
    return {
      ok: false,
      phase: 'pre-import',
      failureClass: SQLITE_ROW_LEDGER_FAILURE.inputInvalid,
      code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.inputInvalid, 'pre-import'),
      message: explicitReason,
      rowLedger: ledger,
      observed: {
        chunks: observedChunks,
        dense: observedDense
      },
      embedStats
    };
  }

  if (observedChunks !== expectedChunks) {
    return {
      ok: false,
      phase: 'pre-import',
      failureClass: SQLITE_ROW_LEDGER_FAILURE.rowCountMismatch,
      code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.rowCountMismatch, 'pre-import'),
      message: `bundle row count mismatch (${observedChunks} !== ${expectedChunks})`,
      rowLedger: ledger,
      observed: {
        chunks: observedChunks,
        dense: observedDense
      }
    };
  }

  if (denseArtifactsRequired && expectedDense > 0) {
    if (observedDense === 0 || hasPartialDenseCoverage(embedStats)) {
      return {
        ok: false,
        phase: 'pre-import',
        failureClass: SQLITE_ROW_LEDGER_FAILURE.denseCoverageMismatch,
        code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.denseCoverageMismatch, 'pre-import'),
        message: 'bundles missing embeddings',
        rowLedger: ledger,
        observed: {
          chunks: observedChunks,
          dense: observedDense
        },
        embedStats
      };
    }
    if (observedDense !== expectedDense) {
      return {
        ok: false,
        phase: 'pre-import',
        failureClass: SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch,
        code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch, 'pre-import'),
        message: `bundle dense count mismatch (${observedDense} !== ${expectedDense})`,
        rowLedger: ledger,
        observed: {
          chunks: observedChunks,
          dense: observedDense
        },
        embedStats
      };
    }
  }

  return {
    ok: true,
    phase: 'pre-import',
    rowLedger: ledger,
    observed: {
      chunks: observedChunks,
      dense: observedDense
    },
    embedStats
  };
};

export const validateSqliteRowLedgerPostImport = ({
  rowLedger,
  Database,
  dbPath,
  annTable = 'dense_vectors_ann',
  probe = {}
} = {}) => {
  const ledger = rowLedger && typeof rowLedger === 'object'
    ? rowLedger
    : createSqliteModeRowLedger();
  const mode = ledger.mode;
  const readModeCount = typeof probe.readModeCount === 'function'
    ? probe.readModeCount
    : (input) => readSqliteModeCount(input);
  const readDenseCount = typeof probe.readDenseCount === 'function'
    ? probe.readDenseCount
    : (input) => readSqliteDenseModeCount(input);
  const readTableCount = typeof probe.readTableCount === 'function'
    ? probe.readTableCount
    : (input) => readSqliteTableCount(input);

  const observedChunks = normalizeCount(readModeCount({
    Database,
    dbPath,
    mode
  }));
  const observedDense = normalizeCount(readDenseCount({
    Database,
    dbPath,
    mode
  }));
  const observedAnn = normalizeCount(readTableCount({
    Database,
    dbPath,
    tableName: annTable
  }));
  const expectedChunks = normalizeCount(ledger?.expected?.chunks);
  const expectedDense = normalizeCount(ledger?.expected?.dense);

  if (observedChunks !== expectedChunks) {
    return {
      ok: false,
      phase: 'post-import',
      failureClass: SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch,
      code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.rowCountMismatch, 'post-import'),
      message: `post-import chunk count mismatch (${observedChunks} !== ${expectedChunks})`,
      rowLedger: ledger,
      observed: {
        chunks: observedChunks,
        dense: observedDense,
        ann: observedAnn
      }
    };
  }
  if (expectedDense > 0 && observedDense !== expectedDense) {
    return {
      ok: false,
      phase: 'post-import',
      failureClass: SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch,
      code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch, 'post-import'),
      message: `post-import dense count mismatch (${observedDense} !== ${expectedDense})`,
      rowLedger: ledger,
      observed: {
        chunks: observedChunks,
        dense: observedDense,
        ann: observedAnn
      }
    };
  }
  if (observedAnn > 0 && observedDense !== observedAnn) {
    return {
      ok: false,
      phase: 'post-import',
      failureClass: SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch,
      code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch, 'post-import'),
      message: `post-import ANN count mismatch (${observedAnn} !== ${observedDense})`,
      rowLedger: ledger,
      observed: {
        chunks: observedChunks,
        dense: observedDense,
        ann: observedAnn
      }
    };
  }

  return {
    ok: true,
    phase: 'post-import',
    rowLedger: ledger,
    observed: {
      chunks: observedChunks,
      dense: observedDense,
      ann: observedAnn
    }
  };
};

export const classifySqliteModeBuildFailure = (err) => {
  const message = String(err?.message || err || '').trim();
  if (message.startsWith('Failed to load index pieces for ')) {
    return {
      code: 'ERR_SQLITE_INPUT_PIECES_LOAD_FAILED',
      failureClass: 'input_pieces_load_failed'
    };
  }
  if (message.startsWith('Missing index pieces for ')) {
    return {
      code: 'ERR_SQLITE_INPUT_PIECES_MISSING',
      failureClass: 'input_pieces_missing'
    };
  }
  if (message.includes('Index directory missing for artifact build')) {
    return {
      code: 'ERR_SQLITE_INDEX_DIR_MISSING',
      failureClass: 'index_dir_missing'
    };
  }
  return {
    code: 'ERR_SQLITE_MODE_BUILD_FAILED',
    failureClass: 'sqlite_mode_build_failed'
  };
};

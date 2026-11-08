import {
  readSqliteDenseModeCount,
  readSqliteModeCount,
  readSqliteTableCount,
  readSqliteModeRowCounts
} from './sqlite-probes.js';
import { observeStorageResource } from '../../../../shared/storage/failure-observation.js';
import { isSqliteChunkIdentityWitness, matchesSqliteChunkIdentity } from '../row-identity.js';

const normalizeCount = (value) => {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
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

export const SQLITE_ROW_LEDGER_SCHEMA_VERSION = 2;

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
  expectedChunkCount = null,
  expectedDenseCount = null,
  expectedFileCount = null,
  inputRoot = null
} = {}) => ({
  schemaVersion: SQLITE_ROW_LEDGER_SCHEMA_VERSION,
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
  observeStorageResource(bundleResult, { phase: 'sqlite-ledger-bundle-result' }).requireSettled();
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

  if (ledger.schemaVersion !== SQLITE_ROW_LEDGER_SCHEMA_VERSION
    || [expectedChunks, expectedDense, observedChunks, observedDense].some(value => value === null)) {
    return { ok: false, phase: 'pre-import', failureClass: SQLITE_ROW_LEDGER_FAILURE.inputInvalid,
      code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.inputInvalid, 'pre-import'),
      message: 'bundle/expected row counts are unavailable or invalid', rowLedger: ledger,
      observed: { chunks: observedChunks, dense: observedDense }, embedStats };
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

  if (observedDense !== expectedDense) return {
    ok: false, phase: 'pre-import', failureClass: SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch,
    code: resolveSqliteRowLedgerFailureCode(SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch, 'pre-import'),
    message: `bundle dense count mismatch (${observedDense} !== ${expectedDense})`, rowLedger: ledger,
    observed: { chunks: observedChunks, dense: observedDense }, embedStats
  };

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
  repoRoot = process.cwd(), userConfig = null, rowLedger, Database, dbPath,
  annTable = 'dense_vectors_ann', annExpectation = 'optional', configureAnn = null, chunkIdentity = null, probe = {}
} = {}) => {
  const ledger = rowLedger && typeof rowLedger === 'object' ? rowLedger : createSqliteModeRowLedger();
  const input = { repoRoot, userConfig, Database, dbPath, mode: ledger.mode };
  if (chunkIdentity && !isSqliteChunkIdentityWitness(chunkIdentity, dbPath, ledger.mode)) throw Object.assign(
    new Error('SQLite row identity witness is foreign, copied or belongs to another target/mode.'), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH' });
  const customCounts = ['readModeCount', 'readDenseCount', 'readTableCount'].some(key => typeof probe[key] === 'function');
  if (chunkIdentity && (customCounts || typeof probe.readSnapshot === 'function')) throw Object.assign(
    new Error('Qualified chunk identity requires the actual native snapshot owner.'), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH' });
  const snapshot = typeof probe.readSnapshot === 'function' ? probe.readSnapshot(input)
    : customCounts ? {
      chunks: (probe.readModeCount || readSqliteModeCount)(input),
      dense: (probe.readDenseCount || readSqliteDenseModeCount)(input),
      ann: (probe.readTableCount || readSqliteTableCount)({ ...input, tableName: annTable })
    } : readSqliteModeRowCounts(input, { annTable, configureAnn, chunkIdentity: Boolean(chunkIdentity),
      checkAnnCorrespondence: annExpectation !== 'disabled' });
  observeStorageResource(snapshot, { phase: 'sqlite-ledger-staged-counts' }).requireSettled();
  if (snapshot?.correspondence && (customCounts || typeof probe.readSnapshot === 'function')) throw Object.assign(
    new Error('Qualified native correspondence requires the actual snapshot owner.'), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH' });
  const observed = { chunks: normalizeCount(snapshot?.chunks), dense: normalizeCount(snapshot?.dense),
    files: normalizeCount(snapshot?.files), ann: normalizeCount(snapshot?.ann),
    annPresent: snapshot?.annPresent ?? normalizeCount(snapshot?.ann) !== null };
  const expectedChunks = normalizeCount(ledger.expected?.chunks), expectedDense = normalizeCount(ledger.expected?.dense);
  const failure = (kind, message) => ({ ok: false, phase: 'post-import',
    failureClass: kind === SQLITE_ROW_LEDGER_FAILURE.inputInvalid ? kind : SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch,
    code: resolveSqliteRowLedgerFailureCode(kind, 'post-import'), message, rowLedger: ledger, observed });
  if (ledger.schemaVersion !== SQLITE_ROW_LEDGER_SCHEMA_VERSION
    || [expectedChunks, expectedDense, observed.chunks, observed.dense].some(value => value === null)
    || !customCounts && observed.files === null
    || !['ready', 'optional', 'disabled', 'unavailable'].includes(annExpectation)
    || typeof observed.annPresent !== 'boolean'
    || observed.annPresent && observed.ann === null || !observed.annPresent && observed.ann !== null) {
    return failure(SQLITE_ROW_LEDGER_FAILURE.inputInvalid, 'post-import counts/capability are unavailable or invalid');
  }
  if (observed.chunks !== expectedChunks) return failure(SQLITE_ROW_LEDGER_FAILURE.rowCountMismatch,
    `post-import chunk count mismatch (${observed.chunks} !== ${expectedChunks})`);
  if (observed.dense !== expectedDense) return failure(SQLITE_ROW_LEDGER_FAILURE.denseCountMismatch,
    `post-import dense count mismatch (${observed.dense} !== ${expectedDense})`);
  if (annExpectation === 'ready' && !observed.annPresent) return failure(SQLITE_ROW_LEDGER_FAILURE.inputInvalid,
    'post-import required ANN representation is unavailable');
  if (observed.annPresent && observed.ann !== (annExpectation === 'disabled' ? 0 : observed.dense)) {
    return failure(SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch,
      `post-import ANN count mismatch (${observed.ann} !== ${annExpectation === 'disabled' ? 0 : observed.dense})`);
  }
  if (chunkIdentity && !matchesSqliteChunkIdentity(chunkIdentity, snapshot?.chunkIdentity, dbPath, ledger.mode)) return {
    ...failure(SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch, 'post-import chunk identity mismatch against original producer witness'),
    code: 'ERR_SQLITE_POSTIMPORT_IDENTITY_MISMATCH', failureClass: 'row_identity_mismatch',
    rowIdentity: { expected: chunkIdentity, observed: snapshot?.chunkIdentity || null }
  };
  if (snapshot?.correspondence && snapshot.correspondence.ok !== true) return {
    ...failure(SQLITE_ROW_LEDGER_FAILURE.postImportValidationMismatch, 'post-import native file/dense/ANN correspondence mismatch'),
    code: 'ERR_SQLITE_POSTIMPORT_CORRESPONDENCE_MISMATCH', failureClass: 'row_identity_mismatch',
    rowIdentity: { phase: 'post-import-correspondence', ...snapshot.correspondence }
  };
  return { ok: true, phase: 'post-import', rowLedger: ledger, observed,
    coverage: { chunks: 'exact-count', dense: 'exact-count', ann: observed.annPresent ? 'exact-count' : annExpectation,
      files: snapshot?.correspondence?.coverage?.files || 'observed-only',
      identities: chunkIdentity ? chunkIdentity.coverage : 'unqualified',
      correspondence: snapshot?.correspondence?.coverage || null } };
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

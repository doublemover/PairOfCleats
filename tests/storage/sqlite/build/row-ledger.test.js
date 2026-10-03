#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  classifySqliteModeBuildFailure,
  createSqliteModeRowLedger,
  validateSqliteRowLedgerPostImport,
  validateSqliteRowLedgerPreImport
} from '../../../../src/storage/sqlite/build/runner/row-ledger.js';

const rowLedger = createSqliteModeRowLedger({
  mode: 'code',
  source: 'incremental',
  expectedChunkCount: 5,
  expectedDenseCount: 3,
  expectedFileCount: 2,
  inputRoot: '/tmp/code'
});

{
  const result = validateSqliteRowLedgerPreImport({
    rowLedger,
    bundleResult: {
      count: 4,
      denseCount: 3,
      embedStats: {}
    },
    denseArtifactsRequired: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR_SQLITE_PREIMPORT_ROW_COUNT_MISMATCH');
  assert.match(result.message, /bundle row count mismatch/i);
}

{
  const result = validateSqliteRowLedgerPreImport({
    rowLedger,
    bundleResult: {
      count: 5,
      denseCount: 0,
      embedStats: {
        filesMissingEmbeddings: 1
      }
    },
    denseArtifactsRequired: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR_SQLITE_PREIMPORT_DENSE_COVERAGE_MISMATCH');
  assert.match(result.message, /bundles missing embeddings/i);
}

{
  const result = validateSqliteRowLedgerPreImport({
    rowLedger,
    bundleResult: {
      count: 5,
      denseCount: 3,
      reason: 'bundle read failed (/tmp/bundle): invalid bundle'
    },
    denseArtifactsRequired: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR_SQLITE_PREIMPORT_INPUT_INVALID');
  assert.match(result.message, /bundle read failed/i);
}

{
  const result = validateSqliteRowLedgerPostImport({
    rowLedger,
    Database: null,
    dbPath: '/tmp/code.sqlite',
    probe: {
      readModeCount: () => 4,
      readDenseCount: () => 3,
      readTableCount: () => 3
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR_SQLITE_POSTIMPORT_ROW_COUNT_MISMATCH');
  assert.match(result.message, /post-import chunk count mismatch/i);
}

{
  const result = validateSqliteRowLedgerPostImport({
    rowLedger,
    Database: null,
    dbPath: '/tmp/code.sqlite',
    probe: {
      readModeCount: () => 5,
      readDenseCount: () => 3,
      readTableCount: () => 2
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ERR_SQLITE_POSTIMPORT_VALIDATION_MISMATCH');
  assert.match(result.message, /ANN count mismatch/i);
}

{
  const piecesLoadFailure = classifySqliteModeBuildFailure(
    new Error('Failed to load index pieces for code: synthetic failure')
  );
  assert.deepEqual(piecesLoadFailure, {
    code: 'ERR_SQLITE_INPUT_PIECES_LOAD_FAILED',
    failureClass: 'input_pieces_load_failed'
  });
}

console.log('sqlite row ledger test passed');

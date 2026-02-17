#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSparsePreflightMissingTables } from '../../../src/retrieval/cli.js';

const sqliteHelpers = {
  hasTable: () => false
};

const sparseRouteMissing = resolveSparsePreflightMissingTables({
  sqliteHelpers,
  mode: 'code',
  postingsConfig: { enablePhraseNgrams: true, enableChargrams: true },
  sqliteFtsRoutingByMode: {
    byMode: {
      code: { desired: 'sparse' }
    }
  },
  sparseBackend: 'tantivy'
});

assert.deepEqual(
  sparseRouteMissing,
  [],
  'expected sqlite sparse preflight checks to be skipped when sparseBackend=tantivy (sparse route)'
);

const ftsRouteMissing = resolveSparsePreflightMissingTables({
  sqliteHelpers,
  mode: 'code',
  postingsConfig: { enablePhraseNgrams: true, enableChargrams: true },
  sqliteFtsRoutingByMode: {
    byMode: {
      code: { desired: 'fts' }
    }
  },
  sparseBackend: 'tantivy'
});

assert.deepEqual(
  ftsRouteMissing,
  [],
  'expected sqlite sparse preflight checks to be skipped when sparseBackend=tantivy (fts route)'
);

console.log('cli sparse preflight tantivy bypass test passed');

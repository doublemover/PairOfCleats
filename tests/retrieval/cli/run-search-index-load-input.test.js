#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildRunSearchIndexLoadInput,
  buildRunSearchIndexStatesForLoad,
  resolveChunkAuthorFilterActive
} from '../../../src/retrieval/cli/run-search/index-load-input.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

assert.equal(resolveChunkAuthorFilterActive([]), false);
assert.equal(resolveChunkAuthorFilterActive(['alice']), true);
assert.equal(resolveChunkAuthorFilterActive('alice'), true);

const indexStates = buildRunSearchIndexStatesForLoad({
  sqliteStateCode: { mode: 'code' },
  sqliteStateProse: null,
  sqliteStateExtractedProse: undefined,
  sqliteStateRecords: { mode: 'records' }
});
assert.deepEqual(indexStates, {
  code: { mode: 'code' },
  prose: null,
  'extracted-prose': null,
  records: { mode: 'records' }
});

const loadInput = buildRunSearchIndexLoadInput({
  stageTracker: { enabled: true },
  queryPlan: { filtersActive: true, resolvedDenseVectorMode: 'hnsw' },
  chunkAuthorFilter: ['alice'],
  sqliteFtsEnabled: true,
  sqliteStateCode: { mode: 'code' },
  sqliteStateProse: { mode: 'prose' },
  sqliteStateExtractedProse: null,
  sqliteStateRecords: { mode: 'records' },
  backendLabel: 'sqlite'
});

assert.equal(loadInput.chunkAuthorFilterActive, true);
assert.equal(loadInput.filtersActive, true);
assert.equal(loadInput.sqliteFtsRequested, true);
assert.equal(loadInput.resolvedDenseVectorMode, 'hnsw');
assert.equal(loadInput.backendLabel, 'sqlite');
assert.deepEqual(loadInput.indexStates, {
  code: { mode: 'code' },
  prose: { mode: 'prose' },
  'extracted-prose': null,
  records: { mode: 'records' }
});
assert.equal('queryPlan' in loadInput, false);

console.log('run-search index-load input helper test passed');

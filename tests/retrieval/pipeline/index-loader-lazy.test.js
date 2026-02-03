#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';

process.env.PAIROFCLEATS_TESTING = '1';

const { codeDir } = await ensureFixtureIndex({ fixtureName: 'sample' });

const idx = await loadIndex(codeDir, {
  includeFileRelations: false,
  includeRepoMap: false,
  includeFilterIndex: false,
  includeDense: false,
  includeMinhash: false,
  includeTokenIndex: false,
  fileChargramN: 3,
  strict: true
});

assert.equal(idx.fileRelations, null, 'expected fileRelations to be skipped');
assert.equal(idx.repoMap, null, 'expected repoMap to be skipped');
assert.equal(idx.filterIndex, null, 'expected filterIndex to be skipped');
assert.equal(idx.denseVec, null, 'expected dense vectors to be skipped');
assert.equal(idx.minhash, null, 'expected minhash to be skipped');
assert.equal(idx.tokenIndex, undefined, 'expected token index to be skipped');

console.log('index loader lazy test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRelationBoostIndex,
  createRelationBoostPipeline
} from './helpers/relation-boost-fixture.js';

const idx = createRelationBoostIndex({
  chunks: [{
    id: 0,
    file: 'src/a.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: { usages: ['alpha'] }
  }]
});

const pipeline = createRelationBoostPipeline({
  query: 'alpha',
  queryTokens: ['alpha'],
  annEnabled: true,
  annBackend: 'sqlite',
  vectorAnnAvailable: true,
  rankSqliteFts: () => [{ idx: 0, score: 1 }],
  rankVectorAnnSqlite: () => [{ idx: 0, sim: 0.9 }]
});

const hit = (await pipeline(idx, 'code', [0.1, 0.2, 0.3]))[0];
const policy = hit?.scoreBreakdown?.ann?.candidatePolicy || null;

assert.ok(policy, 'expected ann candidate policy in explain payload');
assert.equal(typeof policy.reason, 'string', 'expected policy reason code');
assert.equal(typeof policy.inputSize, 'number', 'expected policy input size');
assert.equal(typeof policy.candidateSize, 'number', 'expected policy candidate size');
assert.ok(
  policy.outputMode === 'constrained' || policy.outputMode === 'full',
  'unexpected policy output mode'
);
assert.ok(policy.minDocCount >= 1, 'expected minDocCount in explain');
assert.ok(policy.maxDocCount >= policy.minDocCount, 'expected maxDocCount in explain');

console.log('ann candidate policy explain test passed');

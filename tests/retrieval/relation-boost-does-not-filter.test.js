#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRelationBoostIndex,
  createRelationBoostPipeline
} from './helpers/relation-boost-fixture.js';

const chunks = [
  {
    id: 0,
    file: 'src/a.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: { calls: [['a', 'noop']], usages: ['alpha'] }
  },
  {
    id: 1,
    file: 'src/b.js',
    lang: 'javascript',
    tokens: ['beta'],
    codeRelations: { calls: [['b', 'fetchData']], usages: ['fetchData'] }
  }
];

const idx = createRelationBoostIndex({ chunks });
const rankSqliteFts = () => [
  { idx: 0, score: 2.0 },
  { idx: 1, score: 1.8 }
];

const disabledPipeline = createRelationBoostPipeline({
  query: 'fetchData',
  queryTokens: ['fetchdata'],
  relationBoost: { enabled: false },
  rankSqliteFts
});
const enabledPipeline = createRelationBoostPipeline({
  query: 'fetchData',
  queryTokens: ['fetchdata'],
  relationBoost: { enabled: true, perCall: 0.5, perUse: 0.25, maxBoost: 1.0 },
  rankSqliteFts
});

const disabled = await disabledPipeline(idx, 'code', null);
const enabled = await enabledPipeline(idx, 'code', null);

assert.equal(disabled.length, 2, 'expected baseline pipeline to return both hits');
assert.equal(enabled.length, 2, 'expected relation boost to preserve hit membership');
assert.deepEqual(
  enabled.map((hit) => hit.id).sort((a, b) => a - b),
  disabled.map((hit) => hit.id).sort((a, b) => a - b),
  'relation boost must not filter results'
);

console.log('relation boost does-not-filter test passed');

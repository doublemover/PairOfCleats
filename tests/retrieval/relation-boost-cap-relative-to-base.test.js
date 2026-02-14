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
    codeRelations: { calls: [['a', 'fetchData']], usages: ['fetchData'] }
  },
  {
    id: 1,
    file: 'src/b.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: { calls: [['b', 'fetchData']], usages: ['fetchData'] }
  }
];
const idx = createRelationBoostIndex({ chunks });
const rankSqliteFts = () => [
  { idx: 0, score: 100 },
  { idx: 1, score: 1 }
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
  relationBoost: {
    enabled: true,
    perCall: 2,
    perUse: 2,
    maxBoost: 0.5
  },
  rankSqliteFts
});

const disabledHits = await disabledPipeline(idx, 'code', null);
const enabledHits = await enabledPipeline(idx, 'code', null);

const byId = (hits) => new Map(hits.map((hit) => [hit.id, hit]));
const baselineById = byId(disabledHits);
const boostedById = byId(enabledHits);
for (const id of baselineById.keys()) {
  const baseline = baselineById.get(id);
  const boosted = boostedById.get(id);
  const delta = boosted.score - baseline.score;
  assert.ok(delta <= 0.5000001, `expected capped delta for id=${id}`);
  assert.ok(delta >= 0.499999, `expected relation boost cap to be applied for id=${id}`);
}

console.log('relation boost cap relative-to-base test passed');

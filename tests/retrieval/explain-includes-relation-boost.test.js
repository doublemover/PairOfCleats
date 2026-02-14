#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRelationBoostIndex,
  createRelationBoostPipeline
} from './helpers/relation-boost-fixture.js';

const idx = createRelationBoostIndex({
  chunks: [{
    id: 0,
    file: 'src/app.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: {
      calls: [['run', 'fetchData']],
      usages: ['fetchData', 'result']
    }
  }]
});

const pipeline = createRelationBoostPipeline({
  query: 'fetchData result',
  queryTokens: ['fetchdata', 'result'],
  relationBoost: {
    enabled: true,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5
  },
  rankSqliteFts: () => [{ idx: 0, score: 2 }]
});

const hit = (await pipeline(idx, 'code', null))[0];
assert.ok(hit?.scoreBreakdown?.relation, 'expected relation boost explain payload');
assert.equal(hit.scoreBreakdown.relation.enabled, true, 'expected relation boost explain enabled flag');
assert.equal(hit.scoreBreakdown.relation.callMatches, 1, 'expected call match count in explain');
assert.equal(hit.scoreBreakdown.relation.usageMatches, 2, 'expected usage match count in explain');
assert.equal(hit.scoreBreakdown.relation.perCall, 0.25, 'expected perCall weight in explain');
assert.equal(hit.scoreBreakdown.relation.perUse, 0.1, 'expected perUse weight in explain');
assert.equal(hit.scoreBreakdown.relation.maxBoost, 1.5, 'expected maxBoost in explain');
assert.ok(Array.isArray(hit.scoreBreakdown.relation.signalTokens), 'expected bounded signal token list');
assert.ok(Array.isArray(hit.scoreBreakdown.relation.matchedCalls), 'expected bounded call token list');
assert.ok(Array.isArray(hit.scoreBreakdown.relation.matchedUsages), 'expected bounded usage token list');
assert.ok(
  hit.scoreBreakdown.relation.signalTokens.length <= hit.scoreBreakdown.relation.maxExplainTokens,
  'expected signal token list to respect explain cap'
);
assert.ok(
  hit.scoreBreakdown.relation.matchedCalls.length <= hit.scoreBreakdown.relation.maxExplainTokens,
  'expected call token list to respect explain cap'
);
assert.ok(
  hit.scoreBreakdown.relation.matchedUsages.length <= hit.scoreBreakdown.relation.maxExplainTokens,
  'expected usage token list to respect explain cap'
);
assert.ok(
  hit.scoreBreakdown.relation.lexicon && typeof hit.scoreBreakdown.relation.lexicon === 'object',
  'expected lexicon status in relation boost explain payload'
);

console.log('explain includes relation boost test passed');

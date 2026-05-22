#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createRelationBoostIndex,
  createRelationBoostPipeline
} from './helpers/relation-boost-fixture.js';
import {
  createSearchOutputHitState,
  renderSearchOutputForTest
} from './helpers/search-output-fixture.js';

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
assert.equal(typeof hit.scoreBreakdown.relation.lexicon.sourceFile, 'string', 'expected lexicon source file');
assert.equal(hit.scoreBreakdown.relation.lexicon.formatVersion, 1, 'expected lexicon format version');
assert.equal(
  typeof hit.scoreBreakdown.relation.lexicon.domainTokenCounts?.relations,
  'number',
  'expected lexicon relations-domain token count'
);
assert.equal(
  typeof hit.scoreBreakdown.relation.lexicon.domainTokenCounts?.ranking,
  'number',
  'expected lexicon ranking-domain token count'
);
assert.equal(
  typeof hit.scoreBreakdown.relation.lexicon.domainTokenCounts?.chargrams,
  'number',
  'expected lexicon chargram-domain token count'
);

const payload = renderSearchOutputForTest({
  queryTokens: ['fetchdata', 'result'],
  ...createSearchOutputHitState({ codeHits: [hit] }),
  intentInfo: { type: 'keyword' }
});

assert.ok(payload?.stats?.relationBoost, 'expected stats relationBoost section');
assert.equal(payload.stats.relationBoost.callMatches, 1, 'expected stats relationBoost call matches');
assert.equal(payload.stats.relationBoost.usageMatches, 2, 'expected stats relationBoost usage matches');
assert.ok(payload?.stats?.lexicon, 'expected stats lexicon section');
assert.equal(typeof payload.stats.lexicon.sourceFile, 'string', 'expected stats lexicon source file');
assert.equal(payload.stats.lexicon.formatVersion, 1, 'expected stats lexicon format version');
assert.equal(typeof payload.stats.lexicon.domainTokenCounts?.relations, 'number', 'expected stats lexicon relations count');
assert.equal(typeof payload.stats.lexicon.domainTokenCounts?.ranking, 'number', 'expected stats lexicon ranking count');
assert.equal(typeof payload.stats.lexicon.domainTokenCounts?.chargrams, 'number', 'expected stats lexicon chargram count');

console.log('explain includes relation boost test passed');

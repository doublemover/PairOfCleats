#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';
import {
  createAlphaSearchIndex,
  createAlphaTokenIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

const sqliteCalls = [];
const rankSqliteFts = (_idx, _tokens, mode) => {
  sqliteCalls.push(mode);
  return [{ idx: 0, score: 2 }];
};

const routingPolicy = resolveSqliteFtsRoutingByMode({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsExplicit: false,
  runCode: true,
  runProse: true,
  runExtractedProse: false,
  runRecords: false
});

assert.equal(routingPolicy.byMode.code.desired, 'sparse', 'expected code mode default sparse route');
assert.equal(routingPolicy.byMode.prose.desired, 'fts', 'expected prose mode default fts route');

const pipeline = createSearchPipelineFixture({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsRoutingByMode: routingPolicy,
  buildCandidateSetSqlite: () => new Set([0]),
  getTokenIndexForQuery: (_tokens, mode) => (mode === 'code' ? createAlphaTokenIndex() : null),
  rankSqliteFts,
  sqliteHasFts: () => true
});

const idx = createAlphaSearchIndex();

const codeHits = await pipeline(idx, 'code', null);
const proseHits = await pipeline(idx, 'prose', null);

assert.equal(sqliteCalls.length, 1, 'expected sqlite FTS to run only for prose mode');
assert.equal(sqliteCalls[0], 'prose', 'expected sqlite FTS call for prose mode');
assert.equal(codeHits.length, 1, 'expected code mode result');
assert.equal(codeHits[0].scoreBreakdown?.sparse?.type, 'bm25', 'expected code mode sparse fallback');
assert.equal(proseHits.length, 1, 'expected prose mode result');
assert.equal(proseHits[0].scoreBreakdown?.sparse?.type, 'fts', 'expected prose mode to route to fts');
assert.equal(typeof proseHits[0].scoreBreakdown?.sparse?.match, 'string', 'expected explain MATCH output for prose fts');

console.log('search routing policy test passed');

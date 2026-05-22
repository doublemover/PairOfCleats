#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';
import {
  createAlphaSearchIndex,
  createAlphaTokenIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

let sqliteCalls = 0;
const pipeline = createSearchPipelineFixture({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsRoutingByMode: resolveSqliteFtsRoutingByMode({
    useSqlite: true,
    sqliteFtsRequested: true,
    sqliteFtsExplicit: false,
    runCode: false,
    runProse: true,
    runExtractedProse: false,
    runRecords: false
  }),
  buildCandidateSetSqlite: () => new Set([0]),
  getTokenIndexForQuery: () => createAlphaTokenIndex(),
  rankSqliteFts: () => {
    sqliteCalls += 1;
    return [{ idx: 0, score: 3 }];
  },
  sqliteHasFts: () => true,
  sqliteHasTable: (_mode, tableName) => tableName !== 'chunks_fts'
});

const idx = createAlphaSearchIndex({
  chunks: [{ id: 0, file: 'src/prose.md', tokens: ['alpha'], weight: 1 }]
});

const hits = await pipeline(idx, 'prose', null);

assert.equal(sqliteCalls, 0, 'expected sqlite FTS call to be skipped when table is unavailable');
assert.equal(hits.length, 1, 'expected controlled fallback hit result');
assert.equal(hits[0].scoreBreakdown?.sparse?.type, 'bm25', 'expected sparse fallback when FTS table is missing');
assert.equal(hits[0].scoreBreakdown?.sparse?.ftsFallback, true, 'expected explain fallback marker');

console.log('fts missing table fallback test passed');

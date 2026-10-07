#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSqliteFtsRoutingByMode } from '../../../src/retrieval/routing-policy.js';
import {
  createAlphaSearchIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

let sqliteCalls = 0;
const pipeline = createSearchPipelineFixture({
  useSqlite: true,
  sqliteFtsRequested: true,
  sqliteFtsRoutingByMode: resolveSqliteFtsRoutingByMode({
    useSqlite: true,
    sqliteFtsRequested: true,
    sqliteFtsExplicit: true,
    runCode: true,
    runProse: false,
    runExtractedProse: false,
    runRecords: false
  }),
  profilePolicyByMode: {
    code: {
      profileId: 'default',
      vectorOnly: false,
      allowSparseFallback: false
    }
  },
  buildCandidateSetSqlite: () => {
    throw new Error('bm25 fallback should not run when sqlite-fts is healthy');
  },
  getTokenIndexForQuery: () => {
    throw new Error('token index should not be required for sqlite-fts path');
  },
  rankSqliteFts: () => {
    sqliteCalls += 1;
    return [{ idx: 0, score: 2 }];
  },
  sqliteHasFts: () => true,
  sqliteHasTable: (_mode, tableName) => tableName === 'chunks' || tableName === 'chunks_fts'
});

const idx = createAlphaSearchIndex({ tokenIndex: null });

const hits = await pipeline(idx, 'code', null);

assert.equal(sqliteCalls, 1, 'expected sqlite FTS to run even when bm25 sparse tables are absent');
assert.equal(hits.length, 1, 'expected sqlite FTS search hit');
assert.equal(hits[0].scoreBreakdown?.sparse?.type, 'fts', 'expected sqlite FTS sparse type');

console.log('fts preflight does not require bm25 tables test passed');

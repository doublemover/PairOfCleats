#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseQueryInput, annotateQueryAst } from '../../../src/retrieval/query.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';
import { runRankStage } from '../../../src/retrieval/pipeline/rank-stage.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createAvailableDenseAnnProvider,
  createInMemorySearchPipeline
} from './helpers/in-memory-search-pipeline-fixture.js';

applyTestEnv();
const chunk = { id: 0, file: 'src/cache.js', ext: '.js', tokens: ['cache', 'refresh'], weight: 1 };
const idx = { chunkMeta: [chunk] };
const snapshot = () => ({ candidate: {}, score: {} });
const queryAstFor = (query) => annotateQueryAst(parseQueryInput(query).ast, new Set(), {}, {});
const rank = (query, { annScore = 0.99, annSource = 'dense', allowedIdx = null } = {}) => {
  const rankMetrics = {};
  const { matchesQueryAst } = createQueryAstHelpers({ queryAst: queryAstFor(query) });
  const hits = runRankStage({
    idx,
    meta: idx.chunkMeta,
    fusedScores: [{ idx: 0, score: 0.99, annScore, annSource, scoreType: 'ann' }],
    matchesQueryAst,
    allowedIdx,
    hasAllowedId: (set, id) => set.has(id),
    abortIfNeeded() {},
    searchTopN: 10,
    topkSlack: 0,
    poolSnapshotStart: snapshot(),
    poolSnapshot: snapshot,
    rankMetrics,
    symbolBoostEnabled: false,
    relationBoostEnabled: false,
    graphRankingConfig: { enabled: false }
  });
  return { hits, rankMetrics };
};

for (const query of ['cache refresh', 'cache refresh unnecessary', 'unnecessary', 'cache NOT debug', 'cache -debug']) {
  assert.equal(rank(query).hits.length, 1, `semantic candidate should survive: ${query}`);
}
for (const query of ['cache AND unnecessary', 'cache refresh AND unnecessary', '(cache refresh unnecessary)', 'unnecessary OR absent', 'cache NOT refresh', 'cache -refresh', 'cache "missing"']) {
  const result = rank(query);
  assert.equal(result.hits.length, 0, `hard constraint should reject: ${query}`);
  assert.deepEqual(result.rankMetrics.queryGate, { evaluated: 1, annEvaluated: 1, rejected: 1, annRejected: 1 });
}
assert.equal(rank('cache OR unnecessary').hits.length, 1);
assert.equal(rank('cache refresh unnecessary', { annScore: null }).hits.length, 0, 'sparse-only implicit AND is unchanged');
assert.equal(rank('unnecessary', { annScore: Number.NaN }).hits.length, 0, 'non-finite ANN score cannot bypass lexical checks');
assert.equal(rank('unnecessary', { annSource: 'minhash' }).hits.length, 0, 'lexical MinHash fallback is not a semantic vector match');
assert.equal(rank('cache', { allowedIdx: new Set() }).hits.length, 0, 'ANN never bypasses structured filters');

// Exercise the full hybrid pipeline as well as the isolated post-fusion gate.
const index = {
  chunkMeta: [chunk, { ...chunk, id: 1, file: 'private.ts', ext: '.ts' }],
  tokenIndex: { vocab: ['cache', 'refresh'], postings: [[[0, 1], [1, 1]], [[0, 1], [1, 1]]], docLengths: [2, 2], totalDocs: 2, avgDocLen: 2 },
  denseVec: { vectors: [[0.1, 0.2], [0.2, 0.3]] },
  minhash: { signatures: [] }
};
index.filterIndex = buildFilterIndex(index.chunkMeta);
const provider = createAvailableDenseAnnProvider(async () => [{ idx: 0, sim: 0.99 }, { idx: 1, sim: 0.98 }]);
for (const [query, expected] of [['cache refresh unnecessary', 1], ['cache AND unnecessary', 0]]) {
  const pipeline = createInMemorySearchPipeline({
    provider,
    query,
    queryTokens: ['cache', 'refresh', 'unnecessary'],
    filters: { ext: ['js'] },
    filtersActive: true,
    overrides: { queryAst: queryAstFor(query) }
  });
  const hits = await pipeline(index, 'code', [0.1, 0.2]);
  assert.equal(hits.length, expected, `full hybrid pipeline: ${query}`);
  if (hits.length) assert.equal(hits[0].id, 0);
}

console.log('ANN free-text and explicit query constraint tests passed');

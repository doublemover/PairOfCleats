import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';
import { resolveRerankPoolPolicy, capRerankCandidates } from '../../../src/retrieval/pipeline/rerank-policy.js';
import { createAvailableDenseAnnProvider, createInMemorySearchPipeline } from './helpers/in-memory-search-pipeline-fixture.js';

applyTestEnv();
const hits = Array.from({ length: 4 }, (_, id) => ({ id, chunkUid: `chunk-${id}`, file: `src/${id}.js`,
  start: 0, end: 8, score: 1 - id / 10, scoreType: 'ann', annScore: 1 - id / 10, meta: { retained: true } }));
const adapter = { id: 'inert-fixture', identityKey: 'a'.repeat(64), scoreRange: { min: 0, max: 1 },
  rerank: async ({ hits: members }) => members.map((hit, index) => ({ index, score: hit.id === 3 ? 1 : 0 })) };
const sourceContext = { generation: 'fixture-generation', mode: 'code', repoScope: 'fixture-repo' };
assert.equal(await rerankEvidence({ adapter: null, hits }), hits, 'no adapter preserves the existing output object');
const policy = resolveRerankPoolPolicy({ adapter, policy: { enabled: true, poolCap: 4, candidateCap: 4 }, finalOutputCap: 1 });
const scores = capRerankCandidates(hits.map((hit, idx) => ({ ...hit, idx })), policy);
assert.deepEqual(scores.map(hit => hit.idx), [0, 1, 2, 3]);
const result = await rerankEvidence({ adapter, query: 'alpha', hits, sourceContext,
  policyKey: policy.key, finalOutputCap: 1, fallback: true });
assert.equal(result[0].id, 3, 'an eligible member beyond final top-k can be rescued from the distinct rerank pool');
assert.equal(result[0].sourceScore, hits[3].score);
assert.equal(result[0].annScore, hits[3].annScore);
assert.equal(result[0].rerankProvenance.sourceRank, 4);
assert.equal(result[0].rerankProvenance.generation, sourceContext.generation);
assert.equal(hits[3].scoreType, 'ann'); assert.equal(hits[3].meta.retained, true);
const mutableContext = { ...sourceContext, selection: { filter: 'original' } };
const capturedRequest = rerankEvidence({ adapter: { ...adapter, rerank: async request => {
  assert.equal(request.sourceContext.generation, sourceContext.generation);
  assert.equal(request.sourceContext.selection.filter, 'original');
  assert.equal(Object.isFrozen(request.sourceContext.selection), true);
  return adapter.rerank(request);
} }, hits, sourceContext: mutableContext, policyKey: policy.key });
mutableContext.generation = 'new-generation'; mutableContext.selection.filter = 'changed';
assert.equal((await capturedRequest)[0].rerankProvenance.generation, sourceContext.generation,
  'adapter work and result identity share one request-owned source snapshot');
for (const poolCap of [0, 65]) assert.throws(() => resolveRerankPoolPolicy({ adapter, policy: { enabled: true, poolCap }, finalOutputCap: 1 }));
const tied = await rerankEvidence({ adapter: { ...adapter, rerank: async () => hits.map((_, index) => ({ index, score: 1 })) }, hits });
assert.deepEqual(tied.map(hit => hit.id), [0, 1, 2, 3]);
for (const invalid of [[], [{ index: 0, score: 1 }], hits.map(() => ({ index: 0, score: 1 })),
  hits.map((_, index) => ({ index, score: index === 0 ? NaN : 0 })), hits.map((_, index) => ({ index, score: 2 })),
  hits.map((_, index) => ({ index, score: 0, hit: { id: 999 } }))]) {
  const fallback = await rerankEvidence({ adapter: { ...adapter, rerank: async () => invalid }, hits,
    finalOutputCap: 2, fallback: true });
  assert.deepEqual(fallback.map(hit => hit.id), [0, 1]); assert.equal(fallback.rerankDiagnostic.status, 'fallback');
}
const mutating = await rerankEvidence({ adapter: { ...adapter, rerank: async ({ hits: members }) => {
  members[0].meta.retained = false; return [];
} }, hits, fallback: true });
assert.equal(mutating.rerankDiagnostic.status, 'fallback'); assert.equal(hits[0].meta.retained, true);
const duplicate = [hits[0], { ...hits[0] }];
assert.equal((await rerankEvidence({ adapter, hits: duplicate, sourceContext, policyKey: policy.key, fallback: true })).rerankDiagnostic.status, 'fallback');
let seenPool = 0;
const provider = createAvailableDenseAnnProvider(async ({ topN }) => hits.slice(0, topN).map((hit, idx) => ({ idx, sim: hit.annScore })));
const index = { state: { buildId: 'fixture-generation' }, chunkMeta: hits.map(hit => ({ ...hit, tokens: ['alpha'], weight: 1 })),
  tokenIndex: { vocab: ['alpha'], postings: [[]], docLengths: [1, 1, 1, 1], totalDocs: 4, avgDocLen: 1 },
  denseVec: { vectors: hits.map(() => [1, 0]) } };
const pipeline = createInMemorySearchPipeline({ provider, topN: 1, overrides: { reranker: { ...adapter,
  rerank: async input => { seenPool = input.hits.length; return adapter.rerank(input); } },
rerankPolicy: { enabled: true, poolCap: 4, candidateCap: 4 }, repoRoot: 'fixture-repo' } });
const pipelineResult = await pipeline(index, 'code', [1, 0]);
assert.equal(seenPool, 4); assert.equal(pipelineResult.length, 1); assert.equal(pipelineResult[0].id, 3);
console.log('distinct rerank candidate/pool/output caps, source authority, ties and score-contract assertions complete');

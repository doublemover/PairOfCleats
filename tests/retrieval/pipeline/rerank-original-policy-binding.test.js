import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveRerankPoolPolicy } from '../../../src/retrieval/pipeline/rerank-policy.js';
import { rerankEvidence } from '../../../src/retrieval/pipeline/evidence-reranker.js';
import { createAvailableDenseAnnProvider, createInMemorySearchPipeline } from './helpers/in-memory-search-pipeline-fixture.js';

applyTestEnv();
// Actual policy/evidence/live pipeline owners, inert supplied adapter/provider.
const hits = [0, 1].map(id => ({ id, chunkUid: `policy-${id}`, file: `${id}.js`, start: 0, end: 2,
  score: 1 - id / 10, scoreType: 'ann', annScore: 1 - id / 10 }));
const sourceContext = { generation: 'original-policy-generation', mode: 'code', repoScope: 'fixture' };
const make = () => {
  const value = { calls: 0 }, adapter = { id: 'original-pinned-adapter', identityKey: 'a'.repeat(64), formattingIdentity: 'original-formatting', scoreRange: { min: 0, max: 1 },
    rerank: async () => { value.calls++; return [{ index: 0, score: .2 }, { index: 1, score: .9 }]; } };
  value.adapter = adapter; value.policy = resolveRerankPoolPolicy({ adapter, policy: { enabled: true, candidateCap: 2, poolCap: 2 }, finalOutputCap: 1 });
  value.run = overrides => rerankEvidence({ adapter, hits, sourceContext, finalOutputCap: 1, maxMs: value.policy.maxMs,
    fallback: true, policyKey: value.policy.key, poolPolicy: value.policy, ...overrides }); return value;
};
const normal = make(); assert.equal((await normal.run())[0].id, 1); assert.equal(normal.calls, 1);
for (const mutate of [value => { value.adapter.identityKey = 'b'.repeat(64); }, value => { value.adapter.id = 'replacement'; },
  value => { value.adapter.formattingIdentity = 'replacement'; }, value => { value.adapter.scoreRange.max = 2; },
  value => { value.adapter.rerank = async () => assert.fail('later callback cannot impersonate the original pinned adapter'); }]) {
  const changed = make(); mutate(changed); await assert.rejects(changed.run(), /changed after/); assert.equal(changed.calls, 0);
}
for (const override of [value => ({ poolPolicy: { ...value.policy } }), value => ({ poolPolicy: false }),
  value => ({ adapter: { ...value.adapter } }), () => ({ policyKey: 'b'.repeat(64) }),
  () => ({ finalOutputCap: 2 }), () => ({ maxMs: 3000 })]) {
  const invalid = make(); await assert.rejects(invalid.run(override(invalid))); assert.equal(invalid.calls, 0);
}
let pinReads = 0;
const stable = make(), pin = stable.adapter.identityKey;
Object.defineProperty(stable.adapter, 'identityKey', { get() { pinReads++; return pinReads === 1 ? pin : 'b'.repeat(64); } });
const selected = resolveRerankPoolPolicy({ adapter: stable.adapter, policy: { enabled: true, candidateCap: 2, poolCap: 2 }, finalOutputCap: 1 });
assert.equal(pinReads, 1); assert.equal(selected.key, stable.policy.key, 'validating and hashing use one original pin snapshot');
await assert.rejects(stable.run({ poolPolicy: selected, policyKey: selected.key }), /changed after/); assert.equal(stable.calls, 0); assert.equal(pinReads, 2);

let getters = 0;
for (const policy of [Object.create({ enabled: true }), Object.defineProperty({}, 'enabled', { get() { getters++; return true; } }),
  Object.defineProperty({ enabled: true }, 'poolCap', { get() { getters++; return 2; } }), { enabled: 'true' },
  Object.assign({ enabled: true }, { [Symbol('unknown')]: true })]) {
  assert.throws(() => resolveRerankPoolPolicy({ adapter: normal.adapter, policy, finalOutputCap: 1 }));
}
assert.equal(getters, 0, 'policy accessors cannot mint configuration or model pin authority');
const unpinned = make(), disabled = resolveRerankPoolPolicy({ adapter: unpinned.adapter, policy: { enabled: false }, finalOutputCap: 2 });
unpinned.adapter.identityKey = null; unpinned.adapter.id = 'changed-unpinned-label';
const disabledResult = await unpinned.run({ poolPolicy: disabled, policyKey: null, finalOutputCap: 2 });
assert.equal(disabledResult[0].reranker, 'changed-unpinned-label'); assert.equal(unpinned.calls, 1,
  'disabled original policy preserves legacy unpinned adapter admission');
for (const primary of [undefined, null, false, 0, '']) {
  const policy = new Proxy({ enabled: true }, { getOwnPropertyDescriptor() { throw primary; } }); let observed = Symbol('missing');
  try { resolveRerankPoolPolicy({ adapter: normal.adapter, policy, finalOutputCap: 1 }); } catch (error) { observed = error; }
  assert.equal(observed, primary);
}

const live = make(), provider = createAvailableDenseAnnProvider(async ({ topN }) => hits.slice(0, topN).map((hit, idx) => ({ idx, sim: hit.annScore })));
const index = { state: { buildId: sourceContext.generation }, chunkMeta: hits.map(hit => ({ ...hit, tokens: ['alpha'], weight: 1 })),
  tokenIndex: { vocab: ['alpha'], postings: [[]], docLengths: [1, 1], totalDocs: 2, avgDocLen: 1 }, denseVec: { vectors: hits.map(() => [1, 0]) } };
const pipeline = createInMemorySearchPipeline({ provider, topN: 1, overrides: { reranker: live.adapter,
  rerankPolicy: { enabled: true, candidateCap: 2, poolCap: 2 }, repoRoot: 'fixture' } });
live.adapter.identityKey = 'b'.repeat(64);
await assert.rejects(pipeline(index, 'code', [1, 0]), /changed after/); assert.equal(live.calls, 0,
  'actual live consumer enforces its original resolved policy before native model work, including fallback-enabled requests');
assert.deepEqual(hits.map(hit => hit.score), [1, .9]);
console.log('Actual reranker resolved policy/original adapter binding controls authored; execution deferred.');

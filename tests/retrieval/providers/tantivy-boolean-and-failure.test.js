import assert from 'node:assert/strict';
import Module from 'node:module';
import { createTantivyProvider } from '../../../src/retrieval/sparse/providers/tantivy.js';
import { hasTantivyAdapter } from '../../../src/retrieval/sparse/providers/tantivy-adapter.js';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import { createInMemorySearchPipeline, createAvailableDenseAnnProvider } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';
import { createRetrievalStageTracker } from '../../../src/retrieval/pipeline/stage-checkpoints.js';
import { RETRIEVAL_SPARSE_UNAVAILABLE_CODE } from '../../../src/retrieval/sparse/requirements.js';

const originalLoad = Module._load;
let state = 'healthy', opens = 0, searches = 0;
const texts = ['alpha gamma', 'beta', 'gamma'];
const chunks = texts.map((text, id) => ({ id, file: `src/${id}.txt`, tokens: text.split(' '), phraseTokens: text.split(' ') }));
const sentinel = Object.assign(new Error('controlled native failure'), { code: 'ERR_CONTROLLED_NATIVE' });
const api = { openIndex() {
  assert.equal(this, api, 'native API receiver survives adapter admission');
  opens += 1; if (state === 'open-failure') throw sentinel; return {};
}, search(_handle, query, limit) {
  assert.equal(this, api); searches += 1;
  if (state === 'query-failure') throw sentinel;
  if (state === 'cancelled') throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
  if (state === 'healthy-empty') return [];
  return texts.flatMap((text, id) => query.split(' ').some(token => text.split(' ').includes(token))
    ? [{ idx: id, score: 3 - id }] : []).slice(0, limit);
} };
Module._load = function (name, ...args) { return name === 'tantivy' ? api : originalLoad.call(this, name, ...args); };
const index = () => ({ chunkMeta: chunks.map(row => ({ ...row })), tantivy: { available: true, dir: 'selected-generation' },
  denseVec: { dims: 1, minVal: 0, maxVal: 1, levels: 256, scale: 1 / 255, vectors: [[0], [255], [0]] } });
const planned = (query, fileFilter) => buildQueryPlan({ query, argv: {}, dict: new Set(), dictConfig: {},
  postingsConfig: { enablePhraseNgrams: false }, fileFilter, fileChargramN: 3 });
const pipeline = (query, { backend = 'tantivy', fileFilter, overrides = {}, provider, stageTracker } = {}) => {
  const plan = planned(query, fileFilter);
  return createInMemorySearchPipeline({ query, queryTokens: plan.queryTokens, filters: plan.filters,
    filtersActive: plan.filtersActive, topN: 10, provider, stageTracker,
    overrides: { annEnabled: false, sparseBackend: backend, queryAst: plan.queryAst, ...overrides } });
};
try {
  assert.equal(hasTantivyAdapter({ openIndex: true, search: () => [] }), false);
  assert.equal(hasTantivyAdapter({ openIndex: () => ({}), search: true }), false);
  for (const [query, expected] of [['NOT gamma', [1]], ['alpha OR NOT gamma', [0, 1]],
    ['NOT NOT alpha', [0]], ['alpha', [0]], ['NOT gamma AND NOT beta', []]]) {
    for (const backend of ['tantivy', 'auto']) {
      const hits = await pipeline(query, { backend })(index(), 'code', null);
      assert.deepEqual(hits.map(hit => hit.id).sort((a, b) => a - b), expected, `${backend}: ${query}`);
      assert.equal(hits.executionOutcome.cacheable, true);
      if (query === 'alpha OR NOT gamma') { assert.equal(hits[0].id, 0); assert.equal(hits[1].sparseScore, 0); }
    }
  }
  assert.deepEqual((await pipeline('alpha OR NOT gamma', { fileFilter: 'src/1.txt' })(index(), 'prose', null)).map(hit => hit.id), [1]);
  assert.deepEqual(await pipeline('alpha OR NOT gamma', { fileFilter: 'missing.txt' })(index(), 'code', null), []);
  const direct = createTantivyProvider(), directInput = { idx: index(), queryTokens: ['alpha'], mode: 'code', topN: 10 };
  const before = { opens, searches };
  assert.deepEqual(direct.search({ ...directInput, allowedIds: new Set() }).hits, []);
  assert.deepEqual({ opens, searches }, before);
  const work = {};
  direct.search({ ...directInput, work }); assert.deepEqual(work, {}, 'positive-only searches never enumerate the complement domain');
  for (const failure of ['open-failure', 'query-failure']) {
    state = failure;
    assert.throws(() => createTantivyProvider().search(directInput), error => error === sentinel);
    const tracker = createRetrievalStageTracker({ enabled: true });
    await assert.rejects(pipeline('alpha', { stageTracker: tracker })(index(), 'code', null), { code: 'CAPABILITY_MISSING' });
    const diagnostic = tracker.stages.find(stage => stage.stage === 'candidates').fts.diagnostics
      .find(row => row.code === RETRIEVAL_SPARSE_UNAVAILABLE_CODE);
    assert.equal(diagnostic.provider, 'tantivy'); assert.equal(diagnostic.failureCode, sentinel.code);
    let annCalls = 0;
    const provider = createAvailableDenseAnnProvider(async () => { annCalls += 1; return [{ idx: 1, sim: 0.9 }]; });
    for (const allowFallback of [false, true]) {
      const hits = await pipeline('alpha', { provider, overrides: { annEnabled: !allowFallback,
        profilePolicyByMode: allowFallback ? { code: { allowSparseFallback: true } } : null } })(index(), 'code', [1]);
      assert.deepEqual(hits.map(hit => hit.id), [1]);
      assert.equal(hits.executionOutcome.cacheable, false);
      assert.ok(hits.executionOutcome.reasons.includes('sparse-provider-failure'));
    }
    assert.equal(annCalls, 2, 'ANN execution is explicit or policy-admitted');
  }
  state = 'healthy-empty';
  assert.deepEqual(createTantivyProvider().search(directInput).hits, []);
  state = 'cancelled';
  await assert.rejects(pipeline('alpha')(index(), 'code', null), { name: 'AbortError' });
  state = 'healthy';
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pipeline('alpha', { overrides: { signal: controller.signal } })(index(), 'code', null), { code: 'CANCELLED', cancelled: true });
} finally { Module._load = originalLoad; }
console.log('Tantivy Boolean completion and genuine native failures retain eligibility, cancellation and fallback authority.');

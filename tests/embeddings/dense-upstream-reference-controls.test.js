import assert from 'node:assert/strict';
import { scalarDenseReference, resolveDenseReferenceRecipe, assertDenseReferenceManifest, createDenseUpstreamReference,
  compareDenseReferenceVectors, denseReferenceQuery } from './helpers/dense-upstream-reference.js';
import { loadDenseJudgedCorpus, summarizeDenseJudgments } from './helpers/dense-judged-corpus.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const m3 = resolveDenseReferenceRecipe('Xenova/bge-m3'), e5 = resolveDenseReferenceRecipe('intfloat/multilingual-e5-large-instruct');
assert.equal(resolveDenseReferenceRecipe('onnx-community/embeddinggemma-2-ONNX'), null);
assert.equal(resolveDenseReferenceRecipe('BAAI/bge-m3'), null);
assert.equal(resolveDenseReferenceRecipe('Xenova/multilingual-e5-large'), null);
assert.equal(denseReferenceQuery(m3, '查找绑定'), '查找绑定');
assert.equal(denseReferenceQuery(e5, '查找绑定'),
  'Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query\nQuery: 查找绑定');
const backing = new Float32Array(2 * 3 * 1024 + 8); backing.fill(Infinity, backing.length - 8);
const hidden = { type: 'float32', dims: [2, 3, 1024], data: backing.subarray(0, 2 * 3 * 1024) };
hidden.data[0] = 3; hidden.data[1] = 4; hidden.data[1024] = 5; hidden.data[1025] = 12; hidden.data[2048] = 999;
hidden.data[3072] = 1; hidden.data[4096 + 1] = 1; hidden.data[5120] = 999;
const mask = { type: 'int64', dims: [2, 3], data: BigInt64Array.of(1n, 1n, 0n, 1n, 1n, 0n) };
const cls = scalarDenseReference({ hidden, mask, count: 2, recipe: m3 });
const mean = scalarDenseReference({ hidden, mask, count: 2, recipe: e5 });
assert(Math.abs(cls.vectors[0][0] - 0.6) < 1e-6); assert.equal(cls.vectors[1][0], 1);
assert(Math.abs(mean.vectors[0][0] - 1 / Math.sqrt(5)) < 1e-6);
assert(Math.abs(mean.vectors[1][0] - 1 / Math.sqrt(2)) < 1e-6);
assert.deepEqual(mean.tokenCounts, [2, 2]);
assert.throws(() => compareDenseReferenceVectors(cls.vectors, mean.vectors, 1e-5));
compareDenseReferenceVectors(cls.vectors, cls.vectors, 1e-5);
for (const [key, value] of [['dims', [2, 1024]], ['dims', [3, 2, 1024]], ['dims', [2, 3, 1023]],
  ['data', hidden.data.subarray(0, hidden.data.length - 1)], ['type', 'float64']]) {
  assert.throws(() => scalarDenseReference({ hidden: { ...hidden, [key]: value }, mask, count: 2, recipe: m3 }));
}
for (const values of [[0n, 1n, 0n, 1n, 1n, 0n], [1n, 2n, 0n, 1n, 1n, 0n], [0n, 0n, 0n, 1n, 1n, 0n]]) {
  assert.throws(() => scalarDenseReference({ hidden, mask: { ...mask, data: BigInt64Array.from(values) }, count: 2, recipe: m3 }));
}
for (const value of [NaN, Infinity]) {
  const malformed = { ...hidden, data: new Float32Array(hidden.data) }; malformed.data[1024] = value;
  assert.throws(() => scalarDenseReference({ hidden: malformed, mask, count: 2, recipe: m3 }));
}
assert.throws(() => scalarDenseReference({ hidden: { ...hidden, data: new Float32Array(hidden.data.length) }, mask, count: 2, recipe: e5 }));
const manifestFor = recipe => ({ provider: 'xenova', modelId: recipe.modelId, exportRevision: recipe.revision,
  dimensions: 1024, normalize: true, tolerance: 1e-5, modelProfile: null, onnxConfig: null, modelsDir: 'metadata-only-no-native-model',
  runtime: { transformers: '4.3.2' }, artifacts: [...recipe.artifacts, ...['config.json', 'tokenizer.json', 'tokenizer_config.json']
    .map(path => ({ path, bytes: 2, sha256: 'a'.repeat(64) }))] });
for (const recipe of [m3, e5]) {
  const manifest = manifestFor(recipe); assertDenseReferenceManifest(manifest);
  for (const overrides of [{ exportRevision: 'f'.repeat(40) }, { tolerance: 1e-4 }, { normalize: false },
    { artifacts: manifest.artifacts.filter(row => !row.path.endsWith('.onnx')) }, { modelProfile: {} }]) {
    assert.throws(() => assertDenseReferenceManifest({ ...manifest, ...overrides }));
  }
  const originalConfig = Object.freeze({ model_type: 'xlm-roberta', hidden_size: 1024 });
  const calls = [], closed = [], tensorCloses = [];
  const tensor = (name, value) => ({ ...value, dispose() { tensorCloses.push(name); if (this.data instanceof Float32Array) this.data.fill(NaN); } });
  const tokenizer = Object.assign((texts, options) => {
    assert.deepEqual(options, { padding: true, truncation: true, max_length: recipe.maxLength });
    return { input_ids: tensor('ids', { type: 'int64', dims: [2, 3], data: BigInt64Array.of(0n, 2n, 1n, 0n, 2n, 1n) }),
      attention_mask: tensor('mask', { ...mask, data: new BigInt64Array(mask.data) }) };
  }, { dispose() { closed.push('tokenizer'); } });
  const model = Object.assign(async () => ({ last_hidden_state: tensor('hidden', { ...hidden, data: new Float32Array(hidden.data) }),
    pooler_output: tensor('unused-pooled', { type: 'float32', dims: [2, 1024], data: new Float32Array(2048) }) }),
  { dispose() { closed.push('model'); } });
  const mod = { env: { version: '4.3.2' },
    AutoConfig: { from_pretrained: async (id, options) => { calls.push(['config', id, options]); return originalConfig; } },
    AutoTokenizer: { from_pretrained: async (id, options) => { calls.push(['tokenizer', id, options]); return tokenizer; } },
    AutoModel: { from_pretrained: async (id, options) => { calls.push(['model', id, options]); return model; } } };
  const reference = await createDenseUpstreamReference({ transformers: mod, manifest });
  const vectors = await reference.embed(['first', '第二段']);
  compareDenseReferenceVectors(vectors.vectors, recipe === m3 ? cls.vectors : mean.vectors, 1e-5);
  assert.deepEqual(new Set(tensorCloses), new Set(['ids', 'mask', 'hidden', 'unused-pooled']));
  assert.equal(originalConfig['transformers.js_config'], undefined);
  for (const [, id, options] of calls) {
    assert.equal(id, recipe.modelId); assert.equal(options.local_files_only, true);
    assert.equal(options.revision, recipe === e5 ? e5.revision : undefined);
  }
  assert.equal(calls[2][2].dtype, recipe.dtype);
  if (recipe === e5) assert.equal(calls[2][2].use_external_data_format, true);
  model.dispose = () => assert.fail('retain original raw model disposer');
  await reference.close(); assert.deepEqual(closed, ['model', 'tokenizer']);

  for (const abortAt of ['tokenizer', 'model']) {
    const controller = new AbortController(), cancelledCloses = [];
    const cancelled = { ...mod,
      AutoTokenizer: { from_pretrained: async () => {
        if (abortAt === 'tokenizer') controller.abort();
        return Object.assign(() => ({}), { dispose() { cancelledCloses.push('tokenizer'); } });
      } }, AutoModel: { from_pretrained: async () => {
        controller.abort(); return Object.assign(async () => ({}), { dispose() { cancelledCloses.push('model'); } });
      } } };
    await assert.rejects(createDenseUpstreamReference({ transformers: cancelled, manifest, signal: controller.signal }), { name: 'AbortError' });
    assert.deepEqual(cancelledCloses, abortAt === 'tokenizer' ? ['tokenizer'] : ['model', 'tokenizer']);
  }
  const malformedCloses = [];
  const malformed = {
    ...mod,
    AutoTokenizer: { from_pretrained: async () => Object.assign((...args) => tokenizer(...args),
      { dispose() { malformedCloses.push('tokenizer'); } }) },
    AutoModel: { from_pretrained: async () => Object.assign(async () => ({
      last_hidden_state: { type: 'float32', dims: [2, 1024], data: new Float32Array(2048), dispose() { malformedCloses.push('tensor'); } }
    }), { dispose() { malformedCloses.push('model'); } }) }
  };
  const invalidReference = await createDenseUpstreamReference({ transformers: malformed, manifest });
  try { await assert.rejects(invalidReference.embed(['first', '第二段']), { code: 'ERR_ASSERTION' }); }
  finally { await invalidReference.close(); }
  assert.deepEqual(malformedCloses, ['tensor', 'model', 'tokenizer'], 'a rejected output is still closed before component cleanup');
}
const corpus = await loadDenseJudgedCorpus();
assert.equal(corpus.documents.length, 16); assert.equal(corpus.queries.length, 8);
const vector = family => Array.from({ length: 8 }, (value, index) => Number(index === family));
const documents = corpus.documents.map((row, index) => ({ id: row.id, vector: vector(Math.floor(index / 4) + (index % 4 >= 2 ? 4 : 0)) }));
const queries = corpus.queries.map((row, index) => ({ id: row.id, vector: vector(Math.floor(index / 2)) }));
const summary = summarizeDenseJudgments({ corpus, referenceDocuments: documents, candidateDocuments: documents,
  referenceQueries: queries, candidateQueries: queries });
assert.equal(summary.reports.length, 9);
for (const row of summary.reports) {
  assert.equal(row.judgedQueries, row.language === 'all' ? 8 : 4);
  assert.equal(row.candidateMetrics.mrrAtK, 1);
  assert.equal(row.candidateMetrics.recallAtK, row.k === 1 ? 0.5 : 1);
  assert.equal(row.candidateMetrics.ndcgAtK, 1);
  assert.equal(row.meanOverlapAtK, 1);
}
assert.throws(() => summarizeDenseJudgments({ corpus, referenceDocuments: documents, candidateDocuments: documents,
  referenceQueries: queries.slice(1), candidateQueries: queries.slice(1) }));
const changed = summarizeDenseJudgments({ corpus, referenceDocuments: documents, candidateDocuments: documents,
  referenceQueries: queries, candidateQueries: queries.map((row, index) => ({ ...row, vector: vector((Math.floor(index / 2) + 1) % 4) })) });
assert(changed.reports.find(row => row.language === 'all' && row.k === 1).candidateMetrics.mrrAtK < 1,
  'candidate queries must be used for candidate rankings;paired reference queries cannot hide a model error');
console.log('Independent dense-reference arithmetic, ownership and frozen judged-corpus controls passed; no real-model qualification implied.');

import assert from 'node:assert/strict';
import { serialize } from 'node:v8';
import { createOrderedTokenizeBatchWindow, executeTokenizeBatch, TOKENIZE_BATCH_MAX_CHUNKS,
  TOKENIZE_BATCH_MAX_OUTPUT_BYTES, TOKENIZE_BATCH_RESULT_VERSION } from '../../../src/index/build/workers/tokenize-batch.js';
import { createTokenizationContext, createTokenizationBuffers, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createProcessChunksFixtureContext, processFixtureChunks, createDisabledAnalysisPolicy } from './process-chunks-fixture.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const input = text => ({ text, mode: 'code', ext: '.js', languageId: 'javascript' });
const rows = Array.from({ length: 25 }, (_, index) => input(`const word${index} = ${index};`));
const tokenize = row => ({ tokens: [row.text] });
const make = (overrides = {}) => {
  const metrics = {};
  const window = createOrderedTokenizeBatchWindow({ count: rows.length, getInput: index => rows[index], metrics,
    runSingle: async row => tokenize(row), runBatch: async payload => executeTokenizeBatch(payload, tokenize), ...overrides });
  return { window, metrics };
};
{
  const { window, metrics } = make();
  for (const index of [0, 8, 16, 24]) {
    assert.deepEqual(await window.take(index, rows[index]), tokenize(rows[index]));
    assert.ok(metrics.retainedChunks < TOKENIZE_BATCH_MAX_CHUNKS, 'skipped chunks cannot accumulate previous windows');
  }
  assert.ok(metrics.retainedChunksHighWater < TOKENIZE_BATCH_MAX_CHUNKS);
  assert.equal(metrics.retainedChunks, 0);
}
{
  const { window } = make();
  await window.take(0, rows[0]);
  const original = rows[1].text;
  rows[1].text = 'const changed = true;';
  assert.deepEqual(await window.take(1, rows[1]), tokenize(rows[1]), 'lookahead binds the submitted source snapshot');
  rows[1].text = original;
}
for (const [reason, corrupt] of [
  ['version', batch => { batch.version = TOKENIZE_BATCH_RESULT_VERSION + 1; }],
  ['source-policy', batch => { batch.inputIdentity = '0'.repeat(64); }],
  ['source-policy', batch => { batch.inputBytes++; }],
  ['membership', batch => { batch.results.pop(); }],
  ['encoded-output', batch => { batch.results[0] = { ok: true, value: {} }; }],
  ['encoded-output', batch => { batch.results[0] = new Uint8Array(new SharedArrayBuffer(4)); }],
  ['cloneable-output', batch => { batch.results[0] = Buffer.from('corrupt'); batch.outputBytes = batch.results.reduce((sum, row) => sum + row.length, 0); }],
  ['output-bytes', batch => { batch.outputBytes = 0; }]
]) {
  const { window, metrics } = make({ runBatch: async payload => {
    const batch = executeTokenizeBatch(payload, tokenize); corrupt(batch); return batch;
  } });
  await assert.rejects(window.take(0, rows[0]), error => error.code === 'ERR_TOKENIZE_BATCH_PROTOCOL' && error.reason === reason);
  assert.equal(metrics.retainedChunks, 0, 'rejected receipts cannot retain future rows');
}
{
  const { window, metrics } = make({ runBatch: async payload => {
    const batch = executeTokenizeBatch(payload, tokenize);
    batch.results[0] = serialize({ ok: true, value: { tokens: ['x'.repeat(TOKENIZE_BATCH_MAX_OUTPUT_BYTES + 1)] } });
    return batch;
  } });
  await assert.rejects(window.take(0, rows[0]), { code: 'ERR_TOKENIZE_BATCH_BUDGET' });
  assert.equal(metrics.retainedChunks, 0, 'actual serialized output is checked before caching');
}
{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { window } = make({ runBatch: async payload => { await gate; return executeTokenizeBatch(payload, tokenize); } });
  const pending = window.take(0, rows[0]);
  await assert.rejects(window.take(1, rows[1]), error => error.reason === 'single-outstanding-window');
  release(); await pending;
}
{
  const controller = new AbortController();
  const { window, metrics } = make({ signal: controller.signal });
  await window.take(0, rows[0]); controller.abort();
  await assert.rejects(window.take(1, rows[1]), { name: 'AbortError' });
  assert.equal(metrics.retainedChunks, 0);
}

// The actual chunk consumer rejects the receipt before accepting poisoned
// member data, then follows its existing bounded inline fallback for the file.
const text = rows.slice(0, 10).map(row => row.text + '\n').join('');
let offset = 0;
const sc = rows.slice(0, 10).map((row, index) => {
  const start = offset; offset += row.text.length + 1;
  return { start, end: offset, kind: 'code', name: `chunk${index}`,
    segment: { languageId: 'javascript', segmentUid: 'segment', start: 0, end: text.length } };
});
const tokenContext = createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} });
const buffers = createTokenizationBuffers();
const tokenizeReal = row => tokenizeChunkText({ ...row, context: tokenContext, buffers });
let calls = 0;
const fixture = createProcessChunksFixtureContext({ text, analysisPolicy: createDisabledAnalysisPolicy(),
  riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc,
    workerState: { tokenWorkerDisabled: false }, workerPool: { shouldUseForFile: () => true,
      tokenizeChunk: async row => tokenizeReal(row), tokenizeBatch: async payload => {
        calls++;
        const batch = executeTokenizeBatch(payload, tokenizeReal);
        batch.results[0] = serialize({ ok: true, value: { tokens: ['poisoned-worker-row'] } }); batch.outputBytes = 0;
        return batch;
      } } } });
const processed = await processFixtureChunks(fixture.context);
const inline = createProcessChunksFixtureContext({ text, analysisPolicy: createDisabledAnalysisPolicy(),
  riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc: structuredClone(sc) } });
const expected = await processFixtureChunks(inline.context);
assert.deepEqual(processed.chunks.map(row => row.tokens), expected.chunks.map(row => row.tokens));
assert.equal(calls, 1);
assert.equal(fixture.context.workerState.tokenWorkerDisabled, true);
assert.equal(fixture.context.tokenizationStats.workerBatch.retainedChunks, 0);
console.log('token batch receipts bind source and policy, measure output and retire skipped lookahead rows');

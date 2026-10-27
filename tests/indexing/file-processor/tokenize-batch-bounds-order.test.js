import assert from 'node:assert/strict';
import { deserialize } from 'node:v8';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createOrderedTokenizeBatchWindow, executeTokenizeBatch, validateTokenizeBatch,
  TOKENIZE_BATCH_MAX_CHUNKS, TOKENIZE_BATCH_MAX_TEXT_BYTES } from '../../../src/index/build/workers/tokenize-batch.js';
import { createTokenizationContext, createTokenizationBuffers, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createProcessChunksFixtureContext, processFixtureChunks, createDisabledAnalysisPolicy } from './process-chunks-fixture.js';
ensureTestingEnv(process.env);
const policy = { mode: 'code', ext: '.js', languageId: 'javascript' };
const input = text => ({ ...policy, text });
const tokenContext = createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} });
const scratch = createTokenizationBuffers();
const tokenize = row => tokenizeChunkText({ ...row, context: tokenContext, buffers: scratch });
const payload = { items: [input('const Alpha = 1;'), input(''), input('const beta = "two";')] };
const batch = executeTokenizeBatch(payload, tokenize);
const decoded = batch.results.map(row => deserialize(row));
assert.deepEqual(decoded.map(row => row.value), payload.items.map(row => tokenize(row)));
const retained = decoded[0].value.tokens.slice();
tokenize(input('changed scratch contents'));
assert.deepEqual(deserialize(batch.results[0]).value.tokens, retained);
assert.throws(() => validateTokenizeBatch({ items: Array.from({ length: TOKENIZE_BATCH_MAX_CHUNKS + 1 }, () => input('x')) }), { code: 'ERR_TOKENIZE_BATCH_BUDGET' });
assert.throws(() => validateTokenizeBatch({ items: [input('é'.repeat(TOKENIZE_BATCH_MAX_TEXT_BYTES))] }), { code: 'ERR_TOKENIZE_BATCH_BUDGET' });
assert.throws(() => validateTokenizeBatch({ items: [input('x'), { ...input('y'), languageId: 'python' }] }), { code: 'ERR_TOKENIZE_BATCH_BUDGET' });
assert.throws(() => validateTokenizeBatch({ items: [{ ...input('x'), dictConfig: { segmentation: 'x'.repeat(129) } }] }), { code: 'ERR_TOKENIZE_BATCH_BUDGET' });
const inputs = Array.from({ length: 21 }, (_, index) => input(`word${index}`));
const metrics = {}; let calls = 0;
const window = createOrderedTokenizeBatchWindow({ count: inputs.length, getInput: index => inputs[index], metrics,
  runSingle: async row => tokenize(row), runBatch: async rows => { calls += 1; return executeTokenizeBatch(rows, tokenize); } });
for (let index = 0; index < inputs.length; index += 1) assert.deepEqual(await window.take(index, inputs[index]), tokenize(inputs[index]));
assert.equal(calls, 3);
assert.equal(metrics.retainedChunks, 0);
assert.ok(metrics.retainedChunksHighWater < TOKENIZE_BATCH_MAX_CHUNKS);
const failureWindow = createOrderedTokenizeBatchWindow({ count: 3, getInput: index => payload.items[index],
  runSingle: async row => tokenize(row), runBatch: async rows => executeTokenizeBatch(rows, row => {
    if (!row.text) throw new Error('one member failed'); return tokenize(row);
  }) });
assert.deepEqual(await failureWindow.take(0, payload.items[0]), decoded[0].value);
await assert.rejects(failureWindow.take(1, payload.items[1]), /one member failed/);
assert.deepEqual(await failureWindow.take(2, payload.items[2]), decoded[2].value);
const abort = new AbortController();
const canceled = createOrderedTokenizeBatchWindow({ count: 3, signal: abort.signal, getInput: index => payload.items[index],
  runSingle: async () => assert.fail('aborted batch cannot retry inline'), runBatch: async rows => {
    abort.abort(new Error('stop batch')); return executeTokenizeBatch(rows, tokenize);
  } });
await assert.rejects(canceled.take(0, payload.items[0]), { name: 'AbortError' });
const mismatch = createOrderedTokenizeBatchWindow({ count: 3, getInput: index => payload.items[index],
  runSingle: async row => tokenize(row), runBatch: async rows => executeTokenizeBatch(rows, tokenize) });
await mismatch.take(0, payload.items[0]);
assert.deepEqual(await mismatch.take(1, input('changed transform')), tokenize(input('changed transform')));

const lines = Array.from({ length: 20 }, (_, index) => `const value${index} = ${index};\n`);
const text = lines.join('');
let offset = 0;
const sc = lines.map((line, index) => {
  const row = { start: offset, end: offset + line.length, kind: 'code', name: 'chunk' + index,
    segment: { languageId: 'javascript', segmentUid: 'segment', start: 0, end: text.length } };
  offset += line.length; return row;
});
let batchCalls = 0;
const fixture = createProcessChunksFixtureContext({ text, analysisPolicy: createDisabledAnalysisPolicy(),
  riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc,
    workerState: { tokenWorkerDisabled: false }, workerPool: { shouldUseForFile: () => true,
      tokenizeChunk: async row => tokenize(row), tokenizeBatch: async rows => {
        batchCalls += 1; return executeTokenizeBatch(rows, tokenize);
      } } } });
const processed = await processFixtureChunks(fixture.context);
const inline = createProcessChunksFixtureContext({ text, analysisPolicy: createDisabledAnalysisPolicy(),
  riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc: structuredClone(sc) } });
const clean = await processFixtureChunks(inline.context);
const project = result => result.chunks.map(row => ({ start: row.start, end: row.end, tokens: row.tokens,
  tokenIds: row.tokenIds, seq: row.seq, minhashSig: row.minhashSig, tokenStats: row.tokenStats,
  phraseTokens: row.phraseTokens, phraseTokensCasePreserved: row.phraseTokensCasePreserved }));
assert.deepEqual(project(processed), project(clean));
assert.equal(batchCalls, 3, 'production chunk loop submits bounded lookahead batches');
assert.ok(fixture.context.tokenizationStats.workerBatch.batchTextBytesHighWater <= TOKENIZE_BATCH_MAX_TEXT_BYTES);
console.log('bounded token batches preserve ordered independent products, member failures and cancellation');

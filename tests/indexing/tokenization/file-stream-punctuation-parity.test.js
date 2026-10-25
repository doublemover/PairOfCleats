import assert from 'node:assert/strict';
import { createFileLineTokenStream, createTokenizationContext, sliceFileLineTokenStream,
  tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { appendChunk, createIndexState } from '../../../src/index/build/state.js';
import { PUNCTUATION_TOKEN_LIMIT } from '../../../src/shared/tokenize.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from '../file-processor/process-chunks-fixture.js';
import { createTokenizationEvidence } from '../../../src/index/build/file-processor/tokenization-evidence.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const context = createTokenizationContext({ dictWords: new Set(['request', 'response', 'build']), dictConfig: {}, postingsConfig: {} });
const cases = [
  { name: 'below', lines: [';'.repeat(9999), ','.repeat(9999)], truncated: false, emitted: 19998 },
  { name: 'exact', lines: [';'.repeat(10000), ','.repeat(10000)], truncated: false, emitted: 20000 },
  { name: 'over-two-lines', lines: [';'.repeat(10001), ','.repeat(10001)], truncated: true, emitted: 20000 },
  { name: 'over-one-line', lines: [';'.repeat(20001)], truncated: true, emitted: 20000 },
  { name: 'independent-later-range', lines: [';'.repeat(21000), ','.repeat(10001), ';'.repeat(10001)], start: 2, truncated: true, emitted: 20000 },
  { name: 'CRLF-identifiers', lines: ['const request = build(x);\r', ';'.repeat(10001) + '\r', ','.repeat(10001), 'return response;'], truncated: true, emitted: 20000 }
];
const keys = ['tokens', 'seq', 'tokenIds', 'minhashSig', 'stats'];
const sparse = { typed: false, fielded: false, enablePhraseNgrams: false, enableChargrams: false };
for (const entry of cases) {
  const text = entry.lines.join('\n'), startLine = entry.start || 1;
  const chunkText = entry.lines.slice(startLine - 1).join('\n');
  const stream = createFileLineTokenStream({ text, mode: 'code', ext: '.js', dictWords: context.dictWords, dictConfig: context.dictConfig });
  const pretokenized = sliceFileLineTokenStream({ stream, startLine, endLine: entry.lines.length });
  const direct = tokenizeChunkText({ text: chunkText, mode: 'code', ext: '.js', context });
  const reused = tokenizeChunkText({ text: chunkText, mode: 'code', ext: '.js', context, pretokenized });
  for (const key of keys) assert.deepEqual(reused[key], direct[key], entry.name + ': ' + key);
  assert.deepEqual(reused.stats.punctuation, { limit: PUNCTUATION_TOKEN_LIMIT, emitted: entry.emitted, truncated: entry.truncated });
  const states = [direct, reused].map(value => {
    const state = createIndexState({ postingsConfig: sparse });
    appendChunk(state, { ...value, file: 'fixture.js', docmeta: {}, weight: 1 }, sparse);
    return state;
  });
  assert.deepEqual(states[1].docLengths, states[0].docLengths);
  assert.deepEqual([...states[1].tokenPostings], [...states[0].tokenPostings], entry.name + ': exact TF postings');
  assert.equal(states[1].docLengths[0], direct.tokens.length);
  if (entry.name === 'over-two-lines') {
    assert.equal(reused.tokens.filter(token => token === ';').length, 10001);
    assert.equal(reused.tokens.filter(token => token === ',').length, 9999, 'the chunk-wide prefix owns the final allowance');
  }
}

const text = 'const request = build(x);\r\n' + ';'.repeat(10001) + '\r\n' + ','.repeat(10001);
const processed = [];
for (const fileStream of [false, true]) {
  const evidence = createTokenizationEvidence();
  const { context: processing } = createProcessChunksFixtureContext({ text,
    languageOptions: { tokenization: { fileStream } }, riskAnalysisEnabled: false, typeInferenceEnabled: false,
    overrides: { tokenizationStats: { chunks: 0, tokens: 0, seq: 0, routeObservations: evidence } } });
  const result = await processFixtureChunks(processing);
  assert.equal(result.chunks.length, 1);
  assert.equal(evidence.routes[fileStream ? 'pretokenized' : 'inline'], 1, 'exercise the actual exact-span file-stream selection');
  processed.push(result.chunks[0]);
}
for (const key of [...keys, 'phraseTokens']) assert.deepEqual(processed[1][key], processed[0][key], 'production route ' + key);
assert.equal(processed[1].stats.punctuation.truncated, true);
console.log('Direct and file-line tokenization share exact chunk punctuation admission, statistics and sparse postings.');

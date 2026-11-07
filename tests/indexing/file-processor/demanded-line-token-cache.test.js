import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { createDemandedLineTokenCache } from '../../../src/index/build/tokenization/demanded-line-cache.js';
import { buildTokenSequence } from '../../../src/index/build/tokenization/sequence.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { createProcessChunksFixtureContext, processFixtureChunks, createDisabledAnalysisPolicy } from './process-chunks-fixture.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const receipt = createHash('sha256').update('fixture dictionary revision one').digest('hex');
const policy = { mode: 'code', ext: '.js', languageId: 'javascript', dictWords: new Set(), dictConfig: {}, dictionaryReceipt: receipt };
const identity = text => ({ hash: createHash('sha256').update(text).digest('hex'), algorithm: 'sha256' });
const make = (text, options = {}) => {
  const calls = [], metrics = {};
  const cache = createDemandedLineTokenCache({ text, lineIndex: buildLineIndex(text), sourceIdentity: identity(text), metrics,
    tokenize: input => { calls.push(input.text); return buildTokenSequence(input); }, ...options });
  return { cache, calls, metrics, slice: (startLine, endLine = startLine, profile = {}) => cache.trySlice({ ...policy, ...profile, startLine, endLine }) };
};
const equalPayload = (fixture, text, first, last, profile = {}) => {
  const index = buildLineIndex(text), source = text.slice(index[first - 1], index[last] ?? text.length);
  const pretokenized = fixture.slice(first, last, profile);
  assert.ok(pretokenized, 'this control must use admitted line reuse');
  const input = { ...policy, ...profile, text: source };
  assert.deepEqual(pretokenized, buildTokenSequence(input), 'tokens, sequence and punctuation coverage match the exact chunk');
  const context = createTokenizationContext({ dictWords: input.dictWords, dictConfig: input.dictConfig, postingsConfig: {} });
  assert.deepEqual(tokenizeChunkText({ ...input, context, pretokenized }), tokenizeChunkText({ ...input, context }),
    'actual downstream token IDs, statistics and minhash retain their meaning');
};
const drained = fixture => {
  assert.equal(fixture.metrics.reservedBytes, 0);
  assert.equal(fixture.metrics.activeBytes, 0);
  assert.ok(fixture.metrics.peakWorkingBytes <= fixture.metrics.capacityBytes);
};

if (selected === 'sparse-overlap') {
  const lines = Array.from({ length: 5000 }, (_, i) => `const cfg${i} = init;`), text = lines.join('\n');
  const fixture = make(text);
  equalPayload(fixture, text, 2500, 2501);
  equalPayload(fixture, text, 2501, 2502);
  assert.deepEqual(fixture.calls, lines.slice(2499, 2502), 'only three demanded lines are prepared');
  assert.equal(fixture.metrics.reusedLines, 1);
  assert.equal(fixture.metrics.preparedChars, lines.slice(2499, 2502).reduce((n, line) => n + line.length, 0));
  drained(fixture); fixture.cache.close(); assert.equal(fixture.metrics.retainedBytes, 0);
} else if (selected === 'parity') {
  for (const text of ['cfg = init;\r\n\r\nmsg();\r\n', 'alpha βeta 😀\nnextLine();', '', 'x\n']) {
    for (const mode of ['code', 'prose']) {
      const fixture = make(text), lines = buildLineIndex(text).length;
      equalPayload(fixture, text, 1, lines, { mode });
      equalPayload(fixture, text, lines, lines, { mode });
      drained(fixture); fixture.cache.close();
    }
  }
} else if (selected === 'profile-identity') {
  const text = 'alphabeta cfg', dictWords = new Set(['alpha', 'beta']), fixture = make(text);
  const profiles = [{ mode: 'prose', ext: '.md', dictWords }, { mode: 'prose', ext: '.rst', dictWords },
    { mode: 'code', ext: '.rst', dictWords }, { mode: 'code', ext: '.rst', languageId: 'rust', dictWords },
    { mode: 'code', ext: '.rst', languageId: 'rust', dictWords, dictConfig: { segmentation: 'greedy' } },
    { mode: 'prose', ext: '.rst', dictWords, dictionaryReceipt: 'b'.repeat(64) },
    { mode: 'prose', ext: '.rst', dictWords: new Set(dictWords) }];
  for (const profile of profiles) equalPayload(fixture, text, 1, 1, profile);
  assert.equal(fixture.calls.length, profiles.length);
  assert.notDeepEqual(fixture.slice(1, 1, profiles[0]).tokens, fixture.slice(1, 1, profiles[1]).tokens);
  equalPayload(fixture, text, 1, 1, { ...profiles[0], ext: '.MD' });
  assert.equal(fixture.calls.length, profiles.length, 'case-normalized extension uses the same analyzer');
  dictWords.delete('alpha'); dictWords.delete('beta');
  equalPayload(fixture, text, 1, 1, { ...profiles[1], dictionaryReceipt: 'c'.repeat(64) });
  assert.equal(fixture.calls.length, profiles.length + 1, 'changed dictionary receipt cannot reuse the old product');
  const changed = make(text + ' changed'); equalPayload(changed, text + ' changed', 1, 1);
  assert.deepEqual(changed.calls, [text + ' changed']);
  fixture.cache.close(); changed.cache.close();
} else if (selected === 'admission') {
  for (const options of [{ maxBytes: 0 }, { maxEntries: 0 }, { maxBytes: 1 }]) {
    const fixture = make('alpha\nbeta', options);
    assert.equal(fixture.slice(1, 2), null); assert.equal(fixture.calls.length, 0); drained(fixture); fixture.cache.close();
  }
  for (const text of ['a'.repeat(8193), Array.from({ length: 129 }, () => 'x').join('\n')]) {
    const fixture = make(text);
    assert.equal(fixture.slice(1, buildLineIndex(text).length), null);
    assert.equal(fixture.calls.length, 0); drained(fixture); fixture.cache.close();
  }
  const unicode = make('é'.repeat(8192));
  assert.equal(unicode.slice(1), null, 'normalization expansion is admitted before preparing output');
  assert.equal(unicode.calls.length, 0); drained(unicode); unicode.cache.close();
} else if (selected === 'eviction-retirement') {
  const text = 'alpha\nbeta\ngamma', fixture = make(text, { maxEntries: 1 });
  for (const line of [1, 2, 1]) equalPayload(fixture, text, line, line);
  assert.deepEqual(fixture.calls, ['alpha', 'beta', 'alpha']);
  assert.equal(fixture.metrics.evictions, 2);
  fixture.cache.retireBefore(6); assert.equal(fixture.metrics.retainedBytes, 0);
  equalPayload(fixture, text, 3, 3); drained(fixture);
  fixture.cache.close(); assert.equal(fixture.metrics.closed, true); assert.equal(fixture.metrics.retainedBytes, 0);
  assert.throws(() => fixture.slice(1), /closed/u);
} else if (selected === 'cancellation') {
  const controller = new AbortController(); let calls = 0;
  const fixture = make('alpha\nbeta', { signal: controller.signal, tokenize: input => {
    calls++; controller.abort(new Error('cancel between demanded blocks')); return buildTokenSequence(input);
  } });
  assert.throws(() => fixture.slice(1, 2), { name: 'AbortError' });
  assert.equal(calls, 1); assert.equal(fixture.metrics.retainedBytes, 0); drained(fixture);
  assert.throws(() => fixture.slice(1), { name: 'AbortError' }); assert.equal(calls, 1); fixture.cache.close();
} else if (selected === 'producer-failure') {
  const failure = new Error('original line producer failed'); let calls = 0;
  const fixture = make('alpha\nbeta', { tokenize: input => { if (++calls === 2) throw failure; return buildTokenSequence(input); } });
  assert.throws(() => fixture.slice(1, 2), error => error === failure);
  assert.equal(fixture.metrics.retainedBytes, 0, 'no partial failed window is published'); drained(fixture);
  equalPayload(fixture, 'alpha\nbeta', 1, 2); assert.equal(calls, 4); fixture.cache.close();
  for (const tokens of [null, [42], ['x'.repeat(100000)]]) {
    const invalid = make('x', { tokenize: () => ({ tokens }) });
    assert.throws(() => invalid.slice(1), { code: 'ERR_LINE_TOKEN_CACHE_RESERVATION' });
    assert.equal(invalid.metrics.retainedBytes, 0); drained(invalid); invalid.cache.close();
  }
} else if (selected === 'closed-reentry') {
  let fixture;
  fixture = make('alpha', { tokenize: input => { assert.throws(() => fixture.slice(1), /reentrant/u);
    assert.throws(() => fixture.cache.retireBefore(0), /during preparation/u); fixture.cache.close(); return buildTokenSequence(input); } });
  assert.throws(() => fixture.slice(1), /closed during preparation/u);
  assert.equal(fixture.metrics.closed, true); assert.equal(fixture.metrics.retainedBytes, 0); drained(fixture);
} else if (selected === 'invalid-authority') {
  for (const options of [{ sourceIdentity: { hash: 'fake', algorithm: 'sha256' } }, { lineIndex: [0, 1] }, { lineIndex: [0] }]) {
    const fixture = make('a\nb\nc', options);
    assert.equal(fixture.slice(1), null); assert.equal(fixture.calls.length, 0); fixture.cache.close();
  }
  const fixture = make('alpha');
  assert.equal(fixture.slice(1, 1, { dictionaryReceipt: null }), null); assert.equal(fixture.calls.length, 0); fixture.cache.close();
} else if (['production-parity', 'production-fallback', 'production-cleanup'].includes(selected)) {
  const text = selected === 'production-fallback' ? '();'.repeat(7001) : 'const cfg = init;\nconst msg = cfg;\nconst err = msg;\n';
  const index = buildLineIndex(text), sc = selected === 'production-fallback' ? [{ start: 0, end: text.length, kind: 'code', name: 'large' }]
    : [{ start: 0, end: index[2], kind: 'code', name: 'first' },
      { start: index[1], end: text.length, kind: 'code', name: 'overlap' },
      { start: index[2] + 1, end: text.length - 1, kind: 'code', name: 'partial' }];
  const failure = new Error('original post-tokenization failure');
  const makeContext = fileStream => createProcessChunksFixtureContext({ text, analysisPolicy: createDisabledAnalysisPolicy(),
    riskAnalysisEnabled: false, typeInferenceEnabled: false, languageOptions: { tokenization: { fileStream } },
    overrides: { sc: structuredClone(sc), fileHash: identity(text).hash, fileHashAlgo: 'sha256', fileLineDictionaryReceipt: receipt,
      ...(selected === 'production-cleanup' && fileStream ? { addTokenizeDuration: () => { throw failure; } } : {}) } });
  const enabled = makeContext(true);
  if (selected === 'production-cleanup') await assert.rejects(processFixtureChunks(enabled.context), error => error === failure);
  else {
    const actual = await processFixtureChunks(enabled.context), expected = await processFixtureChunks(makeContext(false).context);
    assert.deepEqual(actual.chunks, expected.chunks, 'real file processing preserves complete chunk payloads');
    const postings = result => { const state = createIndexState(); for (const chunk of result.chunks) appendChunk(state, structuredClone(chunk)); return state; };
    assert.deepEqual(postings(actual), postings(expected), 'actual posting owner preserves TF, lengths and field/phrase/chargram postings');
    assert.equal(enabled.context.tokenizationStats.tokens, actual.chunks.reduce((n, chunk) => n + chunk.tokens.length, 0));
    if (selected === 'production-fallback') {
      assert.equal(enabled.context.tokenizationStats.fileLineReuse.preparedLines, 0);
      assert.ok(actual.chunks[0].tokens.length > 0);
    } else assert.equal(enabled.context.tokenizationStats.fileLineReuse.preparedLines, 3);
  }
  assert.equal(enabled.context.tokenizationStats.fileLineReuse.closed, true);
  assert.equal(enabled.context.tokenizationStats.fileLineReuse.retainedBytes, 0);
  assert.equal(enabled.context.tokenizationStats.fileLineReuse.reservedBytes, 0);
} else assert.fail(`Unknown demanded-line control: ${selected}`);
console.log(`demanded-line token cache ${selected} control`);

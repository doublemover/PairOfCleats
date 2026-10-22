import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createLexicalCheckpointSession } from '../../../src/index/build/incremental/lexical-checkpoint.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createProcessChunksFixtureContext, processFixtureChunks, createDisabledAnalysisPolicy } from '../file-processor/process-chunks-fixture.js';
ensureTestingEnv(process.env);
const dependencies = { lexical: 'lexical-policy', parse: 'parse-policy', enrichment: 'old-enrichment' };
const options = { dependencies, fileHash: 'a'.repeat(40), fileHashAlgo: 'sha1', policy: { classifier: 'fixed' } };
const context = createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} });
const payload = tokenizeChunkText({ text: 'const Alpha = beta;', mode: 'code', ext: '.js', languageId: 'javascript', context });
const source = createLexicalCheckpointSession(options);
const keyInput = { index: 0, start: 0, end: 19, text: 'const Alpha = beta;', mode: 'code', ext: '.js', languageId: 'javascript' };
const key = source.key(keyInput);
source.capture(0, key, payload, ['const', 'Alpha', 'beta'], null, null);
const cached = source.finish();
assert.equal(cached.rows.length, 1);
const metrics = {};
const session = createLexicalCheckpointSession({ ...options, cached, metrics,
  dependencies: { ...dependencies, enrichment: 'new-enrichment' } });
const replay = session.resolve(0, session.key(keyInput), null, null);
assert.deepEqual(replay.payload, payload);
assert.deepEqual(replay.phraseTokens, ['const', 'Alpha', 'beta']);
replay.payload.tokens.push('private mutation');
assert.deepEqual(cached.rows[0].payload.tokens, payload.tokens);
assert.equal(metrics.productHits, 1);
for (const change of [
  { fileHash: 'b'.repeat(40) }, { policy: { classifier: 'changed' } },
  { dependencies: { ...dependencies, lexical: 'changed' } }, { dependencies: { ...dependencies, parse: 'changed' } }
]) {
  const other = createLexicalCheckpointSession({ ...options, cached, ...change });
  assert.equal(other.resolve(0, other.key(keyInput), null, null), null);
}
assert.equal(session.resolve(0, session.key({ ...keyInput, text: 'const Beta = alpha;' }), null, null), null);
assert.notEqual(session.key({ ...keyInput, text: '\ud800' }), session.key({ ...keyInput, text: '\ud801' }));
const corrupt = structuredClone(cached); delete corrupt.rows[0].payload.tokenIds;
assert.equal(createLexicalCheckpointSession({ ...options, cached: corrupt }).resolve(0, key, null, null), null);
assert.equal(createLexicalCheckpointSession({ ...options, cached: { ...cached, version: 0 } }).resolve(0, key, null, null), null);
const state = { treeSitterEnabled: true, treeSitterDisabledReason: null, maxChunkBytes: 65536,
  maxFileBytes: 1048576, maxChunksPerFile: 2, maxBytesPerFile: 65536,
  remainingChunks: 2, remainingBytes: 65536, fileBytes: 19 };
const classified = { ...payload, identifierTokens: payload.tokens.slice(), keywordTokens: [], operatorTokens: [], literalTokens: [] };
const native = createLexicalCheckpointSession({ ...options, classificationEnabled: true, treeSitterEnabled: true });
const before = native.before(state);
const after = { ...state, remainingChunks: 1, remainingBytes: 65517 };
native.capture(0, key, classified, ['Alpha'], before, after);
const nativeReplay = createLexicalCheckpointSession({ ...options, cached: native.finish(), classificationEnabled: true, treeSitterEnabled: true });
const current = { ...state };
assert.equal(nativeReplay.resolve(0, key, nativeReplay.before(current), current).classificationReusable, true);
assert.deepEqual(current, after, 'cached native classification consumes the exact original budget transition');
assert.equal(nativeReplay.resolve(0, key, nativeReplay.before(current), current), null);
const fallback = createLexicalCheckpointSession({ ...options, classificationEnabled: true, treeSitterEnabled: true });
fallback.capture(0, key, classified, ['Alpha'], before, state);
const fallbackReplay = createLexicalCheckpointSession({ ...options, cached: fallback.finish(), classificationEnabled: true, treeSitterEnabled: true });
assert.equal(fallbackReplay.resolve(0, key, before, { ...state }).classificationReusable, false,
  'an unqualified native fallback recomputes classification while retaining complete base lexical products');

const text = 'const Alpha = beta;\nconst second = 2;\n';
const split = text.indexOf('\n') + 1;
const chunks = [{ start: 0, end: split, kind: 'code', name: 'first', segment: { languageId: 'javascript', segmentUid: 'one' } },
  { start: split, end: text.length, kind: 'code', name: 'second', segment: { languageId: 'javascript', segmentUid: 'one' } }];
const fixture = extra => createProcessChunksFixtureContext({ text, analysisPolicy: createDisabledAnalysisPolicy(),
  riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc: structuredClone(chunks),
    fileHash: options.fileHash, fileHashAlgo: 'sha1', lexicalCheckpointDependencies: dependencies, ...extra } }).context;
const coldContext = fixture({});
const cold = await processFixtureChunks(coldContext);
assert.equal(cold.lexicalCheckpoint.rows.length, 2);
const warmContext = fixture({ cachedLexicalCheckpoint: cold.lexicalCheckpoint,
  lexicalCheckpointDependencies: { ...dependencies, enrichment: 'changed' },
  workerState: { tokenWorkerDisabled: false }, workerPool: { shouldUseForFile: () => true,
    tokenizeChunk: async () => assert.fail('eligible full lexical replay cannot invoke worker tokenization') } });
const warm = await processFixtureChunks(warmContext);
assert.deepEqual(warm.chunks, cold.chunks);
assert.equal(warmContext.tokenizationStats.lexicalCheckpoint.productHits, 2);
const freshEnrichment = fixture({ cachedLexicalCheckpoint: cold.lexicalCheckpoint,
  lang: { id: 'javascript', extractDocMeta: () => ({ doc: 'new enrichment only' }) } });
const enriched = await processFixtureChunks(freshEnrichment);
assert.equal(freshEnrichment.tokenizationStats.lexicalCheckpoint.productHits, 2);
assert.equal(enriched.chunks[0].docmeta.doc, 'new enrichment only');
console.log('complete lexical checkpoints bind transformed content and policy without stale enrichment');

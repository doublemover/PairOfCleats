import assert from 'node:assert/strict';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { COMMENT_CONFIG_LIMITS } from '../../../src/index/comment-config.js';
import { buildCommentMeta } from '../../../src/index/build/file-processor/cpu/meta.js';
import { collectChunkComments } from '../../../src/index/build/file-processor/process-chunks/limits.js';
import { buildTokenSequence, countTokenSequence } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/segments/comment-work-admission/')[1];
const cases = ['code-no-config', 'extracted-config', 'code-config', 'block-boundary', 'block-over',
  'aggregate', 'candidate-count', 'invalid', 'tokens-clipped', 'token-count-parity'];
assert.ok(cases.includes(mode), `Unknown case ${mode}`);
const config = normalizeCommentConfig({ extract: 'all', minDocChars: 1, minInlineChars: 1, minTokens: 1,
  includeInCode: mode === 'code-config' });
const fence = value => '/**\n * ```json\n * ' + value + '\n * ```\n */\n';
const jsonBytes = bytes => '{"key":"' + 'x'.repeat(bytes - 10) + '"}';
const calls = [];
let text = fence('{"enabled":true}');
if (mode === 'block-boundary') text = fence(jsonBytes(COMMENT_CONFIG_LIMITS.blockBytes));
if (mode === 'block-over') text = fence(jsonBytes(COMMENT_CONFIG_LIMITS.blockBytes + 1));
if (mode === 'aggregate') text = fence(jsonBytes(COMMENT_CONFIG_LIMITS.blockBytes)).repeat(5);
if (mode === 'candidate-count') text = fence('{"enabled":true}').repeat(COMMENT_CONFIG_LIMITS.candidates + 4);
if (mode === 'invalid') text = fence('{invalid JSON}');
if (['code-no-config', 'extracted-config', 'code-config'].includes(mode)) {
  const common = { text, ext: '.js', languageId: 'javascript', lineIndex: buildLineIndex(text),
    normalizedCommentsConfig: config, tokenDictWords: new Set(), dictConfig: {}, onConfigParse: event => calls.push(event) };
  const meta = buildCommentMeta({ ...common, mode: mode === 'extracted-config' ? 'extracted-prose' : 'code' });
  assert.equal(calls.length, mode === 'code-no-config' ? 0 : 1);
  assert.equal(meta.extraSegments.filter(segment => segment.embeddingContext === 'config').length, calls.length);
  assert.equal(meta.commentConfigAdmission.state, mode === 'code-no-config' ? 'not-requested' : 'complete');
  assert.equal(meta.commentRanges.length, 1, 'config demand does not remove stripping/reference ranges');
} else if (['tokens-clipped', 'token-count-parity'].includes(mode)) {
  const dictionary = new Set(['foobar', 'baz']), dictConfig = { segmentation: 'greedy' };
  for (const ext of ['.js', '.py']) for (const sample of ['running running the', 'Foobarbaz Foobarbaz', '界😀 parser_words']) {
    const input = { text: sample, mode: 'prose', ext, dictWords: dictionary, dictConfig, includeSeq: false };
    assert.equal(countTokenSequence(input), buildTokenSequence(input).tokens.length);
  }
  assert.equal(countTokenSequence({ text: 'running running the', mode: 'prose', ext: '.js',
    dictWords: dictionary, dictConfig }), 4, 'duplicates and their stems each contribute; stopwords do not');
  const source = mode === 'tokens-clipped' ? '/* 界😀 running ' + 'running '.repeat(1000) + 'TAILMARKER */' : '/* running running the */';
  const tokenWork = [];
  const selectedConfig = { ...config, minTokens: mode === 'tokens-clipped' ? 1 : 4, maxBytesPerChunk: 12 };
  const meta = buildCommentMeta({ text: source, ext: '.js', languageId: 'javascript', lineIndex: buildLineIndex(source), mode: 'code',
    normalizedCommentsConfig: selectedConfig, tokenDictWords: dictionary, dictConfig,
    onCommentTokenization: event => tokenWork.push(event) });
  assert.equal(meta.commentEntries.length, 1);
  assert.equal(tokenWork.length, 1); assert.equal(tokenWork[0].retainedTokens, 0);
  assert.equal(Object.hasOwn(meta.commentEntries[0], 'tokens'), false);
  if (mode === 'token-count-parity') {
    assert.equal(meta.commentEntries[0].tokenCount, 4);
    const rejected = buildCommentMeta({ text: source, ext: '.js', languageId: 'javascript', lineIndex: buildLineIndex(source),
      mode: 'code', normalizedCommentsConfig: { ...selectedConfig, minTokens: 5 }, tokenDictWords: dictionary, dictConfig });
    assert.equal(rejected.commentEntries.length, 0); assert.equal(rejected.commentRanges.length, 1);
  } else {
    for (const chunkStart of [0, 2, 4]) {
      const collected = collectChunkComments({ assigned: meta.commentEntries, assignedRanges: meta.commentRanges, chunkMode: 'prose',
        normalizedCommentsConfig: selectedConfig, tokenDictWords: dictionary, dictConfig, effectiveExt: '.js', chunkStart,
        onTokenization: event => tokenWork.push(event) });
      const clipped = collected.docmetaPatch.comments[0].text;
      assert.ok(Buffer.byteLength(clipped) <= 12); assert.equal(clipped.includes('\uFFFD'), false);
      assert.equal(clipped.includes('TAILMARKER'), false);
      assert.deepEqual(collected.commentFieldTokens, buildTokenSequence({ text: clipped, mode: 'prose', ext: '.js',
        dictWords: dictionary, dictConfig, includeSeq: false }).tokens);
    }
    assert.equal(tokenWork.length, 4);
    assert.ok(tokenWork.slice(1).every(event => event.characters < 12 && event.bytes <= 12), 'overlapping consumers tokenize only their admitted UTF-8 prefixes');
    assert.ok(meta.commentEntries[0].text.length > 7000);
  }
} else {
  const extracted = extractComments({ text, ext: '.js', languageId: 'javascript', lineIndex: buildLineIndex(text), config,
    onConfigParse: event => calls.push(event) });
  const receipt = extracted.configAdmission;
  assert.equal(receipt.parserCalls, calls.length);
  if (mode === 'block-boundary') { assert.equal(calls.length, 1); assert.equal(calls[0].bytes, COMMENT_CONFIG_LIMITS.blockBytes); }
  if (mode === 'block-over') { assert.equal(calls.length, 0); assert.equal(receipt.exclusions[0].reason, 'candidate-byte-budget'); }
  if (mode === 'aggregate') {
    assert.equal(calls.length, 4); assert.equal(receipt.parsedBytes, COMMENT_CONFIG_LIMITS.fileBytes);
    assert.equal(receipt.exclusions[0].reason, 'aggregate-byte-budget');
  }
  if (mode === 'candidate-count') {
    assert.equal(calls.length, COMMENT_CONFIG_LIMITS.candidates);
    assert.equal(receipt.candidates, COMMENT_CONFIG_LIMITS.candidates + 1);
    assert.equal(receipt.exclusions[0].reason, 'candidate-count-budget');
    assert.equal(extracted.comments.length, COMMENT_CONFIG_LIMITS.candidates + 4, 'bounded config work retains independent comments');
  }
  if (mode === 'invalid') {
    assert.equal(calls.length, 1); assert.equal(receipt.invalid, 1); assert.deepEqual(receipt.exclusions, []);
    assert.equal(extracted.configSegments.length, 0); assert.equal(receipt.state, 'complete', 'invalid is distinct from budget omission');
  }
}
console.log(`Comment work admission: ${mode}`);

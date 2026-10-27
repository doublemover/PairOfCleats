import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { commentPolicyReceipt, COMMENT_CLASSIFICATION_VERSION } from '../../../src/index/comments-policy.js';
import { buildExtractedProseExtrasCacheKey, resolveExtractedProseCommentData } from '../../../src/index/build/file-processor/cpu/comment-data-cache.js';
import { buildCommentMeta } from '../../../src/index/build/file-processor/cpu/meta.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { chunkSegments } from '../../../src/index/segments.js';
import { tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { buildTokenizationKey, buildDependencySignatures } from '../../../src/index/build/indexer/signatures.js';

const text = '## Foobarbaz describes precise shared comment extraction semantics.\n';
const config = normalizeCommentConfig({ minDocChars: 1, minTokens: 1 });
const input = { text, ext: '.py', languageId: 'python', lineIndex: buildLineIndex(text), normalizedCommentsConfig: config,
  fileHash: crypto.createHash('sha256').update(text).digest('hex'), fileHashAlgo: 'sha256' };
const key = buildExtractedProseExtrasCacheKey(input);
assert.match(key, new RegExp(`^comments:${COMMENT_CLASSIFICATION_VERSION}\\|`));
assert.equal(commentPolicyReceipt(config).version, '5');
const legacy = `hash:sha256:${input.fileHash}|ext:.py|lang:python`;
assert.notEqual(key, legacy);
for (const changed of [{ includeLicense: true }, { minTokens: 99 }, { headerMaxLines: 1 }, { licensePattern: 'Foobarbaz' }]) {
  const other = normalizeCommentConfig({ minDocChars: 1, minTokens: 1, ...changed });
  assert.notEqual(buildExtractedProseExtrasCacheKey({ ...input, normalizedCommentsConfig: other }), key);
  assert.notEqual(buildTokenizationKey({ commentsConfig: other }, 'extracted-prose'), buildTokenizationKey({ commentsConfig: config }, 'extracted-prose'));
}
const globalConfig = normalizeCommentConfig({ licensePattern: /Foobarbaz/g });
const before = buildExtractedProseExtrasCacheKey({ ...input, normalizedCommentsConfig: globalConfig });
globalConfig.licensePattern.test('Foobarbaz');
assert.equal(buildExtractedProseExtrasCacheKey({ ...input, normalizedCommentsConfig: globalConfig }), before,
  'matcher cursor is not effective extraction policy');
assert.notEqual(buildDependencySignatures({ lintEnabled: false, commentsConfig: config }, 'extracted-prose').parse,
  buildDependencySignatures({ lintEnabled: false,
    commentsConfig: normalizeCommentConfig({ minDocChars: 1, minTokens: 1, includeLicense: true }) }, 'extracted-prose').parse);

const cache = new Map([[legacy, { commentEntries: [{ text: 'obsolete author tokens' }], extraSegments: [] }],
  [key, { key, data: { comments: [{ text: 'injected stale result' }], configSegments: [] } }]]);
const cold = resolveExtractedProseCommentData({ ...input, cache, key });
assert.equal(cold.comments.length, 1); assert.match(cold.comments[0].text, /Foobarbaz/);
assert.equal(Object.hasOwn(cold.comments[0], 'tokens'), false, 'cache holds source extraction, never dictionary-dependent tokens');
const stored = cache.get(key);
assert.ok(Object.isFrozen(stored.data.comments[0]));
assert.throws(() => { stored.data.comments[0].text = 'cache mutation'; }, TypeError);
cold.comments[0].text = 'consumer mutation';
const warm = resolveExtractedProseCommentData({ ...input, cache, key });
assert.match(warm.comments[0].text, /Foobarbaz/); assert.equal(cache.get(key), stored);
const fresh = resolveExtractedProseCommentData({ ...input, cache: new Map(), key });
assert.deepEqual(warm, fresh, 'stale author entries cannot determine cold/warm extraction');

const consume = (data, dictionary, selectedConfig = config) => buildCommentMeta({ ...input, mode: 'extracted-prose',
  normalizedCommentsConfig: selectedConfig, commentData: data, tokenDictWords: dictionary, dictConfig: { segmentation: 'greedy' } });
const split = consume(warm, new Set(['foobar', 'baz']));
const tokensFor = (meta, dictionary) => chunkSegments({ text, ext: '.py', relPath: 'fixture.py', mode: 'extracted-prose',
  segments: meta.extraSegments }).flatMap(chunk => tokenizeChunkText({ text: text.slice(chunk.start, chunk.end),
  mode: 'prose', ext: '.py', context: { dictWords: dictionary, dictConfig: { segmentation: 'greedy' } } }).tokens);
const splitTokens = tokensFor(split, new Set(['foobar', 'baz']));
assert.ok(splitTokens.includes('foobar')); assert.ok(splitTokens.includes('baz'));
const whole = consume(resolveExtractedProseCommentData({ ...input, cache, key }), new Set(['foobarbaz']));
const wholeTokens = tokensFor(whole, new Set(['foobarbaz']));
assert.ok(wholeTokens.includes('foobarbaz'));
assert.equal(wholeTokens.includes('foobar'), false,
  'paired raw-cache hit retokenizes using the consuming dictionary');
assert.ok(whole.commentEntries[0].tokenCount > 0);
assert.equal(Object.hasOwn(whole.commentEntries[0], 'tokens'), false, 'eligibility retains no unused full token array');
assert.equal(consume(fresh, new Set(), normalizeCommentConfig({ minTokens: 99 })).extraSegments.length, 0,
  'prepared raw data cannot bypass current token admission');
assert.equal(cache.get(key), stored, 'different tokenization consumers do not mutate the raw extraction owner');
console.log('Paired comment caching binds versioned policy and immutable source data, with fresh consumer tokenization.');

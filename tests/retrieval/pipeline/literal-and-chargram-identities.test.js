import assert from 'node:assert/strict';
import { CHARGRAM_HASH_META, forEachRollingChargramHash } from '../../../src/shared/chargram-hash.js';
import { createCandidateSetBuilder } from '../../../src/retrieval/pipeline/candidates.js';
import { analyzeLiteralText, TEXT_ANALYZER_VERSION } from '../../../src/shared/text-analyzer.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';
import { tokenizeQueryTerms } from '../../../src/retrieval/query-parse.js';

const mask = (1n << 64n) - 1n;
for (const [token, base, seed] of [['alphabet', 911382323n, 0x3c79ac492ba7b653n], ['longer-\ud83d\ude00-UTF16', 31n, 9n], ['ababa', 3n, 0n]]) {
  const source = `\u0002${token}\u0003`, expected = [], actual = [];
  for (let n = 1; n <= 5; n++) {
    for (let offset = 0; offset + n <= source.length; offset++) {
      let hash = 0n;
      for (let pos = offset; pos < offset + n; pos++) hash = (hash * base + BigInt(source.charCodeAt(pos))) & mask;
      expected.push(`h64:${((hash ^ seed) & mask).toString(16).padStart(16, '0')}`);
    }
  }
  forEachRollingChargramHash(token, 1, 5, { base, seed }, value => { actual.push(value); });
  assert.deepEqual(actual, expected, 'each rolling window equals a separately evaluated polynomial');
  const prefix = [];
  forEachRollingChargramHash(token, 1, 5, { base, seed }, value => { prefix.push(value); return prefix.length < 3; });
  assert.deepEqual(prefix, expected.slice(0, 3));
}
const grams = [];
forEachRollingChargramHash('alphabet', 3, 3, {}, gram => { grams.push(gram); });
const idx = { chargrams: { vocab: grams, postings: grams.map(() => [7]), fields: { hash: { ...CHARGRAM_HASH_META } } } };
const builder = createCandidateSetBuilder({ useSqlite: false, postingsConfig: { enablePhraseNgrams: false, chargramMinN: 3, chargramMaxN: 3 } });
assert.deepEqual([...builder(idx, ['alphabet'], 'code')], [7]);
idx.chargrams.fields.hash.version = 1;
assert.throws(() => builder(idx, ['alphabet'], 'code'), { code: 'ERR_CHARGRAM_ANALYZER_REBUILD' });
const literal = analyzeLiteralText('Café 한국어 FooBar', { caseSensitive: true });
const chunk = { id: 0, tokens: ['cafe', 'foo', 'bar'], phraseTokens: literal, phraseTokensCasePreserved: true };
for (const [phrase, caseSensitive, expected] of [['Café 한국어', true, true], ['cafe\u0301 한국어', false, true], ['café 한국어', true, false], ['Foo Bar', true, true]]) {
  const ast = { type: 'phrase', tokens: analyzeLiteralText(phrase, { caseSensitive }), caseSensitive };
  const helpers = createQueryAstHelpers({ queryAst: ast });
  assert.equal(helpers.matchesQueryAst({ chunkMeta: [chunk] }, 0, chunk), expected);
  const negative = createQueryAstHelpers({ queryAst: { type: 'not', child: ast } });
  assert.equal(negative.matchesQueryAst({ chunkMeta: [chunk] }, 0, chunk), !expected);
}
const stale = { ...chunk, phraseTokensCasePreserved: undefined };
const sensitive = createQueryAstHelpers({ queryAst: { type: 'phrase', tokens: ['Café'], caseSensitive: true } });
assert.throws(() => sensitive.matchesQueryAst({ chunkMeta: [stale] }, 0, stale), { code: 'ERR_LITERAL_ANALYZER_REBUILD' });
assert.equal(sensitive.matchesQueryAst({ chunkMeta: [stale], state: { features: { literalAnalyzer: TEXT_ANALYZER_VERSION } } }, 0, stale), true);
assert.ok(tokenizeQueryTerms(['Café'], new Set(), { caseSensitive: false }).includes('cafe'), 'literal NFC tokens remain separate from sparse NFKD scoring tokens');
console.log('literal and chargram identities passed');

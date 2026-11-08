import assert from 'node:assert/strict';
import { parseRustCommentOccurrences, RUST_COMMENT_LIMITS } from '../../../src/lang/rust-comments.js';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { buildCommentMeta } from '../../../src/index/build/file-processor/cpu/meta.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/segments/rust-comment-occurrences/')[1];
const doc = '/** Independently expected Rust documentation remains outside literal content. */';
const nested = '/* Outer useful commentary /* Inner useful commentary */ still outer text. */';
const cases = {
  nested: { source: nested + '\nfn live() {}', expected: [nested] },
  'raw-strings': { source: 'let a = r##"ignored "# /* still literal */ "##; let b = br#"// byte literal"#; let c = cr#"/* C literal */"#;\n' + doc, expected: [doc] },
  lifetimes: { source: "fn f<'a>(value: &'a str) -> &'a str { value }\n" + doc, expected: [doc] },
  characters: { source: "let slash = '/'; let quote = '\\''; let unicode = '\\u{754c}'; let byte = b'\\x2f';\n" + doc, expected: [doc] },
  'doc-roles': { source: ['/// Outer useful documentation', '//// Ordinary slash commentary', '//! Inner useful documentation',
    '/** Outer block documentation */', '/*** Ordinary star commentary */', '/*! Inner block documentation */'].join('\n'),
  expected: ['/// Outer useful documentation', '//// Ordinary slash commentary', '//! Inner useful documentation',
    '/** Outer block documentation */', '/*** Ordinary star commentary */', '/*! Inner block documentation */'] },
  'line-endings': { source: '// Ordinary comment includes CR\rlet remains_comment = true;\r\nlet live = 42;\n' + doc,
    expected: ['// Ordinary comment includes CR\rlet remains_comment = true;\r', doc] },
  'doc-crlf': { source: '/** Useful\r\n * original Rust documentation\r\n */', expected: ['/** Useful\r\n * original Rust documentation\r\n */'] },
  'doc-bare-cr': { source: '/// Invalid bare CR\rlet live = 42;', reason: 'rust-comment-bare-cr-in-doc' },
  'unterminated-block': { source: '/* outer /* inner */', reason: 'rust-comment-unterminated-block' },
  'unterminated-raw': { source: 'let a = r##"/* still raw */ "#;', reason: 'rust-comment-unterminated-raw-string' },
  'nesting-budget': { source: '/*'.repeat(RUST_COMMENT_LIMITS.nesting + 1), reason: 'rust-comment-nesting-budget' },
  'raw-hash-budget': { source: 'r' + '#'.repeat(RUST_COMMENT_LIMITS.hashes + 1) + '"bad"', reason: 'rust-comment-raw-string-hash-budget' },
  'raw-identifier': { source: 'fn r#type() { let a = r#type; }\n' + doc, expected: [doc] }
};
assert.ok(Object.hasOwn(cases, mode), `Unknown case ${mode}`);
const fixture = cases[mode], text = 'const PREFIX: &str = "界😀";\n' + fixture.source;
const product = parseRustCommentOccurrences(text);
assert.ok(Object.isFrozen(product)); assert.ok(Object.isFrozen(product.ranges));
if (fixture.reason) {
  assert.equal(product.complete, false); assert.equal(product.reason, fixture.reason); assert.deepEqual(product.ranges, []);
} else {
  assert.equal(product.complete, true); assert.equal(product.reason, null);
  assert.deepEqual(product.ranges.map(range => text.slice(range.start, range.end)), fixture.expected);
  for (const [index, raw] of fixture.expected.entries()) assert.equal(product.ranges[index].start, text.indexOf(raw));
}
const config = normalizeCommentConfig({ extract: 'all', minDocChars: 1, minInlineChars: 1, minTokens: 1 });
const input = { text, ext: '.rs', languageId: 'rust', lineIndex: buildLineIndex(text), config, commentOccurrences: product };
const extracted = extractComments(input);
if (fixture.reason) {
  assert.equal(extracted.coverage.state, 'unavailable'); assert.equal(extracted.coverage.reason, fixture.reason);
  assert.deepEqual(extracted.comments, []);
} else {
  assert.equal(extracted.coverage.state, 'complete'); assert.equal(extracted.coverage.parser.family, 'rust-comment-lexer');
  assert.deepEqual(extracted.comments.map(comment => text.slice(comment.start, comment.end)), fixture.expected);
  if (mode === 'doc-roles') {
    assert.deepEqual(extracted.comments.map(comment => comment.originalType), ['doc', 'inline', 'doc', 'doc', 'block', 'doc']);
    assert.deepEqual(product.ranges.map(range => range.documentationRole),
      ['outer-candidate', 'none', 'inner-candidate', 'outer-candidate', 'none', 'inner-candidate']);
  }
  const metadata = buildCommentMeta({ ...input, mode: 'code', normalizedCommentsConfig: config,
    tokenDictWords: new Set(), dictConfig: {} });
  assert.deepEqual(metadata.commentRanges.map(comment => text.slice(comment.start, comment.end)), fixture.expected);
  if (mode === 'nested') assert.equal(metadata.commentRanges[0].end, text.indexOf(nested) + nested.length,
    'the entire outer comment, including its inner close and tail, reaches the code-stripping owner');
}
console.log(`Rust-owned comment occurrences: ${mode}`);

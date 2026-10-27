import assert from 'node:assert/strict';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { prepareTypeScriptBabelSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { getParserCommentOccurrences } from '../../../src/lang/comment-occurrences.js';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { buildCommentMeta } from '../../../src/index/build/file-processor/cpu/meta.js';
import { buildExtractedProseExtrasCacheKey, resolveExtractedProseCommentData } from '../../../src/index/build/file-processor/cpu/comment-data-cache.js';
import { collectChunkComments } from '../../../src/index/build/file-processor/process-chunks/limits.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/segments/parser-comment-occurrences/')[1];
const docs = '/** Useful parser owned documentation with several independently expected words. */';
const cases = {
  regex: { text: `const apostrophe = /'/;\n${docs}\nfunction f() {}`, expected: [docs] },
  division: { text: `const ratio = 12 / 3;\n${docs}`, expected: [docs] },
  template: { text: 'const rendered = `ignored // marker ${' + docs + ' 42}`;', expected: [docs] },
  'regex-markers': { text: 'const expression = /\\/\\*literal marker/; const s = "// text";', expected: [] },
  cr: { text: '// useful independently expected commentary\rconst live = 42;', expected: ['// useful independently expected commentary'] },
  ls: { text: '// useful independently expected commentary\u2028const live = 42;', expected: ['// useful independently expected commentary'] },
  ps: { text: '// useful independently expected commentary\u2029const live = 42;', expected: ['// useful independently expected commentary'] },
  typescript: { text: `const apostrophe: RegExp = /'/;\n${docs}\nexport function f(x: number): number { return x; }`, expected: [docs], ext: '.ts' },
  'parser-reuse': { text: `const value = 42;\n${docs}`, expected: [docs] },
  'source-mismatch': { text: `const value = 42;\n${docs}`, expected: [docs] },
  malformed: { text: `const broken = ;\n${docs}`, expected: [docs] },
  'cache-profile': { text: `const value = 42;\n${docs}`, expected: [docs] }
};
assert.ok(Object.hasOwn(cases, mode), `Unknown case ${mode}`);
const fixture = cases[mode], text = 'const unicode = "界😀";\n' + fixture.text;
const ext = fixture.ext || '.js', languageId = ext === '.ts' ? 'typescript' : 'javascript';
const config = normalizeCommentConfig({ extract: 'all', minDocChars: 1, minInlineChars: 1, minTokens: 1 });
const ast = ext === '.ts' ? prepareTypeScriptBabelSyntax(text, { ext }) : parseJavaScriptAst(text, { ext });
const context = ext === '.ts' ? { exportAst: ast } : { jsAst: ast };
const input = { text, ext, languageId, lineIndex: buildLineIndex(text), config, context };
if (mode === 'parser-reuse') ast.comments.splice(0, ast.comments.length);
if (mode === 'source-mismatch') input.commentOccurrences = getParserCommentOccurrences(parseJavaScriptAst('const other = 1;', { ext }), 'const other = 1;');
const extracted = extractComments(input);
assert.deepEqual(extracted.comments.map(comment => text.slice(comment.start, comment.end)), fixture.expected);
if (['malformed', 'source-mismatch'].includes(mode)) {
  assert.equal(extracted.coverage.state, 'heuristic');
  assert.match(extracted.coverage.reason, mode === 'malformed' ? /parser/ : /mismatch/);
} else {
  assert.equal(extracted.coverage.state, 'complete');
  assert.equal(extracted.coverage.source.coordinateUnit, 'utf16');
  const owned = getParserCommentOccurrences(ast, text);
  assert.ok(Object.isFrozen(owned.ranges)); assert.ok(owned.ranges.every(Object.isFrozen));
  assert.equal(owned.source.length, text.length);
  assert.equal(getParserCommentOccurrences(ast, text + '\n'), null);
  for (const raw of fixture.expected) {
    assert.equal(extracted.comments.find(comment => comment.raw === raw).start, text.indexOf(raw));
  }
}
if (fixture.expected.length && !['malformed', 'source-mismatch'].includes(mode)) {
  const meta = buildCommentMeta({ ...input, mode: 'code', languageContext: context,
    normalizedCommentsConfig: config, tokenDictWords: new Set(), dictConfig: {} });
  assert.deepEqual(meta.commentRanges.map(comment => text.slice(comment.start, comment.end)), fixture.expected);
  assert.ok(meta.commentRanges.every(comment => !text.slice(comment.start, comment.end).includes('const live')));
  const collected = collectChunkComments({ assigned: meta.commentEntries, assignedRanges: meta.commentRanges,
    chunkMode: 'code', normalizedCommentsConfig: config, tokenDictWords: new Set(), dictConfig: {},
    effectiveExt: ext, chunkStart: 0 });
  assert.deepEqual(collected.docmetaPatch.commentRefs.map(ref => text.slice(ref.start, ref.end)), fixture.expected);
}
if (mode === 'cache-profile') {
  const base = { text, ext, languageId, lineIndex: input.lineIndex, normalizedCommentsConfig: config, fileHash: 'same-caller-key' };
  const key = buildExtractedProseExtrasCacheKey(base), cache = new Map();
  const first = resolveExtractedProseCommentData({ ...base, cache, key, languageContext: context });
  const entry = cache.get(key);
  assert.deepEqual(resolveExtractedProseCommentData({ ...base, cache, key, languageContext: context }), first);
  assert.equal(cache.get(key), entry, 'compatible source/parser reuses extraction');
  const acorn = parseJavaScriptAst(text, { ext, parser: 'acorn' });
  const changed = resolveExtractedProseCommentData({ ...base, cache, key, languageContext: { jsAst: acorn } });
  assert.equal(changed.coverage.parser.family, 'acorn'); assert.notEqual(cache.get(key), entry);
  const changedSource = text + '\n// another useful independently expected commentary';
  const fresh = resolveExtractedProseCommentData({ ...base, text: changedSource, lineIndex: buildLineIndex(changedSource), cache, key });
  assert.equal(fresh.comments.length, 2, 'even a reused caller hash cannot replay different source');
}
console.log(`Parser-owned comment occurrences: ${mode}`);

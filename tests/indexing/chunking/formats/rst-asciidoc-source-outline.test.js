import assert from 'node:assert/strict';
import { projectRstOutline } from '../../../../src/index/chunking/formats/rst-outline.js';
import { projectAsciiDocOutline } from '../../../../src/index/chunking/formats/asciidoc-outline.js';
import { chunkRst, chunkAsciiDoc } from '../../../../src/index/chunking/formats/rst-asciidoc.js';
import { smartChunk } from '../../../../src/index/chunking.js';
import { discoverSegments, chunkSegments } from '../../../../src/index/segments.js';
import { createBoundedLineAccessor } from '../../../../src/shared/lines.js';
import { sourceOutlineErrors } from '../../../../src/shared/source-outline.js';
import { validateMetadataV2Semantics } from '../../../../src/contracts/validators/metadata.js';
import { assembleFlowFixture } from '../../../helpers/chunk-flow-fixture.js';
import { serializeCachedRow } from '../../../../src/index/build/artifacts/writers/chunk-meta/shared.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

applyTestEnv();
const complete = (text, chunks) => {
  assert.ok(chunks.length);
  let cursor = 0;
  for (const chunk of chunks) { assert.equal(chunk.start, cursor); assert.ok(chunk.end >= chunk.start); cursor = chunk.end; }
  assert.equal(cursor, text.length, 'every source unit remains in exactly one source envelope');
  assert.equal(chunks.map(chunk => text.slice(chunk.start, chunk.end)).join(''), text);
};
const position = (lines, line, newline) => lines.slice(0, line).reduce((sum, value) => sum + value.length + newline.length, 0);
const oracle = ({ lines, newline, ext, project, expected }) => {
  const text = lines.join(newline), result = project(text);
  assert.deepEqual(result.headings.map(heading => heading.title), expected.map(item => item.title), 'exact independent occurrence list rejects both one-root and every-regex-candidate implementations');
  for (let i = 0; i < expected.length; i++) {
    const item = expected[i], heading = result.headings[i], titleStart = position(lines, item.line, newline) + (item.inset || 0);
    assert.deepEqual(heading.titleRange, { start: titleStart, end: titleStart + item.title.length });
    assert.equal(heading.sourceRange.start, position(lines, item.envelopeLine ?? item.line, newline));
    assert.equal(heading.sourceRange.end, position(lines, item.endLine, newline) + lines[item.endLine].length);
    assert.equal(text.slice(heading.titleRange.start, heading.titleRange.end), item.title);
    assert.equal(heading.level, item.level);
    assert.equal(heading.parentId, item.parent == null ? null : result.headings[item.parent].id);
    assert.deepEqual(sourceOutlineErrors({ coverage: result.coverage, heading }), []);
  }
  assert.equal(new Set(result.headings.map(heading => heading.id)).size, expected.length, 'repeated titles retain separate occurrence identities');
  const context = { chunking: { useLanguageRoleDefaults: false, maxBytes: 100000, maxLines: 1000 } };
  const direct = ext === '.rst' ? chunkRst(text) : chunkAsciiDoc(text);
  const smart = smartChunk({ text, ext, mode: 'prose', context, relPath: 'fixture' + ext });
  const segments = discoverSegments({ text, ext, mode: 'prose', relPath: 'fixture' + ext });
  const segmented = chunkSegments({ text, ext, mode: 'prose', segments, context, relPath: 'fixture' + ext });
  for (const chunks of [direct, smart, segmented]) {
    complete(text, chunks);
    assert.deepEqual(chunks.filter(chunk => chunk.meta.heading).map(chunk => chunk.meta.heading.id), result.headings.map(heading => heading.id));
  }
  for (const chunk of smart) {
    const payload = assembleFlowFixture({ text, chunk, docmeta: {}, lang: ext === '.rst' ? 'rst' : 'asciidoc', ext });
    assert.equal(payload.sourceOutline, undefined, 'the persisted receipt has one canonical metadata owner');
    const row = JSON.parse(serializeCachedRow(payload));
    assert.deepEqual(row.metaV2.sourceOutline.coverage, result.coverage);
    assert.deepEqual(validateMetadataV2Semantics(row.metaV2), []);
  }
  return result;
};

const rst = ['😀 source prefix', '', '=======', ' Guide', '=======', 'body', '', 'Example::', '',
  '    Literal Impostor', '    ----------------', '', '.. note::', '', '    Directive Impostor', '    ------------------', '',
  'Alternate', '.........', 'body', '', '----', '', 'A', '+', 'body', '', 'Alternate', '.........', 'tail'];
const rstExpected = [{ title: 'Guide', line: 3, inset: 1, envelopeLine: 2, endLine: 4, level: 0, parent: null },
  { title: 'Alternate', line: 17, endLine: 18, level: 1, parent: 0 },
  { title: 'A', line: 23, endLine: 24, level: 2, parent: 1 },
  { title: 'Alternate', line: 27, endLine: 28, level: 1, parent: 0 }];
for (const newline of ['\n', '\r\n']) oracle({ lines: rst, newline, ext: '.rst', project: projectRstOutline, expected: rstExpected });
for (const character of ['.', '+', ':', '_', '`', '@', '!', '/', '[', '\\']) {
  const result = projectRstOutline(`Title\n${character.repeat(5)}\nbody`);
  assert.deepEqual(result.headings.map(heading => heading.title), ['Title']);
  assert.equal(result.headings[0].style.character, character);
}
for (const [text, reason] of [['Too wide\n---', 'rst_title_adornment_too_short'],
  ['====\nBad\n---', 'rst_heading_block_or_adornment_mismatch'], ['界\n--', 'rst_title_visual_width_unqualified']]) {
  const result = projectRstOutline(text);
  assert.equal(result.headings.length, 0); assert.ok(result.coverage.reasonCounts[reason]); complete(text, result.chunks);
}
const sameCharacter = projectRstOutline('=====\nFirst\n=====\n\nOther\n=====');
assert.deepEqual(sameCharacter.headings.map(heading => heading.level), [0, 1], 'overline/underline style differs from underline-only style');
assert.deepEqual(projectRstOutline('Title::\n=======').headings.map(heading => heading.title), ['Title::'],
  'an admitted heading owns its adornment before literal-introducer paragraph syntax');
const quoted = projectRstOutline('Example::\n\n> Literal Impostor\n> ----------------\n\nReal\n....');
assert.deepEqual(quoted.headings.map(heading => heading.title), ['Real']);
assert.equal(projectRstOutline('.. _paragraph:\n\nParagraph.\n\nReal\n....').headings[0].anchor, null,
  'an intervening body consumes its authored target instead of rebinding it to a later heading');

const adoc = ['= Manual', '', '[source,text]', '----', '== Listing Impostor', '----', '', '////', '== Comment Impostor', '////', '',
  '====', '======', '== Nested Impostor', '======', '====', '', '[[usage-id]]', '== Usage', '',
  '....', '== Literal Impostor', '....', '', '++++', '== Raw Impostor', '++++', '', '--', '== Open Impostor', '--', '',
  '* Item', '+', '== List Impostor', '', '== Usage', '', 'tail'];
const adocExpected = [{ title: 'Manual', line: 0, inset: 2, endLine: 0, level: 0, parent: null },
  { title: 'Usage', line: 18, inset: 3, endLine: 18, level: 1, parent: 0 },
  { title: 'Usage', line: 36, inset: 3, endLine: 36, level: 1, parent: 0 }];
for (const newline of ['\n', '\r\n']) {
  const result = oracle({ lines: adoc, newline, ext: '.adoc', project: projectAsciiDocOutline, expected: adocExpected });
  assert.equal(result.headings[1].anchor.value, 'usage-id');
}
for (const [text, reason] of [['= Manual\n\n[custom-extension]\n== Unknown', 'asciidoc_custom_block_style_unqualified'],
  ['= Manual\n\n----\n== Unclosed', 'asciidoc_unclosed_delimited_block'],
  ['= Manual\n\nifdef::feature[]\n== Conditional\nendif::[]', 'asciidoc_preprocessor_unexpanded'],
  ['= Manual\n\n{block-delimiter}\n== Unknown', 'asciidoc_substituted_block_boundary_unqualified']]) {
  const result = projectAsciiDocOutline(text);
  assert.deepEqual(result.headings.map(heading => heading.title), ['Manual']);
  assert.equal(result.coverage.state, 'partial'); assert.ok(result.coverage.reasonCounts[reason]); complete(text, result.chunks);
}
for (const [limits, reason] of [[{ maxChars: 10 }, 'source_chars_limit'], [{ maxLines: 2 }, 'source_lines_limit'],
  [{ maxWork: 0 }, 'outline_work_limit'], [{ maxHeadings: 1 }, 'outline_headings_limit'],
  [{ maxLineChars: 2 }, 'outline_line_chars_limit'], [{ maxDepth: 1 }, 'outline_depth_limit']]) {
  const text = 'First\n=====\n\nSecond\n------\n\nThird\n.....';
  const result = projectRstOutline(text, limits);
  assert.equal(result.coverage.state, 'partial'); assert.ok(result.coverage.reasonCounts[reason], reason);
  assert.equal(result.coverage.omittedHeadings, null); assert.ok(result.coverage.observed.work <= result.coverage.limits.maxWork);
  assert.ok(result.coverage.observed.headings <= result.coverage.limits.maxHeadings); complete(text, result.chunks);
}
const admitted = createBoundedLineAccessor('😀\npartial final line', { maxChars: 5, maxLines: 2 });
assert.equal(projectAsciiDocOutline('=== Missing parent').headings.length, 0, 'an initial level jump cannot manufacture an ordinary section');
assert.equal(admitted.admittedEnd, 3, 'bounded admission excludes a cut-off line without splitting UTF-16 source identity');
assert.deepEqual(sourceOutlineErrors({ coverage: { source: {} } }), ['missing outline source qualification']);
console.log('RST and AsciiDoc source outlines qualify block ownership, exact heading occurrences and bounded source retention.');

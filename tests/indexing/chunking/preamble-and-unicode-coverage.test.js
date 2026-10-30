import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { chunkMarkdown } from '../../../src/index/chunking/formats/markdown.js';
import { chunkIniToml } from '../../../src/index/chunking/formats/ini-toml.js';
import { chunkYaml } from '../../../src/index/chunking/formats/yaml.js';
import { chunkJson } from '../../../src/index/chunking/formats/json.js';
import { createProtoChunker, createGraphqlChunker } from '../../../src/index/chunking/dispatch/schema-chunkers.js';
import { chunkDockerfile, chunkMakefile, chunkCmake, chunkHandlebars, chunkMustache, chunkJinja } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { resolveChunkingLimits, splitChunkByBytes, applyChunkingLimits } from '../../../src/index/chunking/limits.js';
import { splitLinesWithIndex } from '../../../src/index/chunking/dispatch/shared.js';
import { buildCdcSegments } from '../../../src/index/segments/cdc.js';

const complete = (text, chunks) => {
  assert.ok(chunks?.length);
  let next = 0;
  for (const chunk of chunks) { assert.equal(chunk.start, next); assert.ok(chunk.end > chunk.start); next = chunk.end; }
  assert.equal(next, text.length);
  assert.equal(chunks.map(chunk => text.slice(chunk.start, chunk.end)).join(''), text);
};
for (const [text, chunker] of [
  ['Intro\n# Title\nbody\n', chunkMarkdown],
  ['root=1\n[table]\nchild=2\n', text => chunkIniToml(text, 'toml')],
  ['root=1\n[table]\nchild=2\n', text => chunkIniToml(text, 'ini')],
  ['name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n', text => chunkYaml(text, '.github/workflows/ci.yml', {})],
  ['# prefix\nFROM node:26\n', chunkDockerfile], ['# prefix\nbuild:\n\techo hi\n', chunkMakefile],
  ['# prefix\nproject(foo)\n', chunkCmake], ['prefix\n{{#if ready}}body{{/if}}', chunkHandlebars],
  ['prefix\n{{#ready}}body{{/ready}}', chunkMustache], ['prefix\n{% block body %}text{% endblock %}', chunkJinja]
]) complete(text, chunker(text));
const text = '//prefix\nmessage Foo {}';
complete(text, createProtoChunker({ parseStructure: () => ({ parser: 'fixture', headings: [{ start: 9, end: text.length, name: 'Foo', keyword: 'message' }] }) })(text));
complete(text, createGraphqlChunker({ parseStructure: () => ({ parser: 'graphql-js', definitions: [{ start: 9, end: text.length, title: 'Foo', keyword: 'type' }] }) })(text));
for (const valid of ['{"a":{}}', '{"a":[]}', '{"a":[{},[]]}']) assert.ok(chunkJson(valid, {}));
for (const invalid of ['{"a":{,}}', '{"a":[1,]}']) assert.equal(chunkJson(invalid, {}), null);
const shared = { chunkingShared: {} };
splitLinesWithIndex('a\nb', shared);
assert.deepEqual(splitLinesWithIndex('longer\nb', shared).lineIndex, [0, 7]);
assert.deepEqual(resolveChunkingLimits({ ext: '.js', relPath: 'src/a.js', chunking: {
  languageRoleLimits: { javascript: { src: { maxLines: 100 } } }
} }), { maxBytes: 131072, maxLines: 100 });
for (const unicode of ['😀', 'é'.repeat(20), 'a😀b𐐀c']) {
  const chunks = splitChunkByBytes({ start: 0, end: unicode.length }, unicode, () => [0], 3);
  complete(unicode, chunks);
  assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(unicode.slice(chunk.start, chunk.end))));
  const cached = applyChunkingLimits(Array.from({ length: 5 }, () => ({ start: 0, end: unicode.length })), unicode,
    { chunkingShared: { text: unicode }, chunking: { maxBytes: 3, useLanguageRoleDefaults: false } });
  assert.ok(cached.every(chunk => !/[\uD800-\uDBFF]$/.test(unicode.slice(chunk.start, chunk.end))));
  const segments = buildCdcSegments({ text: unicode, options: { minFileBytes: 0, minBytes: 2, maxBytes: 4, maskBits: 30 } });
  complete(unicode, segments);
  assert.ok(segments.every(segment => Buffer.byteLength(unicode.slice(segment.start, segment.end), 'utf8') <= 4));
}
console.log('preamble and Unicode chunk coverage test passed');

// Exact declarations prevent a whole-file fallback from satisfying coverage.
for (const [ext, input, names, starts, kind] of [
  ['.md', 'Intro\n# First\nbody\n## Second\ntail\n', ['preamble', 'First', 'Second'], [0, 6, 19], 'Section'],
  ['.ini', 'root=1\n[one]\na=2\n[two]\nb=3\n', ['preamble', 'one', 'two'], [0, 7, 17], 'ConfigSection']
]) {
  const chunks = smartChunk({ text: input, ext, mode: ext === '.md' ? 'prose' : 'code',
    context: { treeSitter: { enabled: false } } });
  assert.deepEqual(chunks.map(row => row.name), names);
  assert.deepEqual(chunks.map(row => row.start), starts);
  assert.ok(chunks.every(row => row.kind === kind));
  assert.equal(chunks[0].meta.preamble, true);
  assert.ok(chunks.slice(1).every(row => !row.meta.preamble)); complete(input, chunks);
}
for (const [input, chunker, name] of [
  ['# First\nbody\n', chunkMarkdown, 'First'],
  ['[one]\na=2\n', value => chunkIniToml(value, 'ini'), 'one']
]) {
  const chunks = chunker(input); assert.equal(chunks.length, 1);
  assert.equal(chunks[0].name, name); assert.equal(chunks[0].start, 0);
  assert.ok(!chunks[0].meta.preamble); complete(input, chunks);
}
assert.equal(chunkMarkdown(''), null);
assert.equal(chunkMarkdown('prefix only'), null, 'heading-free Markdown deliberately delegates to ordinary prose fallback');
for (const input of ['', 'root=1\n']) {
  const chunks = chunkIniToml(input, 'ini');
  assert.equal(chunks.length, 1); assert.equal(chunks[0].name, 'root');
  assert.equal(chunks[0].start, 0); assert.equal(chunks[0].end, input.length);
}
const prefixOnly = 'prefix only';
complete(prefixOnly, smartChunk({ text: prefixOnly, ext: '.md', mode: 'prose', context: { treeSitter: { enabled: false } } }));

assert.deepEqual(resolveChunkingLimits({ ext: '.js', relPath: 'src/a.js', chunking: {
  languageRoleLimits: { javascript: { src: { maxBytes: 512 } } }
} }), { maxBytes: 512, maxLines: 260 }, 'overriding bytes preserves the role line default');

import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { chunkDockerfile, chunkMakefile, chunkCmake, chunkStarlark,
  chunkHandlebars, chunkMustache, chunkJinja } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { readChunkContent } from '../../../src/shared/embedded-content.js';

const cases = [
  ['.dockerfile', '# important prefix\n', 'FROM node:26\n', chunkDockerfile, 'astRange'],
  ['.makefile', '# important prefix\n', 'build:\n\techo ok\n', chunkMakefile],
  ['.cmake', '# important prefix\n', 'project(foo)\n', chunkCmake],
  ['.bzl', '# important prefix\n', 'def build():\n    red()\n', chunkStarlark, 'sectionRange'],
  ['.hbs', 'plain prefix\n', '{{#if ok}}body{{/if}}\n', chunkHandlebars, 'astRange'],
  ['.mustache', 'plain prefix\n', '{{#ok}}body{{/ok}}\n', chunkMustache, 'tokenRange'],
  ['.jinja', 'plain prefix\n', '{% block body %}body{% endblock %}\n', chunkJinja, 'lexicalRange']
];
for (const [ext, prefix, body, chunker, rangeField] of cases) {
  const text = prefix + body;
  const direct = chunker(text);
  assert.equal(direct[0].name, 'preamble', ext);
  assert.equal(direct[0].meta.preamble, true, ext);
  assert.equal(readChunkContent(text, direct[0]), prefix, ext);
  if (rangeField) assert.equal(direct[1].meta[rangeField].start, prefix.length, `${ext} retains actual structural start`);
  for (const chunks of [direct, smartChunk({ text, ext, mode: 'code', context: { chunking: { maxBytes: 12 } } })]) {
    let cursor = 0;
    for (const chunk of chunks) { assert.equal(chunk.start, cursor, ext); cursor = chunk.end; }
    assert.equal(cursor, text.length, ext);
    assert.equal(chunks.map(chunk => readChunkContent(text, chunk)).join(''), text, ext);
  }
  const noPrefix = chunker(body);
  assert.equal(noPrefix[0].start, 0, ext);
  assert.equal(noPrefix.some(chunk => chunk.meta.preamble), false, ext);
}
console.log('Heuristic and template prefixes survive dispatch/limits without moving structural ranges.');

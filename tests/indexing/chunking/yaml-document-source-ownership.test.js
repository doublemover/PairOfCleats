import assert from 'node:assert/strict';
import { chunkYaml } from '../../../src/index/chunking/formats/yaml.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { readChunkContent } from '../../../src/shared/embedded-content.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from '../file-processor/process-chunks-fixture.js';

const top = { yamlChunking: { mode: 'top-level' } };
for (const bodies of [
  ['first: alpha\n', '- middlebodymarker\n- orphan-after\n', 'second: beta\n'],
  ['scalarhead\n', 'same: mapping\n', '{finalflow: flowbodymarker}\n'],
  ['{initialflow: flowhead}\n', 'same: mapping\n', 'scalartail\n'],
  ['', 'same: one\n', '', 'same: two\n', '']
]) {
  const prefix = '%YAML 1.2\n# initial comment\n';
  let text = prefix;
  const starts = [];
  for (let index = 0; index < bodies.length; index++) {
    starts.push(index === 0 ? 0 : text.length);
    text += '---\n' + bodies[index] + '... # explicit end belongs to this document\n';
  }
  for (const context of [top, { ...top, chunking: { maxBytes: 28, maxLines: 2 } }]) {
    const chunks = smartChunk({ text, ext: '.yaml', relPath: 'stream.yaml', mode: 'code', context });
    let cursor = 0;
    for (const chunk of chunks) {
      assert.equal(chunk.start, cursor); cursor = chunk.end;
      const index = chunk.meta.documentIndex;
      assert.ok(Number.isInteger(index));
      assert.ok(chunk.start >= starts[index] && chunk.end <= (starts[index + 1] ?? text.length));
      assert.ok(chunk.meta.documentRange.start >= starts[index]);
      assert.ok(chunk.meta.documentRange.end <= (starts[index + 1] ?? text.length));
    }
    assert.equal(cursor, text.length);
    assert.equal(chunks.map(chunk => readChunkContent(text, chunk)).join(''), text);
    for (let index = 0; index < bodies.length; index++) {
      const owned = chunks.filter(chunk => chunk.meta.documentIndex === index);
      assert.ok(owned.length);
      if (!bodies[index].includes(': ') || bodies[index].startsWith('{')) {
        assert.ok(owned.every(chunk => chunk.name === `document ${index}`), 'multi-document fallback identity remains explicit');
      }
      assert.equal(owned.map(chunk => readChunkContent(text, chunk)).join(''), text.slice(starts[index], starts[index + 1]));
    }
  }
  const root = chunkYaml(text, 'stream.yaml', { yamlChunking: { mode: 'root' } });
  assert.equal(root.length, 1); assert.equal(root[0].name, 'root');
  assert.equal(root[0].meta.documentIndex, undefined);
}
// Standalone directives and comments after an explicit end lead the next doc.
const first = 'same: one\n... # end one\n';
const nextPrelude = '# next comment\n%YAML 1.2\n';
const second = '---\n- middlebodymarker\n...\n';
const text = first + nextPrelude + second;
const chunks = chunkYaml(text, 'stream.yaml', top);
assert.equal(chunks[0].end, first.length);
assert.equal(chunks[1].start, first.length);
assert.equal(chunks[1].meta.documentIndex, 1);
assert.ok(readChunkContent(text, chunks[1]).startsWith(nextPrelude));
const { context } = createProcessChunksFixtureContext({ text, ext: '.yaml', languageId: 'yaml', rel: 'stream.yaml',
  riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc: chunks } });
const processed = await processFixtureChunks(context);
assert.equal(processed.chunks.length, chunks.length);
const marker = processed.chunks.filter(chunk => chunk.tokens.some(token => token.includes('middlebodymarker')));
assert.equal(marker.length, 1);
assert.equal(marker[0].start, chunks[1].start);
assert.equal(marker[0].name, 'document 1');
console.log('YAML document bodies, stream trivia and explicit ends retain independent source/indexed ownership.');

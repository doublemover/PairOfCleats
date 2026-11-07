import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { chunkStarlark } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { buildHeuristicAdapters } from '../../../src/index/language-registry/adapters/heuristic.js';
import { readChunkContent } from '../../../src/shared/embedded-content.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from '../file-processor/process-chunks-fixture.js';

const adapter = buildHeuristicAdapters().find(value => value.id === 'starlark');
const lines = [
  '# Unicode 😀 preamble, inert ghost()',
  'load("//tools:rules.bzl", "rule")',
  'def one(', '    name,', '):',
  '    # nested and assigned calls stay with one',
  '    if name:', '        red(', '            name,', '        )',
  '    for value in name:', '        blue(value)',
  '    value = red()', '    return value',
  'def two():', '    """', 'def ghost():', '    innocent()', '    """',
  "    '''", 'def other_ghost():', '    phantom()', "    '''",
  '    return "escaped \\\" quote"',
  'rule(', '    name = "real",', '    deps = ["//a:b"],', ')',
  'value = \\', 'fake_continuation()',
  'module(name = "end")', ''
];
for (const newline of ['\n', '\r\n']) {
  const text = lines.join(newline);
  const direct = chunkStarlark(text);
  assert.deepEqual(direct.map(chunk => chunk.name), ['preamble', 'load', 'def one', 'def two', 'rule', 'module']);
  assert.equal(direct.find(chunk => chunk.name === 'def one').end, text.indexOf('def two():'));
  const second = direct.find(chunk => chunk.name === 'def two');
  assert.equal(second.start, text.indexOf('def two():'));
  assert.equal(second.end, text.indexOf('rule('));
  assert.ok(readChunkContent(text, second).includes('def ghost():'));
  for (const context of [{}, { chunking: { maxLines: 3, maxBytes: 45 } }]) {
    const chunks = smartChunk({ text, ext: '.bzl', relPath: 'rules.bzl', mode: 'code', context });
    let cursor = 0;
    for (const chunk of chunks) {
      assert.equal(chunk.start, cursor); cursor = chunk.end;
      const parent = direct.find(owner => owner.start <= chunk.start && owner.end >= chunk.end);
      assert.ok(parent); assert.equal(chunk.name, parent.name);
      if (!parent.meta.preamble) assert.deepEqual(chunk.meta.sectionRange, { start: parent.start, end: parent.end });
      const docmeta = adapter.extractDocMeta({ chunk });
      assert.equal(docmeta.symbol, parent.name);
      assert.ok(!['def ghost', 'innocent', 'def other_ghost', 'phantom', 'fake_continuation'].includes(docmeta.symbol));
    }
    assert.equal(cursor, text.length);
    assert.equal(chunks.map(chunk => readChunkContent(text, chunk)).join(''), text);
    if (context.chunking) assert.ok(chunks.filter(chunk => chunk.name === 'def one').length > 1);
  }
}
// Token-flow uses these same source spans; exercise its actual indexed payload.
const text = 'def one():\n    redbodymarker()\ndef two():\n    bluebodymarker()\n';
const chunks = smartChunk({ text, ext: '.bzl', mode: 'code' });
const { context } = createProcessChunksFixtureContext({ text, ext: '.bzl', languageId: 'starlark', rel: 'rules.bzl', lang: adapter,
  riskAnalysisEnabled: false, typeInferenceEnabled: false,
  analysisPolicy: { metadata: { enabled: true }, risk: { enabled: false }, typeInference: { local: { enabled: false } } },
  overrides: { sc: chunks } });
const processed = await processFixtureChunks(context);
assert.equal(processed.chunks.length, 2);
assert.equal(processed.chunks[0].docmeta.symbol, 'def one');
assert.ok(processed.chunks[0].tokens.some(token => token.includes('redbodymarker')));
assert.ok(!processed.chunks[0].tokens.some(token => token.includes('bluebodymarker')));
assert.equal(processed.chunks[1].docmeta.symbol, 'def two');
console.log('Starlark bodies, strings, continuations and split parent ranges retain source and indexed identities.');

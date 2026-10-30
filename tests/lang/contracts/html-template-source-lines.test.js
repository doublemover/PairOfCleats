import assert from 'node:assert/strict';
import { buildHtmlChunks, collectHtmlImports, getHtmlMetadata } from '../../../src/lang/html.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const text = '<div>😀</div>\r\n<script>\r\nfunction outside(){return 1;}\r\n</script>\r\n<template><script src="./inside.js"></script><link rel="stylesheet" href="./inside.css"><template><script>function inside(){return 2;}</script><code lang="text">hello</code></template></template>';
assert.deepEqual(collectHtmlImports(text).sort(), ['./inside.css','./inside.js']);
const chunks = buildHtmlChunks(text, {treeSitter:{enabled:false}});
const lineIndex = buildLineIndex(text);
for (const name of ['outside','inside']) {
  const rows = chunks.filter(row => row.name === name);
  assert.equal(rows.length,1,name);
  const chunk = rows[0];
  assert.ok(text.slice(chunk.start,chunk.end).startsWith(`function ${name}`));
  assert.equal(chunk.meta.startLine,offsetToLine(lineIndex,chunk.start));
  assert.equal(chunk.meta.endLine,offsetToLine(lineIndex,chunk.end-1));
}
assert.ok(chunks.some(chunk => chunk.kind === 'CodeBlock' && text.slice(chunk.start,chunk.end).includes('hello')));
for (const newline of ['\n', '\r\n']) {
  const source = ['<div>😀 Unicode prefix</div>', '<script src="./outside.js"></script>', '',
    '<script>function sameLine(){ return "outside-marker"; }</script>',
    '<style>', '.outside { color: red; }', '</style>',
    '<code lang="text">outside-code-marker</code>', '<pre lang="text">outside-pre-marker</pre>',
    '<template>', '<script src="./inside.js"></script><link rel="stylesheet" href="./inside.css">',
    '<script>', '', 'function insideTemplate(){ return "inside-marker"; }', '</script>',
    '<style>.inside { color: blue; }</style>', '<code lang="text">inside-code-marker</code>',
    '<pre lang="text">inside-pre-marker</pre>',
    '<template><script src="./nested.js"></script><script>function nestedTemplate(){ return 3; }</script></template>',
    '<template></template>', '</template>', ''
  ].join(newline);
  const options = { treeSitter: { enabled: false } };
  const metadata = getHtmlMetadata(source, options);
  assert.deepEqual(metadata.scripts, ['./outside.js','./inside.js','./nested.js']);
  assert.deepEqual(metadata.links, ['./inside.css']);
  assert.deepEqual(collectHtmlImports(source, options).sort(), ['./inside.css','./inside.js','./nested.js','./outside.js']);
  const built = buildHtmlChunks(source, options);
  for (const marker of ['outside-code-marker','outside-pre-marker','inside-code-marker','inside-pre-marker']) {
    assert.equal(built.filter(chunk => chunk.kind === 'CodeBlock' && source.slice(chunk.start,chunk.end) === marker).length, 1);
  }
  for (const name of ['sameLine','insideTemplate','nestedTemplate']) {
    const matches = built.filter(chunk => chunk.name === name);
    assert.equal(matches.length, 1);
    assert.ok(source.slice(matches[0].start,matches[0].end).startsWith(`function ${name}`));
  }
  assert.ok(built.some(chunk => chunk.meta.embeddedTag === 'style' && source.slice(chunk.start,chunk.end).includes('.inside')));
  const lines = buildLineIndex(source);
  for (const context of [{ htmlChunks: built }, { htmlChunks: built, chunking: { maxBytes: 32, maxLines: 2 } }]) {
    const dispatched = smartChunk({ text: source, ext: '.html', mode: 'code', context });
    const prepared = await prepareChunkIds({ chunks: dispatched, text: source, relKey: 'fixture.html', containerExt: '.html',
      containerLanguageId: 'html', lineIndex: lines, vfsManifestConcurrency: 1, strict: true });
    for (let index = 0; index < dispatched.length; index++) {
      const chunk = dispatched[index];
      assert.deepEqual(prepared.chunkLineRanges[index], { startLine: offsetToLine(lines,chunk.start),
        endLine: offsetToLine(lines,Math.max(chunk.start,chunk.end-1)) });
      assert.ok(source.slice(chunk.start,chunk.end).length > 0);
      assert.ok(chunk.chunkUid);
    }
  }
  // Static discovery retains template-contained source; no template evaluation
  // or runtime activation is part of this parser/metadata path.
  assert.deepEqual(getHtmlMetadata('<template></template>', options).imports, []);
}
console.log('HTML template traversal and host line metadata passed');

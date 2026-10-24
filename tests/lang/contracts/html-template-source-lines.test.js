import assert from 'node:assert/strict';
import { buildHtmlChunks, collectHtmlImports } from '../../../src/lang/html.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
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
console.log('HTML template traversal and host line metadata passed');
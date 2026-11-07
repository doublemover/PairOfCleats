#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { discoverSegments } from '../../../src/index/segments.js';

applyTestEnv();

const tsxText = [
  'const title = \"Dashboard\";',
  'export function App() {',
  '  return (',
  '    <section className=\"card\">',
  '      <h1>{title}</h1>',
  '      <button onClick={() => title.toLowerCase()}>save</button>',
  '    </section>',
  '  );',
  '}'
].join('\n');

const first = discoverSegments({
  text: tsxText,
  ext: '.tsx',
  relPath: 'src/App.tsx',
  mode: 'code',
  languageId: 'typescript'
});
const second = discoverSegments({
  text: tsxText,
  ext: '.tsx',
  relPath: 'src/App.tsx',
  mode: 'code',
  languageId: 'typescript'
});

assert.deepEqual(second, first, 'expected deterministic tsx segment boundaries');
assert.equal(first.length, 1, 'JSX syntax remains inside its complete canonical program');
assert.deepEqual({ type: first[0].type, languageId: first[0].languageId, ext: first[0].ext,
  start: first[0].start, end: first[0].end },
{ type: 'code', languageId: 'typescript', ext: '.tsx', start: 0, end: tsxText.length });
assert.equal(tsxText.slice(first[0].start, first[0].end), tsxText,
  'the declaration, markup and expression islands retain one exact source view');

let lastEnd = -1;
for (const segment of first) {
  assert.ok(segment.start >= 0 && segment.end > segment.start, 'tsx segment range invalid');
  assert.ok(segment.start >= lastEnd, 'tsx segments should be ordered and non-overlapping');
  lastEnd = segment.end;
}

console.log('jsx/tsx segmentation determinism test passed');

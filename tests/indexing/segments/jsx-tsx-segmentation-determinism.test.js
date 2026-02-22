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
assert.equal(first.some((segment) => segment.type === 'embedded' && segment.languageId === 'html'), true,
  'expected html embedded segment for tsx markup');
assert.equal(first.some((segment) => segment.type === 'code' && segment.languageId === 'typescript'), true,
  'expected code segment for tsx logic');

let lastEnd = -1;
for (const segment of first) {
  assert.ok(segment.start >= 0 && segment.end > segment.start, 'tsx segment range invalid');
  assert.ok(segment.start >= lastEnd, 'tsx segments should be ordered and non-overlapping');
  lastEnd = segment.end;
}

console.log('jsx/tsx segmentation determinism test passed');

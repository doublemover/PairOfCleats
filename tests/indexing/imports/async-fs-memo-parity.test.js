#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  prepareImportResolutionFsMeta,
  resolveImportLinks
} from '../../../src/index/build/import-resolution.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-fsmeta-'));
const srcDir = path.join(tempRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(path.join(srcDir, 'entry.js'), 'import "./dep.js";\nimport "external-lib";\n');
await fs.writeFile(path.join(srcDir, 'dep.js'), 'export const dep = 1;\n');

const entries = [
  { abs: path.join(srcDir, 'entry.js'), rel: 'src/entry.js' },
  { abs: path.join(srcDir, 'dep.js'), rel: 'src/dep.js' }
];
const importsByFile = {
  'src/entry.js': ['./dep.js', 'external-lib']
};
const normalizeGraph = (graph) => {
  if (!graph || typeof graph !== 'object') return graph;
  return { ...graph, generatedAt: null };
};
const makeRelations = () => new Map([
  ['src/entry.js', { imports: ['./dep.js', 'external-lib'] }]
]);

const baselineRelations = makeRelations();
const baseline = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: baselineRelations,
  enableGraph: true
});

const fsMeta = await prepareImportResolutionFsMeta({
  root: tempRoot,
  entries,
  importsByFile
});
assert.ok(fsMeta?.candidateCount > 0, 'expected preloaded fs metadata candidates');

const asyncMemoRelations = makeRelations();
const asyncMemo = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: asyncMemoRelations,
  enableGraph: true,
  fsMeta
});

assert.deepEqual(asyncMemo.stats, baseline.stats, 'async fs metadata path should match sync stats');
assert.deepEqual(
  normalizeGraph(asyncMemo.graph),
  normalizeGraph(baseline.graph),
  'async fs metadata path should match sync graph output'
);
assert.deepEqual(
  Array.from(asyncMemoRelations.entries()),
  Array.from(baselineRelations.entries()),
  'async fs metadata path should preserve file relation outcomes'
);

console.log('async fs memo parity test passed');

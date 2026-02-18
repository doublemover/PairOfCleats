#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-lookup-reuse-'));
const srcDir = path.join(tempRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(path.join(srcDir, 'alpha.js'), 'import { beta } from "./beta.js";\nexport const alpha = beta;\n');
await fs.writeFile(path.join(srcDir, 'beta.js'), 'export const beta = 1;\n');

const entries = [
  { abs: path.join(srcDir, 'alpha.js'), rel: 'src/alpha.js' },
  { abs: path.join(srcDir, 'beta.js'), rel: 'src/beta.js' }
];
const importsByFile = {
  'src/alpha.js': ['./beta.js', 'left-pad']
};
const baseRelations = () => new Map([
  ['src/alpha.js', { imports: ['./beta.js', 'left-pad'] }]
]);

const cache = { files: {} };
const normalizeGraph = (graph) => {
  if (!graph || typeof graph !== 'object') return graph;
  return { ...graph, generatedAt: null };
};
const firstRelations = baseRelations();
const first = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: firstRelations,
  cache,
  enableGraph: true
});
assert.equal(first.cacheStats.lookupReused, false, 'cold run should not reuse lookup snapshot');

const warmRelations = baseRelations();
const warm = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: warmRelations,
  cache,
  enableGraph: true
});
assert.equal(warm.cacheStats.lookupReused, true, 'warm run should reuse persisted lookup snapshot');
assert.deepEqual(warm.stats, first.stats, 'warm lookup reuse should preserve import resolution stats');
assert.deepEqual(
  normalizeGraph(warm.graph),
  normalizeGraph(first.graph),
  'warm lookup reuse should preserve graph output'
);

console.log('warm lookup structure reuse test passed');

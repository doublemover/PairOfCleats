#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRowSpillCollector } from '../../../src/index/build/artifacts/helpers.js';
import { createSpillSorter } from '../../../src/map/build-map/io.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'merge-comparator-adopters');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const badCompare = () => 1;

const collector = createRowSpillCollector({
  outDir: tempRoot,
  runPrefix: 'collector',
  compare: badCompare,
  maxBufferRows: 2,
  maxBufferBytes: 0
});
await collector.append({ token: 'a', postings: [0] });
await assert.rejects(
  () => collector.append({ token: 'b', postings: [1] }),
  /Comparator is not antisymmetric/,
  'row spill collector should fail fast on invalid comparator'
);

const sorter = createSpillSorter({
  label: 'map-sorter',
  compare: badCompare,
  maxInMemory: 2,
  tempDir: tempRoot
});
await sorter.push({ id: 1 });
await assert.rejects(
  () => sorter.push({ id: 2 }),
  /Comparator is not antisymmetric/,
  'map spill sorter should fail fast on invalid comparator'
);

const adopterChecks = [
  'src/index/build/postings/spill.js',
  'src/index/build/artifacts/graph-relations.js',
  'src/index/build/artifacts/writers/chunk-meta.js',
  'src/index/build/artifacts/writers/symbol-edges.js',
  'src/index/build/artifacts/writers/symbol-occurrences.js',
  'src/index/build/artifacts/writers/vfs-manifest.js',
  'src/map/build-map/io.js'
];
for (const relPath of adopterChecks) {
  const fullPath = path.join(root, relPath);
  const text = await fs.readFile(fullPath, 'utf8');
  assert.ok(
    text.includes('validateComparator: true') || text.includes('compareWithAntisymmetryInvariant'),
    `${relPath} should enforce comparator contract checks`
  );
}

console.log('merge comparator adopters test passed');

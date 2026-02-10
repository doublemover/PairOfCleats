#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createMergeRunManifest,
  mergeSortedRuns,
  mergeSortedRunsToFile,
  readJsonlRows,
  writeJsonlRunFile,
  writeMergeRunManifest
} from '../../../src/shared/merge.js';

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'spill-merge-contract');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const runA = path.join(testRoot, 'run-a.jsonl');
const runB = path.join(testRoot, 'run-b.jsonl');
const mergedPath = path.join(testRoot, 'merged.jsonl');
const manifestPath = path.join(testRoot, 'merged.manifest.json');

await writeJsonlRunFile(runA, [{ rank: 1 }, { rank: 3 }], { atomic: true });
await writeJsonlRunFile(runB, [{ rank: 2 }, { rank: 4 }], { atomic: true });

const mergedStats = await mergeSortedRunsToFile({
  runs: [runA, runB],
  outputPath: mergedPath,
  compare: (left, right) => left.rank - right.rank,
  validateComparator: true,
  atomic: true
});
assert.equal(mergedStats.rows, 4, 'expected merged row count');

const mergedRanks = [];
for await (const row of readJsonlRows(mergedPath)) {
  mergedRanks.push(row.rank);
}
assert.deepEqual(mergedRanks, [1, 2, 3, 4], 'expected deterministic merged ordering');

const manifest = createMergeRunManifest({
  runPath: mergedPath,
  rows: mergedStats.rows,
  bytes: mergedStats.bytes,
  compareId: 'rank-asc'
});
await writeMergeRunManifest(manifestPath, manifest);
const writtenManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
assert.equal(writtenManifest.compareId, 'rank-asc');
assert.equal(writtenManifest.rows, 4);

await assert.rejects(
  async () => {
    for await (const _row of mergeSortedRuns([runA, runB], {
      compare: () => 1,
      validateComparator: true
    })) {
      // force comparator execution
    }
  },
  /antisymmetric/i,
  'expected comparator invariant failure for invalid comparator'
);

console.log('spill merge contract test passed');

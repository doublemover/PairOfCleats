#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonlRows, writeJsonlRunFile, mergeSortedRuns } from '../../../src/shared/merge.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'merge-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runA = path.join(tempRoot, 'run-a.jsonl');
const runB = path.join(tempRoot, 'run-b.jsonl');
const invalidRun = path.join(tempRoot, 'invalid.jsonl');

await writeJsonlRunFile(runA, [{ key: 'a', rank: 1 }, { key: 'c', rank: 3 }], { atomic: true });
await writeJsonlRunFile(runB, [{ key: 'b', rank: 2 }, { key: 'd', rank: 4 }], { atomic: true });
await fs.writeFile(invalidRun, '{"ok":1}\n{"bad":\n', 'utf8');

const loaded = [];
for await (const row of readJsonlRows(runA)) {
  loaded.push(row);
}
assert.equal(loaded.length, 2, 'readJsonlRows should stream all rows in a run file');
assert.deepEqual(loaded[0], { key: 'a', rank: 1 });

await assert.rejects(
  async () => {
    for await (const _row of readJsonlRows(invalidRun)) {
      // no-op
    }
  },
  /Invalid JSONL at/
);

const merged = [];
for await (const row of mergeSortedRuns([{ path: runA }, { path: runB }], {
  compare: (left, right) => left.rank - right.rank
})) {
  merged.push(row.rank);
}
assert.deepEqual(merged, [1, 2, 3, 4], 'mergeSortedRuns should accept run objects with path fields');

console.log('merge contract test passed');

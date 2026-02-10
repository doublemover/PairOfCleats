#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonlRunFile, mergeSortedRuns } from '../../../src/shared/merge.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'merge-determinism');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runs = [
  path.join(tempRoot, 'run-0.jsonl'),
  path.join(tempRoot, 'run-1.jsonl'),
  path.join(tempRoot, 'run-2.jsonl')
];

await writeJsonlRunFile(runs[0], [{ token: 'a', src: 'r0-0' }, { token: 'c', src: 'r0-1' }], { atomic: true });
await writeJsonlRunFile(runs[1], [{ token: 'a', src: 'r1-0' }, { token: 'b', src: 'r1-1' }], { atomic: true });
await writeJsonlRunFile(runs[2], [{ token: 'a', src: 'r2-0' }, { token: 'd', src: 'r2-1' }], { atomic: true });

const collect = async () => {
  const out = [];
  for await (const row of mergeSortedRuns(runs, {
    compare: (left, right) => String(left.token).localeCompare(String(right.token))
  })) {
    out.push(row.src);
  }
  return out;
};

const first = await collect();
const second = await collect();

assert.deepEqual(first, second, 'merge order should be deterministic across repeated runs');
assert.deepEqual(
  first,
  ['r0-0', 'r1-0', 'r2-0', 'r1-1', 'r0-1', 'r2-1'],
  'ties must preserve run-order stability before moving to later tokens'
);

console.log('merge determinism test passed');

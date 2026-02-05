#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { mergeSortedRuns, mergeRunsWithPlanner } from '../../../src/shared/merge.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'merge-core');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runA = path.join(tempRoot, 'run-a.jsonl');
const runB = path.join(tempRoot, 'run-b.jsonl');
const runC = path.join(tempRoot, 'run-c.jsonl');

await writeJsonLinesFile(runA, [{ v: 1 }, { v: 3 }, { v: 5 }], { atomic: true });
await writeJsonLinesFile(runB, [{ v: 1 }, { v: 2 }, { v: 4 }], { atomic: true });
await writeJsonLinesFile(runC, [{ v: 0 }, { v: 6 }], { atomic: true });

const compare = (a, b) => a.v - b.v;

const merged = [];
for await (const row of mergeSortedRuns([runA, runB], { compare })) {
  merged.push(row.v);
}
assert.deepEqual(merged, [1, 1, 2, 3, 4, 5], 'merge should be deterministic and stable');

await assert.rejects(
  async () => {
    const out = [];
    const badCompare = () => 1;
    for await (const row of mergeSortedRuns([runA, runB], { compare: badCompare, validateComparator: true })) {
      out.push(row);
    }
  },
  /Comparator is not antisymmetric/
);

const outputPath = path.join(tempRoot, 'merged.jsonl');
const result = await mergeRunsWithPlanner({
  runs: [runA, runB, runC],
  outputPath,
  compare,
  tempDir: path.join(tempRoot, 'runs'),
  maxOpenRuns: 2,
  runPrefix: 'core'
});

const outputRows = [];
const outputText = await fs.readFile(outputPath, 'utf8');
for (const line of outputText.split('\n')) {
  if (!line.trim()) continue;
  outputRows.push(JSON.parse(line).v);
}
assert.deepEqual(outputRows, [0, 1, 1, 2, 3, 4, 5, 6], 'planner output should merge all runs');

await result.cleanup();
const leftover = await fs.readdir(path.join(tempRoot, 'runs')).catch(() => []);
assert.equal(leftover.length, 0, 'cleanup should remove intermediate runs');

console.log('merge core tests passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  mergeRunsWithPlanner,
  readJsonlRows,
  writeJsonlRunFile
} from '../../../src/shared/merge.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-spill-planner-reuse-'));
const runsDir = path.join(tempRoot, 'runs');
await fs.mkdir(runsDir, { recursive: true });

const runs = [];
for (let i = 0; i < 20; i += 1) {
  const runPath = path.join(runsDir, `run-${String(i).padStart(2, '0')}.jsonl`);
  await writeJsonlRunFile(runPath, [{ token: `tok-${String(i).padStart(2, '0')}`, postings: [i] }]);
  runs.push(runPath);
}

const plannerHintsPath = path.join(tempRoot, 'planner', 'chargram.planner-hints.json');
const firstOutput = path.join(tempRoot, 'merged-first.jsonl');
const secondOutput = path.join(tempRoot, 'merged-second.jsonl');
const inputKey = 'stable-postings-input';
const compareRows = (a, b) => (a.token < b.token ? -1 : (a.token > b.token ? 1 : 0));

const first = await mergeRunsWithPlanner({
  runs,
  outputPath: firstOutput,
  compare: compareRows,
  tempDir: path.join(tempRoot, 'tmp-first'),
  runPrefix: 'chargram',
  checkpointPath: path.join(tempRoot, 'tmp-first', 'checkpoint.json'),
  maxOpenRuns: 4,
  plannerHintsPath,
  plannerInputKey: inputKey,
  validateComparator: true
});
assert.equal(first?.stats?.plannerHintUsed, false, 'cold planner pass should not report hint reuse');

const second = await mergeRunsWithPlanner({
  runs,
  outputPath: secondOutput,
  compare: compareRows,
  tempDir: path.join(tempRoot, 'tmp-second'),
  runPrefix: 'chargram',
  checkpointPath: path.join(tempRoot, 'tmp-second', 'checkpoint.json'),
  maxOpenRuns: 4,
  plannerHintsPath,
  plannerInputKey: inputKey,
  validateComparator: true
});
assert.equal(second?.stats?.plannerHintUsed, true, 'warm planner pass should reuse persisted planner hints');

const collectRows = async (filePath) => {
  const rows = [];
  for await (const row of readJsonlRows(filePath)) rows.push(row);
  return rows;
};

const firstRows = await collectRows(firstOutput);
const secondRows = await collectRows(secondOutput);
assert.deepEqual(secondRows, firstRows, 'planner hint reuse should preserve merged postings output ordering');

await first.cleanup?.();
await second.cleanup?.();

console.log('spill merge planner metadata reuse test passed');

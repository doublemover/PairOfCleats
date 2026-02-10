import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { mergeRunsWithPlanner, writeJsonlRunFile } from '../../../src/shared/merge.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'merge-cleanup-regression');

const compareRows = (a, b) => {
  const left = String(a?.token || '');
  const right = String(b?.token || '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
const runsDir = path.join(tempRoot, 'runs');
await fsPromises.mkdir(runsDir, { recursive: true });

const runPaths = [];
for (let i = 0; i < 3; i += 1) {
  const runPath = path.join(runsDir, `run-${i}.jsonl`);
  await writeJsonlRunFile(runPath, [{ token: `t${i}`, postings: [i] }], { atomic: true });
  runPaths.push(runPath);
}

const mergeDir = path.join(tempRoot, 'merge');
const outputPath = path.join(mergeDir, 'merged.jsonl');
const checkpointPath = path.join(mergeDir, 'merge.checkpoint.json');
const result = await mergeRunsWithPlanner({
  runs: runPaths,
  outputPath,
  compare: compareRows,
  tempDir: mergeDir,
  runPrefix: 'merge',
  checkpointPath,
  maxOpenRuns: 2
});

assert.ok(fs.existsSync(outputPath), 'expected merged output');
const beforeCleanup = fs.existsSync(mergeDir) ? fs.readdirSync(mergeDir) : [];
assert.ok(beforeCleanup.some((name) => name.includes('.run-')), 'expected intermediate runs');

await result.cleanup();
const afterCleanup = fs.existsSync(mergeDir) ? fs.readdirSync(mergeDir) : [];
assert.ok(!afterCleanup.some((name) => name.includes('.run-')), 'expected spill runs cleaned');
assert.ok(!fs.existsSync(checkpointPath), 'expected checkpoint removed');

console.log('merge cleanup regression test passed');

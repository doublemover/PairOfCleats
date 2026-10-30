#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeRunsWithPlanner, readJsonlRows, writeJsonlRunFile } from '../../src/shared/merge.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-merge-identity-'));
try {
  const paths = ['a', 'b', 'c'].map(name => path.join(root, `${name}.jsonl`));
  let sourceReads = 0;
  const options = { runs: paths, outputPath: path.join(root, 'output.jsonl'),
    checkpointPath: path.join(root, 'checkpoint.json'), maxOpenRuns: 2,
    compare: (a, b) => a.localeCompare(b), compareId: 'text-asc',
    readRun: async function* (filePath) {
      if (paths.includes(filePath)) sourceReads++;
      yield* readJsonlRows(filePath);
    } };
  const readOutput = async () => { const result = []; for await (const row of readJsonlRows(options.outputPath)) result.push(row); return result; };
  for (let i = 0; i < paths.length; i++) await writeJsonlRunFile(paths[i], [String.fromCharCode(97 + i)]);
  await mergeRunsWithPlanner(options);
  assert.deepEqual(await readOutput(), ['a', 'b', 'c']);
  sourceReads = 0;
  await mergeRunsWithPlanner(options);
  assert.equal(sourceReads, 0, 'unchanged input and identity reuse validated intermediates');
  for (let i = 0; i < paths.length; i++) await writeJsonlRunFile(paths[i], [String.fromCharCode(100 + i)]);
  await mergeRunsWithPlanner(options);
  assert.deepEqual(await readOutput(), ['d', 'e', 'f'], 'same paths and sizes with changed bytes must not reuse old runs');
  const checkpoint = JSON.parse(await fs.readFile(options.checkpointPath, 'utf8'));
  await writeJsonlRunFile(checkpoint.passes[0][0].path, ['stale']);
  const result = await mergeRunsWithPlanner(options);
  assert.deepEqual(await readOutput(), ['d', 'e', 'f'], 'tampered intermediate is recomputed');
  await result.cleanup();
  await mergeRunsWithPlanner(options);
  sourceReads = 0;
  await mergeRunsWithPlanner({ ...options, compareId: 'text-asc-v2' });
  assert.equal(sourceReads, 3, 'changed comparator generation must recompute inputs');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('spill checkpoints bind input contents and validate cached outputs');

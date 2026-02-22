#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'embedding-bakeoff-resume-'));
const checkpointPath = path.join(tempRoot, 'bakeoff.json');
const cacheRoot = path.join(tempRoot, 'cache');

const runBakeoff = () => spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'bench', 'embeddings', 'model-bakeoff.js'),
    '--repo',
    root,
    '--models',
    'Xenova/bge-small-en-v1.5',
    '--skip-eval',
    '--skip-compare',
    '--no-build',
    '--cache-root',
    cacheRoot,
    '--checkpoint',
    checkpointPath,
    '--json'
  ],
  { cwd: root, encoding: 'utf8' }
);

const firstRun = runBakeoff();
if (firstRun.status !== 0) {
  console.error(firstRun.stderr || firstRun.stdout || '');
  throw new Error(`first bakeoff run failed (${firstRun.status})`);
}
const firstPayload = JSON.parse(String(firstRun.stdout || '{}'));
assert.equal(firstPayload.progress?.status, 'completed');
assert.equal(firstPayload.progress?.completedModels, 1);
assert.equal(firstPayload.progress?.resumedModels, 0);
assert.ok(fs.existsSync(checkpointPath), 'checkpoint file should exist after first run');

const secondRun = runBakeoff();
if (secondRun.status !== 0) {
  console.error(secondRun.stderr || secondRun.stdout || '');
  throw new Error(`second bakeoff run failed (${secondRun.status})`);
}
const secondPayload = JSON.parse(String(secondRun.stdout || '{}'));
assert.equal(secondPayload.progress?.status, 'completed');
assert.equal(secondPayload.progress?.completedModels, 1);
assert.equal(secondPayload.progress?.resumedModels, 1);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('embedding model bakeoff resume test passed');

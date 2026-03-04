#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadCheckpointSlices } from '../../../src/index/build/build-state/checkpoints.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-checkpoint-index-guard-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

const outsidePayloadPath = path.join(tempRoot, 'escape.json');
await fs.writeFile(
  outsidePayloadPath,
  JSON.stringify({ stage1: { checkpoints: [{ stage: 'stage1', step: 'discover' }] } }),
  'utf8'
);

const indexPath = path.join(buildRoot, 'stage_checkpoints.v1.index.json');
await fs.writeFile(indexPath, JSON.stringify({
  version: 1,
  updatedAt: new Date().toISOString(),
  modes: {
    code: {
      path: '../escape.json',
      updatedAt: new Date().toISOString()
    }
  }
}), 'utf8');

const loaded = await loadCheckpointSlices(buildRoot);
assert.equal(loaded, null, 'expected unsafe checkpoint descriptor path to be ignored');
await fs.access(outsidePayloadPath);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('checkpoint index traversal guard test passed');

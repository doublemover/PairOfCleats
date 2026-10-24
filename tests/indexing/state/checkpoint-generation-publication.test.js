#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCheckpointSlices, mergeStageCheckpoints, resolveCheckpointIndexPath,
  writeCheckpointSlices } from '../../../src/index/build/build-state/checkpoints.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-checkpoint-generation-'));
try {
  for (const deletion of [false, true]) {
    const buildRoot = path.join(root, String(deletion)); await fs.mkdir(buildRoot);
    const original = { code: { stage1: { done: 1 } }, prose: { stage1: { done: 2 } } };
    const cache = {};
    await writeCheckpointSlices(buildRoot, { checkpointPatch: original, mergedCheckpoints: original, cache });
    const indexPath = resolveCheckpointIndexPath(buildRoot);
    const priorIndex = await fs.readFile(indexPath);
    const descriptors = JSON.parse(priorIndex).modes;
    const oldBytes = await fs.readFile(path.join(buildRoot, descriptors.code.path));
    const patch = { code: deletion ? null : { stage2: { done: 3 } } };
    const merged = mergeStageCheckpoints(original, patch);
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (to === indexPath) throw Object.assign(new Error('index commit failure'), { code: 'EIO' });
      return rename(from, to);
    };
    try {
      await assert.rejects(writeCheckpointSlices(buildRoot, { checkpointPatch: patch, mergedCheckpoints: merged, cache }),
        error => error.code === 'ERR_ATOMIC_WRITE' && error.cause?.code === 'EIO');
    } finally { fs.rename = rename; }
    assert.deepEqual(await fs.readFile(indexPath), priorIndex);
    assert.deepEqual(await fs.readFile(path.join(buildRoot, descriptors.code.path)), oldBytes);
    assert.deepEqual(await loadCheckpointSlices(buildRoot), original);
    assert.deepEqual(cache.stageCheckpoints, original);
    await writeCheckpointSlices(buildRoot, { checkpointPatch: patch, mergedCheckpoints: merged, cache });
    assert.deepEqual(await loadCheckpointSlices(buildRoot), merged);
    assert.deepEqual(await fs.readFile(path.join(buildRoot, descriptors.code.path)), oldBytes,
      'readers holding the old index retain their original slice');
  }
  const buildRoot = path.join(root, 'empty-index'); await fs.mkdir(buildRoot);
  await fs.writeFile(path.join(buildRoot, 'build_state.stage-checkpoints.json'), '{"code":{"stale":true}}');
  await fs.writeFile(resolveCheckpointIndexPath(buildRoot), '{"version":1,"modes":{}}');
  assert.deepEqual(await loadCheckpointSlices(buildRoot), {}, 'committed deletion cannot revive a legacy mode');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('checkpoint generations preserve old authority across failed index replacement and deletion');

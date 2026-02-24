#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPatchQueue } from '../../../src/index/build/build-state/patch-queue.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-patch-queue-retry-'));
const buildRoot = path.join(tempRoot, 'build');
await fs.mkdir(buildRoot, { recursive: true });

let applyCount = 0;
const applied = [];
const observedErrors = [];
const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...(base || {}), ...(patch || {}) }),
  applyStatePatch: async (_root, patch, events) => {
    applyCount += 1;
    if (applyCount === 1) {
      throw new Error('synthetic apply failure');
    }
    applied.push({ patch, events });
    return { ok: true };
  },
  recordStateError: (_buildRoot, err) => {
    observedErrors.push(err?.message || String(err));
  }
});

await assert.rejects(
  queue.queueStatePatch(buildRoot, { first: true }, [{ type: 'first' }], { flushNow: true }),
  /synthetic apply failure/,
  'expected first flush to fail'
);

await queue.queueStatePatch(buildRoot, { second: true }, [{ type: 'second' }], { flushNow: true });
await queue.flushBuildState(buildRoot);

assert.equal(observedErrors.length, 1, 'expected one recorded state error');
assert.equal(applied.length, 1, 'expected one successful apply after retry');
assert.deepEqual(
  applied[0].patch,
  { first: true, second: true },
  'expected failed patch to be merged into next successful flush'
);
assert.deepEqual(
  applied[0].events.map((event) => event.type),
  ['first', 'second'],
  'expected failed flush events to be preserved in order'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('patch queue retry preserves events test passed');

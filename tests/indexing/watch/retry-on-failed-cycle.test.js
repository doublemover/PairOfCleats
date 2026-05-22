#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-retry-failed-cycle-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
const fileA = path.join(repoRoot, 'src', 'a.js');
await fs.writeFile(fileA, 'export const a = 1;\n');
const statA = await fs.stat(fileA);

const runtime = await createWatchRuntime({ repoRoot });

let buildAttempts = 0;
const { deps, getOnEvent } = createWatchDeps({
  entries: [{ abs: fileA, rel: 'src/a.js', stat: statA }],
  buildIndexForMode: async () => {
    buildAttempts += 1;
    if (buildAttempts === 1) {
      throw new Error('synthetic watch build failure');
    }
  }
});

const {
  abortController,
  ready,
  watchPromise
} = startCodeWatch({
  runtime,
  deps
});

let testError = null;
try {
  await ready;
  const onEventRef = getOnEvent();
  assert.ok(onEventRef, 'expected watcher to register event handler');
  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => buildAttempts >= 2, 5000);
} catch (error) {
  testError = error;
} finally {
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

if (testError) {
  throw testError;
}

assert.ok(buildAttempts >= 2, 'expected failed cycle to replay queued backlog');
console.log('watch retry on failed cycle test passed');

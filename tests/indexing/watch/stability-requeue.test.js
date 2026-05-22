#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const { tempRoot, repoRoot, files } = await createTempWatchRepo({
  prefix: 'poc-watch-stability-requeue-',
  files: {
    a: {
      rel: 'src/a.js',
      content: 'export const a = 1;\n'
    }
  }
});
const fileA = files.a.abs;
const runtime = await createWatchRuntime({ repoRoot });
let buildCount = 0;

const { deps, getOnEvent } = createWatchDeps({
  entries: [files.a],
  backend: 'parcel',
  buildIndexForMode: async () => {
    buildCount += 1;
  }
});

const {
  abortController,
  ready,
  watchPromise
} = startCodeWatch({
  runtime,
  deps,
  debounceMs: 120
});

let churnTimer = null;
let stopChurnTimer = null;
let testError = null;
try {
  await ready;
  const onEventRef = getOnEvent();
  assert.ok(onEventRef, 'expected watcher to register event handler');
  churnTimer = setInterval(() => {
    void fs.appendFile(fileA, '// churn\n').catch(() => {});
  }, 25);
  stopChurnTimer = setTimeout(() => {
    clearInterval(churnTimer);
    churnTimer = null;
  }, 700);
  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => buildCount >= 1, 7000);
} catch (error) {
  testError = error;
} finally {
  if (stopChurnTimer) clearTimeout(stopChurnTimer);
  if (churnTimer) clearInterval(churnTimer);
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

if (testError) {
  throw testError;
}

assert.ok(buildCount >= 1, 'expected unstable updates to be requeued until stable');
console.log('watch stability requeue test passed');

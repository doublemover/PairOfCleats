#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createWatchDeps,
  createWatchRuntime,
  normalizeAbsPath,
  startCodeWatch,
  waitFor
} from './helpers.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-update-queue-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
const fileA = path.join(repoRoot, 'src', 'a.js');
const fileB = path.join(repoRoot, 'src', 'b.js');
const fileBKey = normalizeAbsPath(fileB);
await fs.writeFile(fileA, 'export const a = 1;\n');
await fs.writeFile(fileB, 'export const b = 2;\n');
const statA = await fs.stat(fileA);

const runtime = await createWatchRuntime({ repoRoot });

const observedBuildSnapshots = [];
const { deps, getOnEvent } = createWatchDeps({
  entries: [{ abs: fileA, rel: 'src/a.js', stat: statA }],
  buildIndexForMode: async ({ discovery }) => {
    const entries = Array.isArray(discovery?.entries)
      ? discovery.entries.map((entry) => normalizeAbsPath(entry.abs)).filter(Boolean).sort()
      : [];
    const skipped = Array.isArray(discovery?.skippedFiles)
      ? discovery.skippedFiles.map((entry) => normalizeAbsPath(entry.file)).filter(Boolean).sort()
      : [];
    observedBuildSnapshots.push({ entries, skipped });
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

await ready;
const onEventRef = getOnEvent();
assert.ok(onEventRef, 'expected watcher to register event handler');

const originalArrayFrom = Array.from;
let injectedSecondEvent = false;

Array.from = function patchedArrayFrom(value, ...rest) {
  const output = originalArrayFrom.call(Array, value, ...rest);
  if (
    !injectedSecondEvent
    && value instanceof Set
    && output.includes(fileA)
    && !output.includes(fileB)
    && onEventRef
  ) {
    injectedSecondEvent = true;
    onEventRef({ type: 'change', absPath: fileB });
  }
  return output;
};

let testError = null;
try {
  await onEventRef({ type: 'change', absPath: fileA });
  await waitFor(() => observedBuildSnapshots.length >= 1);
  try {
    await waitFor(
      () => observedBuildSnapshots.some((snapshot) => (
        snapshot.entries.includes(fileBKey) || snapshot.skipped.includes(fileBKey)
      )),
      5000
    );
  } catch (error) {
    throw new Error(`Timed out waiting for fileB update. snapshots=${JSON.stringify(observedBuildSnapshots)}`, {
      cause: error
    });
  }
  assert.equal(injectedSecondEvent, true, 'expected second event injection during update flush');
} catch (error) {
  testError = error;
} finally {
  Array.from = originalArrayFrom;
  abortController.abort();
  await watchPromise;
}

if (testError) {
  throw testError;
}

console.log('watch update queue no-loss test passed');

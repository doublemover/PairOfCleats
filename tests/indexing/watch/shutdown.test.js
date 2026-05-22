#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

// Early shutdown should not throw.
{
  const { repoRoot, files } = await createTempWatchRepo({
    prefix: 'poc-watch-shutdown-early-',
    files: {
      index: {
        rel: 'src/index.js',
        content: 'export const value = 1;\n'
      }
    }
  });
  const runtime = await createWatchRuntime({ repoRoot });
  const { deps } = createWatchDeps({
    entries: [files.index],
    buildIndexForMode: async () => {}
  });
  const {
    abortController,
    watchPromise
  } = startCodeWatch({
    runtime,
    deps
  });
  abortController.abort();
  await watchPromise;
}

// Shutdown during active build releases lock.
{
  const { repoRoot, files } = await createTempWatchRepo({
    prefix: 'poc-watch-shutdown-active-',
    files: {
      index: {
        rel: 'src/index.js',
        content: 'export const value = 1;\n'
      }
    }
  });
  const filePath = files.index.abs;
  const runtime = await createWatchRuntime({ repoRoot });
  const { repoCacheRoot } = runtime;

  let buildStartedResolve;
  const buildStarted = new Promise((resolve) => { buildStartedResolve = resolve; });
  const { deps, getOnEvent } = createWatchDeps({
    entries: [files.index],
    buildIndexForMode: async ({ abortSignal }) => {
      buildStartedResolve();
      if (abortSignal?.aborted) return;
      await new Promise((resolve) => {
        abortSignal?.addEventListener('abort', resolve, { once: true });
      });
    }
  });

  const {
    abortController,
    watchPromise
  } = startCodeWatch({
    runtime,
    deps
  });

  await waitFor(() => Boolean(getOnEvent()));
  const onEventRef = getOnEvent();
  await onEventRef({ type: 'change', absPath: filePath });
  await buildStarted;
  abortController.abort();
  await watchPromise;

  const lockPath = path.join(repoCacheRoot, 'locks', 'index.lock');
  assert.equal(fsSync.existsSync(lockPath), false, 'expected lock to be released');
}

console.log('watch shutdown tests passed');

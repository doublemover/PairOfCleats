#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const { repoRoot, files } = await createTempWatchRepo({
  prefix: 'poc-watch-atomicity-',
  files: {
    index: {
      rel: 'src/index.js',
      content: 'export const value = 1;\n'
    }
  }
});
const filePath = files.index.abs;
const runtime = await createWatchRuntime({ repoRoot });
const { repoCacheRoot, userConfig } = runtime;

const buildsRoot = path.join(repoCacheRoot, 'builds');
const prevRoot = path.join(buildsRoot, 'prev-build');
await fs.mkdir(prevRoot, { recursive: true });
await seedPublishedArtifacts({ buildRoot: prevRoot, mode: 'code', buildId: 'prev-build' });
await promoteBuild({
  repoRoot,
  userConfig,
  buildId: 'prev-build',
  buildRoot: prevRoot,
  modes: ['code']
});
const currentPath = path.join(buildsRoot, 'current.json');
const prevCurrent = JSON.parse(await fs.readFile(currentPath, 'utf8'));

let buildCalls = 0;
const { deps, getOnEvent } = createWatchDeps({
  entries: [files.index],
  buildIndexForMode: async () => {
    buildCalls += 1;
    throw new Error('forced build failure');
  },
  validateIndexArtifacts: async () => {
    throw new Error('validate should not be called on build failure');
  },
  promoteBuild: async () => {
    throw new Error('promote should not be called on build failure');
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
await onEventRef({ type: 'change', absPath: filePath });
await waitFor(() => buildCalls >= 1);
abortController.abort();
await watchPromise;

const nextCurrent = JSON.parse(await fs.readFile(currentPath, 'utf8'));
assert.equal(nextCurrent.buildId, prevCurrent.buildId, 'expected current.json to remain unchanged');
assert.equal(nextCurrent.buildRoot, prevCurrent.buildRoot, 'expected buildRoot to remain unchanged');

console.log('watch atomicity test passed');

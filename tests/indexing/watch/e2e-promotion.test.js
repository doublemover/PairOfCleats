#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const { repoRoot, files } = await createTempWatchRepo({
  prefix: 'poc-watch-e2e-',
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

const buildsRoot = path.join(repoCacheRoot, 'builds');
const currentPath = path.join(buildsRoot, 'current.json');
const events = [];

const { deps, getOnEvent } = createWatchDeps({
  entries: [files.index],
  buildIndexForMode: async ({ runtime: runtimeRef }) => {
    events.push('build');
    await fs.mkdir(runtimeRef.buildRoot, { recursive: true });
    await seedPublishedArtifacts({
      buildRoot: runtimeRef.buildRoot,
      mode: 'code',
      buildId: path.basename(runtimeRef.buildRoot)
    });
  },
  validateIndexArtifacts: async () => {
    events.push('validate');
    assert.equal(fsSync.existsSync(currentPath), false, 'expected current.json to be absent before promotion');
    return { ok: true, issues: [], warnings: [] };
  },
  promoteBuild: async (args) => {
    events.push('promote');
    return promoteBuild(args);
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

await waitFor(() => events.includes('promote'));
abortController.abort();
await watchPromise;

const currentRaw = await fs.readFile(currentPath, 'utf8');
const current = JSON.parse(currentRaw);
const promotedRoot = current.buildRoot ? path.join(repoCacheRoot, current.buildRoot) : null;
assert.ok(promotedRoot, 'expected current.json buildRoot');
assert.ok(fsSync.existsSync(promotedRoot), 'expected promoted build root to exist');
assert.ok(events.indexOf('promote') > events.indexOf('validate'), 'expected promote after validate');

console.log('watch e2e promotion test passed');

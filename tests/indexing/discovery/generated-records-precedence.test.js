#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { withGeneratedArtifactMetadata } from '../../../src/shared/generated-artifact-core.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, waitFor } from '../watch/helpers.js';

const { tempRoot, repoRoot } = await createTempWatchRepo({
  prefix: 'poc-record-provenance-', files: { source: { rel: 'src/source.js', content: 'export const source = 1;' } }
});
const recordsDir = path.join(repoRoot, 'records');
const includedDir = path.join(repoRoot, 'included');
const cacheDir = path.join(repoRoot, 'cache');
const marked = JSON.stringify(withGeneratedArtifactMetadata({ mode: 'code' }, 'index-state'));
const recordPaths = [path.join(recordsDir, 'index_state.json'), path.join(includedDir, 'index_state.json')];
const cachePath = path.join(cacheDir, 'index_state.json');
const recordsConfig = { includeGlobs: ['included/**'], detect: false };
const ignoreMatcher = { ignores: () => false };
try {
  for (const dir of [recordsDir, includedDir, cacheDir]) await fs.mkdir(dir);
  for (const file of [...recordPaths, cachePath]) await fs.writeFile(file, marked);
  const skippedByMode = { code: [], records: [] };
  const found = await discoverFilesForModes({ root: repoRoot, modes: ['code', 'records'],
    recordsDir, recordsConfig, ignoreMatcher, skippedByMode });
  assert.deepEqual(found.records.map(entry => entry.abs).sort(), recordPaths.sort(),
    'explicit records routing must precede owned metadata omission');
  assert.ok(found.code.every(entry => !recordPaths.includes(entry.abs)));
  assert.ok(skippedByMode.code.some(entry => entry.file === cachePath && entry.reason === 'generated-artifact'));
  assert.ok(skippedByMode.code.filter(entry => recordPaths.includes(entry.file)).every(entry => entry.reason === 'records'));

  const runtime = { ...await createWatchRuntime({ repoRoot }), recordsDir, recordsConfig, ignoreMatcher };
  const builds = [];
  const states = [];
  const { deps, getOnEvent } = createWatchDeps({ entries: [], buildIndexForMode: async ({ mode, discovery }) => {
    builds.push({ mode, discovery });
  } });
  deps.discoverFilesForModes = async () => ({ code: [], records: [] });
  const controller = new AbortController();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const watching = watchIndex({ runtime, modes: ['code', 'records'], debounceMs: 10, pollMs: 0,
    abortSignal: controller.signal, handleSignals: false, deps,
    onReady: readyResolve, onStateChange: state => states.push(state) });
  try {
    await ready;
    for (const file of [...recordPaths, cachePath]) getOnEvent()({ type: 'add', absPath: file });
    await waitFor(() => builds.some(build => build.mode === 'records' && build.discovery.entries.length === 2));
    await waitFor(() => states.at(-1)?.quiescent === true);
    const recordsBuild = builds.find(build => build.mode === 'records' && build.discovery.entries.length === 2);
    assert.deepEqual(recordsBuild.discovery.entries.map(entry => entry.abs).sort(), recordPaths.sort());
    assert.ok(builds.filter(build => build.mode === 'code').every(build => build.discovery.entries.length === 0));
    assert.ok(recordsBuild.discovery.skippedFiles.some(entry => entry.file === cachePath && entry.reason === 'generated-artifact'));
    for (const file of recordPaths) {
      await fs.rm(file);
      getOnEvent()({ type: 'unlink', absPath: file });
    }
    await waitFor(() => builds.some(build => build.mode === 'records' && build.discovery.entries.length === 0));
  } finally { controller.abort(); await watching; }
  console.log('Explicit records roots/globs survive provenance discovery and repeated watch membership updates.');
} finally { await fs.rm(tempRoot, { recursive: true, force: true }); }

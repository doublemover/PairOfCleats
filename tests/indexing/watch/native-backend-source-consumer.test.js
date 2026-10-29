import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import chokidar from 'chokidar';
import { createTempWatchRepo, createWatchRuntime, createWatchDeps, startCodeWatch, waitFor } from './helpers.js';
const backend = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/watch/native-backend-source-consumer/')[1];
assert.ok(['chokidar', 'parcel'].includes(backend));
const repo = await createTempWatchRepo({ prefix: 'poc-real-watch-owner-', files: { source: { rel: 'source.js', content: 'export const oldValue = 1;\n' } } });
const builds = [], publications = []; let backendReady = null;
const originalWatch = chokidar.watch;
try {
  if (backend === 'chokidar') chokidar.watch = function (...args) { const watcher = originalWatch.apply(this, args); backendReady = once(watcher, 'ready'); return watcher; };
  const { deps } = createWatchDeps({ backend, entries: [repo.files.source], buildIndexForMode: async ({ discovery }) => {
    builds.push(await Promise.all(discovery.entries.map(async entry => ({ file: entry.rel, text: await fs.readFile(entry.abs, 'utf8') }))));
  }, promoteBuild: async () => { publications.push(builds.at(-1)); } });
  delete deps.startWatcher;
  const runtime = await createWatchRuntime({ repoRoot: repo.repoRoot });
  const watch = startCodeWatch({ runtime, deps });
  try {
    await watch.ready; if (backendReady) await backendReady;
    await fs.writeFile(repo.files.source.abs, 'export const nativeSentinel = 2;\n');
    await waitFor(() => publications.length > 0 && runtime.watchState.quiescent);
    assert.deepEqual(publications.at(-1), [{ file: 'source.js', text: 'export const nativeSentinel = 2;\n' }]);
    watch.abortController.abort(); await watch.watchPromise;
    const count = publications.length; await fs.writeFile(repo.files.source.abs, 'export const afterClose = 3;\n');
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(publications.length, count);
  } finally { watch.abortController.abort(); await watch.watchPromise; }
} finally { chokidar.watch = originalWatch; await fs.rm(repo.tempRoot, { recursive: true, force: true }); }
console.log('Actual ' + backend + ' backend delivers one ordinary-file edit through discovery/publication and closes its owner.');

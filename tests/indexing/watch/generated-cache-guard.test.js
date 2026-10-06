#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createMapCacheEnvelope, generatedMapCacheIdentity } from '../../../src/shared/generated-artifact.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const { tempRoot, repoRoot, files } = await createTempWatchRepo({
  prefix: 'poc-watch-generated-cache-', files: { source: { rel: 'src/source.js', content: 'export const sourceValue = 1;' } }
});
const runtime = await createWatchRuntime({ repoRoot });
const builds = [];
const states = [];
const { deps, getOnEvent } = createWatchDeps({ entries: [files.source],
  buildIndexForMode: async ({ discovery }) => { builds.push(discovery); }
});
const { abortController, ready, watchPromise } = startCodeWatch({ runtime, deps,
  onStateChange: state => states.push(state) });
try {
  await ready;
  const identity = generatedMapCacheIdentity('watch-fixture');
  const cache = path.join(repoRoot, 'custom-cache', identity.fileName);
  await fs.mkdir(path.dirname(cache));
  await fs.writeFile(cache, JSON.stringify(createMapCacheEnvelope({ nodes: [], edges: [] }, identity.key)));
  const event = getOnEvent();
  const stateOffset = states.length;
  event({ type: 'add', absPath: cache });
  await waitFor(() => states.slice(stateOffset).some(state => state.backlogDepth > 0));
  await waitFor(() => states.at(-1)?.quiescent === true && states.at(-1)?.backlogDepth === 0);
  assert.equal(builds.length, 0, 'writing generated cache alone must not schedule an index rebuild');
  const authored = path.join(path.dirname(cache), 'authored.js');
  await fs.writeFile(authored, 'export const authoredValue = 2;');
  event({ type: 'add', absPath: authored });
  await waitFor(() => builds.length > 0);
  assert.ok(builds[0].entries.some(entry => entry.abs === authored));
  assert.ok(!builds[0].entries.some(entry => entry.abs === cache));
  assert.ok(builds[0].skippedFiles.some(entry => entry.file === cache && entry.reason === 'generated-artifact'));
  await fs.rm(cache);
  event({ type: 'unlink', absPath: cache });
  await waitFor(() => states.at(-1)?.quiescent === true && states.at(-1)?.backlogDepth === 0);
  console.log('Watch cache writes/deletes stay quiescent, while authored siblings still rebuild.');
} finally {
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

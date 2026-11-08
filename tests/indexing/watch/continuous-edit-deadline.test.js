import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, startCodeWatch, waitFor } from './helpers.js';

const { tempRoot, repoRoot, files } = await createTempWatchRepo({ prefix: 'poc-watch-deadline-',
  files: { source: { rel: 'src/api.js', content: 'export const revision = 0;\n' } } });
const runtime = await createWatchRuntime({ repoRoot });
const builds = [];
let started;
const { deps, getOnEvent } = createWatchDeps({ entries: [files.source], buildIndexForMode: async () => {
  builds.push({ elapsedMs: performance.now() - started, source: await fs.readFile(files.source.abs, 'utf8') });
} });
const { ready, abortController, watchPromise } = startCodeWatch({ runtime, deps, debounceMs: 200 });
try {
  await ready;
  started = performance.now();
  for (let i = 1; i <= 30; i += 1) {
    await fs.writeFile(files.source.abs, `export const revision = ${i};\n`);
    await getOnEvent()({ type: 'change', absPath: files.source.abs });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(builds.length > 0, 'continuous edits start a build before the stream ends');
  assert.ok(builds[0].elapsedMs < 1500, 'one-second scheduling deadline has bounded event-loop tolerance');
  await waitFor(() => builds.at(-1)?.source.includes('revision = 30;') && runtime.watchState?.consistency === 'consistent');
  console.log(JSON.stringify({ scope: 'real file edits, production watch queue, stubbed index build', builds }));
} finally {
  abortController.abort();
  await watchPromise;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

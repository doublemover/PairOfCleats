import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIndex } from '../../../src/integrations/core/build-index.js';
import { search } from '../../../src/integrations/core/search.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-edit-search-'));
const repo = path.join(root, 'repo');
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }, sqlite: { use: false }
} });
const controller = new AbortController();
let watch;
try {
  await fs.mkdir(repo);
  const source = path.join(repo, 'api.js');
  await fs.writeFile(source, 'export function previousRevision() { return 1; }\n');
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  let publishedResolve;
  const published = new Promise((resolve) => { publishedResolve = resolve; });
  watch = buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, watch: true,
    'watch-debounce': 50, 'watch-poll': 0, abortSignal: controller.signal,
    onWatchReady: readyResolve, onWatchStateChange: (state) => {
      if (state.consistency === 'consistent' && state.lastConsistentGeneration) publishedResolve(state);
    } });
  await Promise.race([ready, watch.then(() => { throw new Error('watch exited before readiness'); })]);
  const started = performance.now();
  await fs.writeFile(source, 'export function searchableRevision() { return 2; }\n');
  const state = await Promise.race([published, watch.then(() => { throw new Error('watch exited before publication'); })]);
  const publishMs = Math.round(performance.now() - started);
  const result = await search(repo, { query: 'searchableRevision', mode: 'code', backend: 'memory', top: 3 });
  assert.ok(result.code.some((hit) => hit.file === 'api.js'), JSON.stringify(result));
  const elapsedMs = Math.round(performance.now() - started);
  assert.ok(elapsedMs < 15000, `edit-to-search took ${elapsedMs}ms`);
  console.log(JSON.stringify({ scope: 'real filesystem watch, index build, promotion and search', publishMs,
    editToSearchMs: elapsedMs, generation: state.lastConsistentGeneration.buildId }));
} finally {
  controller.abort();
  if (watch) await watch;
  await fs.rm(root, { recursive: true, force: true });
}

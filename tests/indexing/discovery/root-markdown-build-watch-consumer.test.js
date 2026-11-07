import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';
import { watchIndex } from '../../../src/index/build/watch.js';
import { createFileProcessorForTest } from '../file-processor/file-processor-fixture.js';
import { createTempWatchRepo, createWatchDeps, createWatchRuntime, waitFor } from '../watch/helpers.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const text = '# Intro\nRoot prose.\n## Next\nMore root prose.\n';
const { tempRoot, repoRoot } = await createTempWatchRepo({ prefix: 'poc-root-markdown-', files: {
  markdown: { rel: 'README.markdown', content: text }, md: { rel: 'README.md', content: text },
  unsupported: { rel: 'README.unsupported-format', content: text } } });
try {
  applyTestEnv({ cacheRoot: tempRoot, embeddings: 'stub', testConfig: { indexing: {
    workerPool: { enabled: false }, embeddings: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false } } });
  const runtime = await createWatchRuntime({ repoRoot });
  const found = await discoverFilesForModes({ root: repoRoot, modes: ['code', 'prose'], ignoreMatcher: runtime.ignoreMatcher,
    scmProvider: 'none', skippedByMode: { code: [], prose: [] } });
  assert.deepEqual(found.prose.map(row => row.rel.replaceAll('\\', '/')).sort(), ['README.markdown', 'README.md']);
  assert.equal(found.code.some(row => row.rel.startsWith('README.')), false);
  await buildIndex(repoRoot, { mode: 'prose', stage: 'stage2', threads: 1, 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repoRoot, 'prose', loadUserConfig(repoRoot));
  const published = await loadChunkMeta(indexDir, { strict: true });
  for (const file of ['README.markdown', 'README.md']) {
    const rows = published.filter(row => row.file === file);
    assert.deepEqual(rows.map(row => row.name), ['Intro', 'Next'], 'ordinary root files publish independently expected heading-aware prose artifacts');
    assert.ok(rows.every(row => row.chunkUid && row.start >= 0 && row.end <= text.length));
  }
  assert.equal(published.some(row => row.file === 'README.unsupported-format'), false);
  const builds = [];
  const { deps, getOnEvent } = createWatchDeps({ entries: [], buildIndexForMode: async ({ mode, discovery }) => {
    const processor = createFileProcessorForTest({ root: repoRoot, mode });
    const chunks = [];
    for (const [index, entry] of discovery.entries.entries()) chunks.push(...(await processor.processFile(entry, index)).chunks);
    builds.push({ mode, entries: discovery.entries, chunks });
  } });
  deps.discoverFilesForModes = async () => ({ code: [], prose: [] });
  const controller = new AbortController(); let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const watching = watchIndex({ runtime, modes: ['code', 'prose'], debounceMs: 10, pollMs: 0,
    abortSignal: controller.signal, handleSignals: false, deps, onReady: readyResolve });
  try {
    await ready;
    for (const file of ['README.markdown', 'README.md', 'README.unsupported-format']) getOnEvent()({ type: 'add', absPath: path.join(repoRoot, file) });
    await waitFor(() => builds.some(build => build.mode === 'prose' && build.entries.length === 2));
    const product = builds.find(build => build.mode === 'prose' && build.entries.length === 2);
    for (const file of ['README.markdown', 'README.md']) assert.deepEqual(product.chunks.filter(row =>
      process.platform === 'win32' ? row.file.toLowerCase() === file.toLowerCase() : row.file === file).map(row => row.name), ['Intro', 'Next']);
    assert.ok(builds.filter(build => build.mode === 'code').every(build => build.entries.length === 0));
    assert.equal(product.chunks.some(row => row.file === 'README.unsupported-format'), false);
  } finally { controller.abort(); await watching; }
} finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
console.log('Ordinary root Markdown extensions reach actual published prose and watch chunk consumers; unsupported files remain excluded.');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { search as coreSearch } from '../../../src/integrations/core/search.js';
import { getMetricsDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { writeFederationRepoFixture } from '../federation/repo-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-engine-cache-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot, embeddings: 'off', testConfig: { quality: 'balanced' }, extraEnv: {
  PAIROFCLEATS_QUERY_CACHE_STRATEGY: 'memory-first',
  PAIROFCLEATS_QUERY_CACHE_MEMORY_FRESH_MS: '1000',
  PAIROFCLEATS_QUERY_CACHE_PREWARM: 'false'
} });
try {
  const repoRoot = path.join(root, 'repo');
  const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot });
  const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { compatibilityKey: 'query-cache-engine' });
  const writeChunk = name => fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{
    id: 0, file: 'source.js', chunkUid: 'source:alpha', name, kind: 'FunctionDeclaration',
    start: 0, end: 1, tokens: ['alpha'], text: 'alpha'
  }]));
  await writeChunk('original-alpha');
  const options = { query: 'alpha', argsMode: 'complete',
    args: ['--mode', 'code', '--backend', 'memory', '--no-ann', '--no-comments', '--json', '--stats'],
    emitOutput: false, exitOnError: false };
  const cold = await coreSearch(repoRoot, options);
  assert.equal(cold.stats.cache.hit, false);
  assert.equal(cold.code[0].name, 'original-alpha');
  const queryCachePath = path.join(descriptor.repoCacheRoot, 'query-cache', 'queryCache.json');
  const canonical = await fs.readFile(queryCachePath, 'utf8');
  const warm = await coreSearch(repoRoot, options);
  assert.equal(warm.stats.cache.hit, true);
  assert.equal(warm.retrieval.cache.memoryHotPath, true);
  assert.equal(await fs.readFile(queryCachePath, 'utf8'), canonical, 'the actual core memory-first hit publishes only recency metadata');
  warm.code[0].name = 'caller-renderer-mutation';
  assert.equal((await coreSearch(repoRoot, options)).code[0].name, 'original-alpha');
  const statePath = path.join(indexDir, 'index_state.json');
  await writeChunk('next-alpha');
  await fs.writeFile(statePath, JSON.stringify({ ...JSON.parse(await fs.readFile(statePath, 'utf8')), buildId: 'changed-index-generation' }));
  const changed = await coreSearch(repoRoot, options);
  assert.equal(changed.stats.cache.hit, false, 'changed generation must not reuse the resident old payload');
  assert.equal(changed.code[0].name, 'next-alpha');
  assert.equal((await coreSearch(repoRoot, options)).stats.cache.hit, true);
  const metricsDir = getMetricsDir(repoRoot, loadUserConfig(repoRoot));
  const metrics = JSON.parse(await fs.readFile(path.join(metricsDir, 'metrics.json'), 'utf8'));
  const history = (await fs.readFile(path.join(metricsDir, 'searchHistory'), 'utf8')).trim().split('\n');
  assert.equal(history.length, 5);
  assert.equal(metrics['source.js'].code, 5, 'metadata-only cache maintenance does not coalesce authoritative successful-search metrics');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(coreSearch(repoRoot, { ...options, signal: controller.signal }), error => {
    assert.equal(error.code, 'CANCELLED'); assert.equal(error.cancelled, true); return true;
  });
  assert.equal((await fs.readFile(path.join(metricsDir, 'searchHistory'), 'utf8')).trim().split('\n').length, 5,
    'pre-cancelled requests cannot publish successful-search history');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual core search preserves cold/warm payload ownership, generation invalidation, awaited touches, cancellation, and authoritative metrics.');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildTreeSitterChunks,
  getTreeSitterStats,
  initTreeSitterWasm,
  preloadTreeSitterLanguages,
  resetTreeSitterParser,
  resetTreeSitterStats,
  shutdownTreeSitterWorkerPool
} from '../../../src/lang/tree-sitter.js';
import { getTreeSitterWorkerPool } from '../../../src/lang/tree-sitter/worker.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const timeout = setTimeout(() => {
  console.error('tree-sitter memory plateau test timed out');
  process.exit(1);
}, 25000);

const root = process.cwd();
const FIXTURES = [
  { languageId: 'javascript', ext: '.js', rel: path.join('tests', 'fixtures', 'tree-sitter', 'javascript.js') },
  { languageId: 'go', ext: '.go', rel: path.join('tests', 'fixtures', 'tree-sitter', 'go.go') },
  { languageId: 'rust', ext: '.rs', rel: path.join('tests', 'fixtures', 'tree-sitter', 'rust.rs') }
];

const log = () => {};

const resetAllCaches = () => {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });
  treeSitterState.languageCache.clear();
  treeSitterState.wasmLanguageCache.clear();
  treeSitterState.languageLoadPromises.clear();
  treeSitterState.queryCache.clear();
  treeSitterState.chunkCache.clear();
  treeSitterState.chunkCacheMaxEntries = null;
  treeSitterState.timeoutCounts.clear();
  treeSitterState.disabledLanguages.clear();
};

const loadFixtures = async () => {
  const out = [];
  for (const entry of FIXTURES) {
    out.push({
      ...entry,
      text: await fs.readFile(path.join(root, entry.rel), 'utf8')
    });
  }
  return out;
};

const assertCacheBounds = (stats, { maxLoadedLanguages, chunkCacheMaxEntries, maxLanguages }) => {
  assert.ok(stats, 'expected stats payload');
  assert.ok(
    Number(stats.cache?.wasmLanguages) <= maxLoadedLanguages,
    `expected wasmLanguages<=${maxLoadedLanguages} (got ${stats.cache?.wasmLanguages})`
  );
  assert.ok(
    Number(stats.cache?.queryEntries) <= maxLanguages,
    `expected queryEntries<=${maxLanguages} (got ${stats.cache?.queryEntries})`
  );
  assert.ok(
    Number(stats.cache?.chunkCacheEntries) <= chunkCacheMaxEntries,
    `expected chunkCacheEntries<=${chunkCacheMaxEntries} (got ${stats.cache?.chunkCacheEntries})`
  );
};

try {
  const ok = await initTreeSitterWasm({ log });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping memory plateau test.');
    process.exit(0);
  }

  const fixtures = await loadFixtures();
  const maxLoadedLanguages = 2;
  const chunkCacheMaxEntries = 8;

  // Main thread: repeated parses across languages should keep caches bounded.
  resetAllCaches();

  const optionsFor = (cacheKey) => ({
    log,
    treeSitter: {
      enabled: true,
      useQueries: true,
      chunkCache: true,
      chunkCacheMaxEntries,
      cacheKey,
      maxLoadedLanguages
    }
  });

  const iterations = 24;
  let maxWasmLanguages = 0;
  let maxChunkCacheEntries = 0;

  for (let i = 0; i < iterations; i += 1) {
    const fixture = fixtures[i % fixtures.length];
    await preloadTreeSitterLanguages([fixture.languageId], { log, parallel: false, maxLoadedLanguages });
    const chunks = buildTreeSitterChunks({
      text: fixture.text,
      languageId: fixture.languageId,
      ext: fixture.ext,
      options: optionsFor(`mem-main-${i}`)
    });
    assert.ok(Array.isArray(chunks) && chunks.length > 0, `expected chunks for ${fixture.languageId}`);

    const stats = getTreeSitterStats();
    maxWasmLanguages = Math.max(maxWasmLanguages, Number(stats.cache?.wasmLanguages) || 0);
    maxChunkCacheEntries = Math.max(maxChunkCacheEntries, Number(stats.cache?.chunkCacheEntries) || 0);
    assertCacheBounds(stats, {
      maxLoadedLanguages,
      chunkCacheMaxEntries,
      maxLanguages: fixtures.length
    });
  }

  assert.ok(maxWasmLanguages <= maxLoadedLanguages, 'expected wasm language cache to plateau');
  assert.ok(maxChunkCacheEntries <= chunkCacheMaxEntries, 'expected chunk cache to plateau');

  // Worker pool: run the same workload and sample stats inside the worker thread.
  await shutdownTreeSitterWorkerPool();
  const pool = await getTreeSitterWorkerPool(
    { enabled: true, maxWorkers: 1, idleTimeoutMs: 5000, taskTimeoutMs: 60000 },
    { log }
  );

  if (!pool) {
    console.log('tree-sitter worker pool unavailable; skipping worker memory plateau checks.');
    console.log('tree-sitter memory plateau test passed');
  } else {
    for (let i = 0; i < iterations; i += 1) {
      const fixture = fixtures[i % fixtures.length];
      const result = await pool.run(
        {
          text: fixture.text,
          languageId: fixture.languageId,
          ext: fixture.ext,
          treeSitter: {
            enabled: true,
            useQueries: true,
            chunkCache: true,
            chunkCacheMaxEntries,
            cacheKey: `mem-worker-${i}`,
            maxLoadedLanguages
          }
        },
        { name: 'parseTreeSitter' }
      );
      assert.ok(Array.isArray(result) && result.length > 0, `expected worker chunks for ${fixture.languageId}`);

      if ((i + 1) % 6 === 0) {
        const snapshot = await pool.run({}, { name: 'treeSitterWorkerStats' });
        assertCacheBounds(snapshot, {
          maxLoadedLanguages,
          chunkCacheMaxEntries,
          maxLanguages: fixtures.length
        });
      }
    }

    const finalWorkerStats = await pool.run({}, { name: 'treeSitterWorkerStats' });
    assertCacheBounds(finalWorkerStats, {
      maxLoadedLanguages,
      chunkCacheMaxEntries,
      maxLanguages: fixtures.length
    });

    console.log('tree-sitter memory plateau test passed');
  }
} finally {
  clearTimeout(timeout);
  await shutdownTreeSitterWorkerPool();
}

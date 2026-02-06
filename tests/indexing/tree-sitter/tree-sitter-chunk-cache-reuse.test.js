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
  resetTreeSitterStats
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const timeout = setTimeout(() => {
  console.error('tree-sitter chunk cache reuse test timed out');
  process.exit(1);
}, 15000);

const root = process.cwd();
const fixturePath = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const text = await fs.readFile(fixturePath, 'utf8');
const log = () => {};

try {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });
  treeSitterState.queryCache.clear();
  treeSitterState.chunkCache.clear();

  const ok = await initTreeSitterWasm({ log });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping chunk cache reuse test.');
    process.exit(0);
  }

  const languageId = 'javascript';
  const ext = '.js';
  const maxLoadedLanguages = 2;

  await preloadTreeSitterLanguages([languageId], { log, parallel: false, maxLoadedLanguages });

  // Query cache reuse (chunk cache disabled so we hit query compilation path twice).
  const queryOptions = {
    log,
    treeSitter: {
      enabled: true,
      useQueries: true,
      chunkCache: false,
      maxLoadedLanguages
    }
  };

  const first = buildTreeSitterChunks({ text, languageId, ext, options: queryOptions });
  assert.ok(Array.isArray(first) && first.length > 0, 'expected tree-sitter chunks for query cache test');

  const second = buildTreeSitterChunks({ text, languageId, ext, options: queryOptions });
  assert.deepStrictEqual(second, first, 'expected query-only chunking to be deterministic');

  const queryStats = getTreeSitterStats();
  assert.ok(Number(queryStats.queryBuilds) >= 1, 'expected query to be compiled at least once');
  assert.ok(Number(queryStats.queryHits) >= 1, 'expected query cache hit on second parse');

  // Chunk cache reuse (must avoid parser activation on cache hit).
  resetTreeSitterStats();
  treeSitterState.chunkCache.clear();

  const chunkOptions = {
    log,
    treeSitter: {
      enabled: true,
      useQueries: true,
      chunkCache: true,
      chunkCacheMaxEntries: 4,
      cacheKey: 'chunk-cache-reuse',
      maxLoadedLanguages
    }
  };

  const baseActivations = Number(getTreeSitterStats().parserActivations) || 0;
  const warm1 = buildTreeSitterChunks({ text, languageId, ext, options: chunkOptions });
  assert.ok(Array.isArray(warm1) && warm1.length > 0, 'expected tree-sitter chunks for chunk cache test');

  const afterFirst = getTreeSitterStats();
  assert.ok(Number(afterFirst.chunkCacheSets) >= 1, 'expected first parse to populate chunk cache');
  assert.ok(Number(afterFirst.chunkCacheHits) === 0, 'expected no chunk cache hits on first parse');

  const warm2 = buildTreeSitterChunks({ text, languageId, ext, options: chunkOptions });
  assert.deepStrictEqual(warm2, warm1, 'expected chunk cache hit to return identical chunks');

  const afterSecond = getTreeSitterStats();
  assert.ok(Number(afterSecond.chunkCacheHits) >= 1, 'expected chunk cache hit on second parse');
  assert.equal(
    Number(afterSecond.parserActivations) || 0,
    Number(afterFirst.parserActivations) || baseActivations,
    'expected parser activations to remain unchanged when chunk cache hits'
  );

  console.log('tree-sitter chunk cache reuse test passed');
} finally {
  clearTimeout(timeout);
}


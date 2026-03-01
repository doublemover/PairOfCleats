#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildTreeSitterChunks,
  getTreeSitterStats,
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  resetTreeSitterParser,
  resetTreeSitterStats
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const timeout = setTimeout(() => {
  console.error('tree-sitter persistent chunk cache test timed out');
  process.exit(1);
}, 15000);

const root = process.cwd();
const fixturePath = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const cacheDir = resolveTestCachePath(root, 'tree-sitter-chunk-cache-persistent');
const text = await fs.readFile(fixturePath, 'utf8');
const log = () => {};

try {
  await fs.rm(cacheDir, { recursive: true, force: true });
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });
  treeSitterState.queryCache.clear();
  treeSitterState.chunkCache.clear();
  treeSitterState.persistentChunkCacheMemo.clear();
  treeSitterState.persistentChunkCacheMisses.clear();
  treeSitterState.persistentChunkCacheRoot = null;

  const ok = await initTreeSitterRuntime({ log });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping persistent chunk cache test.');
    process.exit(0);
  }

  const languageId = 'javascript';
  const ext = '.js';
  await preloadTreeSitterLanguages([languageId], { log, parallel: false });

  const options = {
    log,
    treeSitter: {
      enabled: true,
      useQueries: true,
      chunkCache: true,
      chunkCacheMaxEntries: 8,
      cacheKey: 'persistent-cache-test',
      cachePersistent: true,
      cachePersistentDir: cacheDir
    }
  };

  const first = buildTreeSitterChunks({ text, languageId, ext, options });
  assert.ok(Array.isArray(first) && first.length > 0, 'expected first parse chunks');

  const filesAfterFirst = [];
  const collectFiles = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(next);
      } else {
        filesAfterFirst.push(next);
      }
    }
  };
  await collectFiles(cacheDir);
  assert.ok(filesAfterFirst.length > 0, 'expected persistent cache files to be written');

  const afterFirst = getTreeSitterStats();
  const activationsAfterFirst = Number(afterFirst.parserActivations) || 0;

  treeSitterState.chunkCache.clear();

  const second = buildTreeSitterChunks({ text, languageId, ext, options });
  assert.deepStrictEqual(second, first, 'expected persistent cache hit parity');

  const afterSecond = getTreeSitterStats();
  assert.ok(
    Number(afterSecond.chunkCachePersistentHits) >= 1,
    'expected persistent chunk cache hit'
  );
  assert.equal(
    Number(afterSecond.parserActivations) || 0,
    activationsAfterFirst,
    'expected no parser activation on persistent chunk cache hit'
  );

  console.log('tree-sitter persistent chunk cache test passed');
} finally {
  clearTimeout(timeout);
}

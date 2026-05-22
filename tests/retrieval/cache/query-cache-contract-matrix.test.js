#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import {
  findQueryCacheEntry,
  loadQueryCache,
  pruneQueryCache
} from '../../../src/retrieval/query-cache.js';
import { getRepoId } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();

const QUERY_CACHE_FAST_TEST_CONFIG = {
  indexing: {
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false,
    scm: { provider: 'none' }
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: { enabled: false }
  }
};

const createQueryCacheEnv = (cacheRoot, testConfig = {}) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    ...QUERY_CACHE_FAST_TEST_CONFIG,
    ...testConfig
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  },
  syncProcess: false
});

const runNodeScript = (cwd, env, args, label) => {
  const result = runNode(args, label, cwd, env, { stdio: 'pipe' });
  return result.stdout || '';
};

const cases = [
  {
    name: 'query cache lookup prefers newest entries and supports prewarm trimming',
    async run() {
      const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-query-cache-lookup-'));
      try {
        const cachePath = path.join(tempRoot, 'queryCache.json');
        const baseTs = Date.now();
        await fsPromises.writeFile(cachePath, JSON.stringify({
          version: 1,
          entries: [
            { key: 'k1', signature: 's1', ts: baseTs - 300, payload: { code: [{ id: 1 }] } },
            { key: 'k1', signature: 's1', ts: baseTs - 200, payload: { code: [{ id: 2 }] } },
            { key: 'k2', signature: 's2', ts: baseTs - 250, payload: { code: [{ id: 3 }] } }
          ]
        }, null, 2));

        const cache = loadQueryCache(cachePath);
        assert.equal(findQueryCacheEntry(cache, 'k1', 's1')?.ts, baseTs - 200);

        cache.entries.push({ key: 'k1', signature: 's1', ts: baseTs - 100, payload: { code: [{ id: 4 }] } });
        assert.equal(findQueryCacheEntry(cache, 'k1', 's1')?.ts, baseTs - 100);

        pruneQueryCache(cache, 2);
        assert.equal(findQueryCacheEntry(cache, 'k1', 's1')?.ts, baseTs - 100);

        const coldMemoryMiss = findQueryCacheEntry(
          { version: 1, entries: [] },
          'k1',
          's1',
          { cachePath, strategy: 'memory-first', memoryFreshMs: 60_000 }
        );
        assert.equal(coldMemoryMiss, null);

        loadQueryCache(cachePath, { prewarm: true, prewarmMaxEntries: 8 });
        const prewarmedHit = findQueryCacheEntry(
          { version: 1, entries: [] },
          'k1',
          's1',
          { cachePath, strategy: 'memory-first', memoryFreshMs: 60_000 }
        );
        assert.ok(prewarmedHit);
        assert.equal(prewarmedHit?.key, 'k1');
        assert.equal(prewarmedHit?.signature, 's1');

        loadQueryCache(cachePath, { prewarm: true, prewarmMaxEntries: 0.5 });
        assert.ok(findQueryCacheEntry(
          { version: 1, entries: [] },
          'k1',
          's1',
          { cachePath, strategy: 'memory-first', memoryFreshMs: 60_000 }
        ));
        assert.equal(findQueryCacheEntry(
          { version: 1, entries: [] },
          'k2',
          's2',
          { cachePath, strategy: 'memory-first', memoryFreshMs: 60_000 }
        ), null);
      } finally {
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'code-mode query cache records miss then hit and persists payloads',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'query-cache-contract-code');
      const repoRoot = path.join(tempRoot, 'repo');
      const cacheRoot = path.join(tempRoot, 'cache');
      const cacheRootResolved = resolveVersionedCacheRoot(cacheRoot);

      await rmDirRecursive(tempRoot, { retries: 6, delayMs: 120 });
      await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
      await fsPromises.writeFile(
        path.join(repoRoot, 'src', 'cache-sample.js'),
        [
          'export function greet(name = "world") {',
          '  return `greet ${name}`;',
          '}',
          ''
        ].join('\n')
      );

      const env = createQueryCacheEnv(cacheRoot);

      runNodeScript(repoRoot, env, [
        path.join(root, 'build_index.js'),
        '--stub-embeddings',
        '--repo',
        repoRoot,
        '--stage',
        'stage1',
        '--mode',
        'code',
        '--no-sqlite'
      ], 'build index');
      const searchArgs = [
        path.join(root, 'search.js'),
        'greet',
        '--mode',
        'code',
        '--json',
        '--stats',
        '--backend',
        'memory',
        '--no-ann',
        '--repo',
        repoRoot
      ];
      const first = JSON.parse(runNodeScript(repoRoot, env, searchArgs, 'search (first)'));
      const second = JSON.parse(runNodeScript(repoRoot, env, searchArgs, 'search (second)'));

      assert.equal(first?.stats?.cache?.hit, false);
      assert.equal(second?.stats?.cache?.hit, true);

      const repoCacheDirs = await fsPromises.readdir(path.join(cacheRootResolved, 'repos'));
      assert.ok(repoCacheDirs.length > 0);
      const queryCachePath = path.join(cacheRootResolved, 'repos', repoCacheDirs[0], 'query-cache', 'queryCache.json');
      assert.equal(fs.existsSync(queryCachePath), true);
    }
  },
  {
    name: 'extracted-prose query cache persists extracted payloads',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'query-cache-contract-extracted-payload');
      await rmDirRecursive(tempRoot, { retries: 6, delayMs: 120 });
      const queryCachePath = path.join(tempRoot, 'queryCache.json');
      const key = 'query-cache:extracted-prose';
      const signature = 'signature:extracted-prose';
      await fsPromises.mkdir(path.dirname(queryCachePath), { recursive: true });
      await fsPromises.writeFile(queryCachePath, JSON.stringify({
        version: 1,
        entries: [{
          key,
          signature,
          ts: Date.now(),
          payload: {
            extractedProse: [{ file: 'src/sample.js', text: 'extracted prose cache sentinel' }]
          }
        }]
      }, null, 2));
      assert.equal(fs.existsSync(queryCachePath), true);
      const cacheData = loadQueryCache(queryCachePath);
      const cached = findQueryCacheEntry(cacheData, key, signature);
      assert.ok(cached);
      assert.ok(cached.payload.extractedProse.some((hit) => hit?.file === 'src/sample.js'));
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('query cache contract matrix test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { findQueryCacheEntry, loadQueryCache, pruneQueryCache } from '../../../src/retrieval/query-cache.js';
import { getRepoId } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const runNode = (cwd, env, args, label) => {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    process.exit(result.status ?? 1);
  }
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

      const env = applyTestEnv({
        cacheRoot,
        embeddings: 'stub',
        testConfig: { quality: 'max' }
      });

      runNode(repoRoot, env, [
        path.join(root, 'build_index.js'),
        '--stub-embeddings',
        '--repo',
        repoRoot,
        '--stage',
        'stage1',
        '--mode',
        'code'
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
      const first = JSON.parse(runNode(repoRoot, env, searchArgs, 'search (first)'));
      const second = JSON.parse(runNode(repoRoot, env, searchArgs, 'search (second)'));

      assert.equal(first?.stats?.cache?.hit, false);
      assert.equal(second?.stats?.cache?.hit, true);

      const repoCacheDirs = await fsPromises.readdir(path.join(cacheRootResolved, 'repos'));
      assert.ok(repoCacheDirs.length > 0);
      const queryCachePath = path.join(cacheRootResolved, 'repos', repoCacheDirs[0], 'query-cache', 'queryCache.json');
      assert.equal(fs.existsSync(queryCachePath), true);
    }
  },
  {
    name: 'extracted-prose query cache records hits and persists extracted payloads',
    async run() {
      const tempRoot = resolveTestCachePath(root, 'query-cache-contract-extracted-prose');
      const repoRoot = path.join(tempRoot, 'repo');
      const cacheRoot = path.join(tempRoot, 'cache');
      const cacheRootResolved = resolveVersionedCacheRoot(cacheRoot);
      const srcDir = path.join(repoRoot, 'src');

      await rmDirRecursive(tempRoot, { retries: 6, delayMs: 120 });
      await fsPromises.mkdir(srcDir, { recursive: true });
      const commentText = 'extracted prose cache sentinel';
      await fsPromises.writeFile(path.join(srcDir, 'sample.js'), [
        '/**',
        ` * ${commentText}`,
        ' */',
        'export function sample() { return 1; }',
        ''
      ].join('\n'));

      const env = applyTestEnv({
        cacheRoot,
        embeddings: 'stub',
        testConfig: {
          quality: 'max',
          indexing: {
            scm: { provider: 'none' },
            generatedPolicy: { extractedProse: { prefilter: { enabled: false } } },
            extractedProse: { prefilter: { enabled: false } }
          }
        }
      });

      runNode(
        repoRoot,
        env,
        [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage2', '--repo', repoRoot, '--mode', 'extracted-prose'],
        'build extracted-prose index'
      );

      const searchArgs = [
        path.join(root, 'search.js'),
        '--repo',
        repoRoot,
        '--mode',
        'extracted-prose',
        '--no-ann',
        '--json',
        '--stats',
        commentText
      ];
      const first = JSON.parse(runNode(repoRoot, env, searchArgs, 'search extracted-prose (first)'));
      const second = JSON.parse(runNode(repoRoot, env, searchArgs, 'search extracted-prose (second)'));

      assert.equal(first?.stats?.cache?.hit, false);
      assert.equal(second?.stats?.cache?.hit, true);
      const hits = Array.isArray(second.extractedProse) ? second.extractedProse : [];
      assert.ok(hits.some((hit) => hit?.file === 'src/sample.js'));

      const repoId = getRepoId(repoRoot);
      const queryCachePath = path.join(cacheRootResolved, 'repos', repoId, 'query-cache', 'queryCache.json');
      assert.equal(fs.existsSync(queryCachePath), true);
      const cacheData = JSON.parse(await fsPromises.readFile(queryCachePath, 'utf8'));
      const entries = Array.isArray(cacheData?.entries) ? cacheData.entries : [];
      const cached = entries.find((entry) =>
        Array.isArray(entry?.payload?.extractedProse)
        && entry.payload.extractedProse.some((hit) => hit?.file === 'src/sample.js')
      );
      assert.ok(cached);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('query cache contract matrix test passed');

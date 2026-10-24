#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cacheGc } from '../../../tools/mcp/tools/handlers/artifacts.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-mcp-gc-scope-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot, testConfig: { cache: { root: cacheRoot } } });
try {
  const caches = [];
  for (const name of ['repo-a', 'repo-b']) {
    const repo = path.join(root, name);
    await fs.mkdir(repo); await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
    const cache = resolveRepoCacheRootPath(repo, { cache: { root: cacheRoot } });
    await fs.mkdir(cache, { recursive: true });
    if (name === 'repo-a') {
      await fs.writeFile(path.join(cache, 'tree-sitter-chunk_lk1_' + 'a'.repeat(40) + '.json'),
        JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks')));
    } else await fs.writeFile(path.join(cache, 'data'), name);
    caches.push({ repo, cache });
  }
  await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const preview = await cacheGc({ repoPath: caches[0].repo, maxBytes: 1 });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.totals.repos, 1, 'quota accounting includes only the requested repository');
  assert.deepEqual(preview.removals.map(entry => entry.id), [path.basename(caches[0].cache)]);
  assert.equal(await fs.readFile(path.join(caches[1].cache, 'data'), 'utf8'), 'repo-b');
  const applied = await cacheGc({ repoPath: caches[0].repo, maxBytes: 0, dryRun: false });
  assert.equal(applied.ok, true);
  assert.equal(applied.quotaSatisfied, true, 'explicit zero byte quota is distinct from omitted limits');
  assert.deepEqual(applied.removals.map(entry => entry.id), [path.basename(caches[0].cache)]);
  await assert.rejects(fs.stat(caches[0].cache), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(caches[1].cache, 'data'), 'utf8'), 'repo-b');
  const unscoped = runNode(['tools/mcp/cache-gc-worker.js', '--apply', '--json', '--max-bytes', '0'],
    'internal GC worker rejects absent repository scope', process.cwd(), process.env, { stdio: 'pipe', allowFailure: true });
  assert.notEqual(unscoped.status, 0);
  assert.match(unscoped.stderr, /requires an explicit --repo target/);
  assert.equal(await fs.readFile(path.join(caches[1].cache, 'data'), 'utf8'), 'repo-b');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('MCP cache GC previews and applies only its requested repository within marked disposable roots');

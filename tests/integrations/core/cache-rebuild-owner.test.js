#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { consumeBuildCacheRebuild, rebuildRepoCache } from '../../../src/integrations/core/build-index/cache-rebuild.js';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-rebuild-owner-'));
try {
  const repo = path.join(temp, 'repo');
  await fs.mkdir(repo);
  const config = { cache: { root: path.join(temp, 'cache') } };
  const cache = getRepoCacheRoot(repo, config);
  await fs.mkdir(path.join(cache, 'locks'), { recursive: true });
  const sentinel = path.join(cache, 'old-output');
  const lockMetadata = path.join(cache, 'locks', 'preserve.json');
  const other = path.join(temp, 'cache', 'repos', 'another-repo');
  await fs.writeFile(sentinel, 'old');
  await fs.writeFile(lockMetadata, 'keep');
  await fs.mkdir(other);
  await fs.writeFile(path.join(other, 'output'), 'keep');
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_CACHE_REBUILD: '1' } });
  const intent = consumeBuildCacheRebuild({ argv: { 'cache-rebuild': true }, rawArgv: ['--cache-rebuild', '--threads', '1'], env });
  assert.equal(intent.requested, true);
  assert.equal(env.PAIROFCLEATS_CACHE_REBUILD, undefined);
  assert.equal(intent.argv['cache-rebuild'], false);
  assert.deepEqual(intent.rawArgv, ['--threads', '1']);
  assert.equal(consumeBuildCacheRebuild({ argv: intent.argv, env }).requested, false);
  for (const flags of [['--no-cache-rebuild'], ['--cache-rebuild=false'], ['--cache-rebuild', 'false'],
    ['--cache-rebuild', 'true', '--cache-rebuild', 'false'], ['--cache-rebuild=true', '--no-cache-rebuild']]) {
    const disabled = consumeBuildCacheRebuild({ argv: { 'cache-rebuild': false }, rawArgv: flags,
      env: { PAIROFCLEATS_CACHE_REBUILD: '1' } });
    assert.equal(disabled.requested, false);
    assert.deepEqual(disabled.rawArgv, []);
  }
  const held = await acquireIndexLock({ repoCacheRoot: cache });
  await assert.rejects(rebuildRepoCache({ root: repo, userConfig: config }), /Index lock unavailable/);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'old');
  await held.release();
  await rebuildRepoCache({ root: repo, userConfig: config });
  await assert.rejects(fs.stat(sentinel), { code: 'ENOENT' });
  assert.equal(await fs.readFile(lockMetadata, 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(other, 'output'), 'utf8'), 'keep');
  await fs.writeFile(sentinel, 'fresh');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { getCacheRoot, getCacheTempRoot } from './src/shared/cache-roots.js'; getCacheRoot(); getCacheTempRoot();"], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
    env: { ...env, PAIROFCLEATS_CACHE_ROOT: path.dirname(config.cache.root), PAIROFCLEATS_CACHE_REBUILD: '1' }
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'fresh');
  await assert.rejects(rebuildRepoCache({ root: repo, userConfig: config, argv: { stage: 'stage3' } }), /new indexing build/);
  console.log('cache rebuild owner test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

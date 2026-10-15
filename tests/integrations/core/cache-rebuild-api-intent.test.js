#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { buildRawArgs } from '../../../src/integrations/core/args.js';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-api-rebuild-'));
const repo = path.join(temp, 'repo');
await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'off' });
const cache = getRepoCacheRoot(repo, {});
await fs.mkdir(cache, { recursive: true });
const sentinel = path.join(cache, 'preserve');
await fs.writeFile(sentinel, 'existing artifact');
try {
  for (const key of ['cache-rebuild', 'cacheRebuild']) {
    assert.deepEqual(buildRawArgs({ [key]: false }), ['--no-cache-rebuild']);
    assert.deepEqual(buildRawArgs({ [key]: true }), ['--cache-rebuild']);
    await withTemporaryEnv({ PAIROFCLEATS_CACHE_REBUILD: '1' }, async () => {
      const result = await buildIndex(repo, { stage: 'stage3', mode: 'code', [key]: false, log: () => {} });
      assert.equal(result.embeddings.skipped, true);
      assert.equal(await fs.readFile(sentinel, 'utf8'), 'existing artifact');
      assert.equal(process.env.PAIROFCLEATS_CACHE_REBUILD, undefined, 'launch intent consumed even when disabled');
    });
  }
  assert.deepEqual(buildRawArgs({ 'cache-rebuild': false, cacheRebuild: true }), ['--no-cache-rebuild']);
  await withTemporaryEnv({ PAIROFCLEATS_CACHE_REBUILD: '1' }, async () => {
    // Stage3 deliberately rejects a requested rebuild before purging. This
    // exercises the actual core API alias without running an index or provider.
    await assert.rejects(buildIndex(repo, { stage: 'stage3', mode: 'code', cacheRebuild: true, log: () => {} }), /Cache rebuild requires a new indexing build/);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'existing artifact');
  });
  console.log('core API rebuild intent test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

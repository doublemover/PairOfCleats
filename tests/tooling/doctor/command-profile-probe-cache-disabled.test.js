#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'command-profile-probe-cache-disabled');
const persistentCacheDir = path.join(cacheRoot, 'cache', 'tooling', 'command-probes');
const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'gopls.cmd' : 'gopls'
);

try {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  __resetToolingCommandProbeCacheForTests();
  await withTemporaryEnv({
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_TESTING: '1'
  }, async () => {
    const first = resolveToolingCommandProfile({
      providerId: 'gopls',
      cmd: fixtureCmd,
      args: [],
      repoRoot: root,
      toolingConfig: {
        cache: {
          enabled: false
        }
      }
    });
    assert.equal(first.probe.ok, true, 'expected probe success');
    assert.equal(first.probe.cached, false, 'expected cold probe');

    __resetToolingCommandProbeCacheForTests();

    const second = resolveToolingCommandProfile({
      providerId: 'gopls',
      cmd: fixtureCmd,
      args: [],
      repoRoot: root,
      toolingConfig: {
        cache: {
          enabled: false
        }
      }
    });
    assert.equal(second.probe.ok, true, 'expected second probe success');
    assert.equal(second.probe.cached, false, 'expected no persistent probe cache hit when tooling cache is disabled');
    assert.equal(fs.existsSync(persistentCacheDir), false, 'expected no persistent probe cache directory when tooling cache is disabled');

    const stats = __getToolingCommandProbeCacheStatsForTests();
    assert.equal(stats.persistentWrites, 0, 'expected no persistent cache writes when tooling cache is disabled');
    assert.equal(stats.persistentHits, 0, 'expected no persistent cache hits when tooling cache is disabled');
  });

  console.log('tooling doctor command profile persistent probe cache disabled test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}

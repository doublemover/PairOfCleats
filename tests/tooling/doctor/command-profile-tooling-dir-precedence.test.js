#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const toolingDir = path.join(root, 'tests', 'fixtures', 'lsp');
const expectedBinDir = path.join(toolingDir, 'bin');
const fixtureCacheDir = path.join(toolingDir, 'cache', 'command-probes');
const cacheRoot = resolveTestCachePath(root, 'command-profile-tooling-dir-precedence');
const expectedPersistentCacheDir = path.join(cacheRoot, 'cache', 'tooling', 'command-probes');
const nodeBin = path.dirname(process.execPath);
await withTemporaryEnv({
  PATH: nodeBin,
  Path: nodeBin,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_TESTING: '1'
}, async () => {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.rmSync(fixtureCacheDir, { recursive: true, force: true });
  try {
    const profile = resolveToolingCommandProfile({
      providerId: 'jdtls',
      cmd: 'jdtls',
      args: [],
      repoRoot: root,
      toolingConfig: {
        dir: toolingDir
      }
    });
    assert.equal(profile.probe.ok, true, 'expected probe to succeed from tooling dir');
    assert.equal(path.dirname(profile.resolved.cmd), expectedBinDir, 'expected command to resolve from tooling dir bin');
    assert.equal(/^jdtls(\.cmd|\.exe|\.bat)?$/i.test(path.basename(profile.resolved.cmd)), true, 'expected jdtls binary');
    assert.equal(fs.existsSync(fixtureCacheDir), false, 'expected persistent probe cache to avoid fixture tooling dir');
    assert.equal(fs.existsSync(expectedPersistentCacheDir), true, 'expected persistent probe cache under test cache root');

    console.log('tooling doctor command profile tooling dir precedence test passed');
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    fs.rmSync(fixtureCacheDir, { recursive: true, force: true });
  }
});

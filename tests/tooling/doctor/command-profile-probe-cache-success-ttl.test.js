#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mock } from 'node:test';
import path from 'node:path';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  __setToolingCommandProbeSuccessTtlMsForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });
const tempRoot = resolveTestCachePath(root, `command-profile-probe-cache-success-ttl-${process.pid}`);
const toolingDir = path.join(tempRoot, 'tooling');
const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'gopls.cmd' : 'gopls'
);

try {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  const clockStartMs = Date.now();
  mock.timers.enable({ apis: ['Date'], now: clockStartMs });
  __resetToolingCommandProbeCacheForTests();
  __setToolingCommandProbeSuccessTtlMsForTests(25);

  const first = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(first.probe.ok, true, 'expected probe success');
  assert.equal(first.probe.cached, false, 'expected first probe to miss cache');

  const second = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(second.probe.ok, true, 'expected probe success on immediate repeat');
  assert.equal(second.probe.cached, true, 'expected immediate probe cache hit');

  mock.timers.setTime(clockStartMs + 26);

  const third = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(third.probe.ok, true, 'expected probe success after ttl');
  assert.equal(third.probe.cached, false, 'expected success probe cache entry to expire by ttl');

  const stats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(stats.commandProbeEntries >= 1, true, 'expected probe cache entry after refresh');

  console.log('tooling doctor command profile success probe ttl test passed');
} finally {
  mock.timers.reset();
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  await restorePath();
}

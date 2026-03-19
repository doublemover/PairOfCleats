#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });
const tempRoot = resolveTestCachePath(root, 'command-profile-probe-cache');
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
  __resetToolingCommandProbeCacheForTests();
  const initialStats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(initialStats.commandProbeEntries, 0, 'expected empty command probe cache');

  const first = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(first.probe.ok, true, 'expected probe success');
  assert.equal(first.probe.cached, false, 'expected first probe to miss cache');
  assert.equal(first.resolved.mode, 'gopls-direct', 'expected direct gopls resolution');

  const afterFirst = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(afterFirst.commandProbeEntries >= 1, true, 'expected command probe cache entry');

  const second = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(second.probe.ok, true, 'expected cached probe success');
  assert.equal(second.probe.cached, true, 'expected second probe to hit cache');
  assert.equal(second.resolved.mode, 'gopls-direct', 'expected direct gopls resolution');

  const afterSecond = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(
    afterSecond.commandProbeEntries,
    afterFirst.commandProbeEntries,
    'expected command probe cache size to remain stable'
  );

  console.log('tooling doctor command profile probe cache test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  await restorePath();
}


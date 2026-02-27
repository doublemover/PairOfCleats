#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });

try {
  __resetToolingCommandProbeCacheForTests();
  const initialStats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(initialStats.commandProbeEntries, 0, 'expected empty command probe cache');

  const first = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: 'gopls',
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(first.probe.ok, true, 'expected probe success');
  assert.equal(first.probe.cached, false, 'expected first probe to miss cache');
  assert.equal(first.resolved.mode, 'gopls-direct', 'expected direct gopls resolution');

  const afterFirst = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(afterFirst.commandProbeEntries >= 1, true, 'expected command probe cache entry');

  const second = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: 'gopls',
    args: [],
    repoRoot: root,
    toolingConfig: {}
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
  restorePath();
}

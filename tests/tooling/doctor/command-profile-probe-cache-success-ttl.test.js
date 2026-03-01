#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  __setToolingCommandProbeSuccessTtlMsForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { sleep } from '../../../src/shared/sleep.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });
const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'gopls.cmd' : 'gopls'
);

try {
  __resetToolingCommandProbeCacheForTests();
  __setToolingCommandProbeSuccessTtlMsForTests(25);

  const first = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(first.probe.ok, true, 'expected probe success');
  assert.equal(first.probe.cached, false, 'expected first probe to miss cache');

  const second = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(second.probe.ok, true, 'expected probe success on immediate repeat');
  assert.equal(second.probe.cached, true, 'expected immediate probe cache hit');

  await sleep(60);

  const third = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(third.probe.ok, true, 'expected probe success after ttl');
  assert.equal(third.probe.cached, false, 'expected success probe cache entry to expire by ttl');

  const stats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(stats.commandProbeEntries >= 1, true, 'expected probe cache entry after refresh');

  console.log('tooling doctor command profile success probe ttl test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  await restorePath();
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  __setToolingCommandProbeSuccessTtlMsForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { sleep } from '../../../src/shared/sleep.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });
const tempRoot = resolveTestCachePath(root, `tooling-doctor-command-profile-matrix-${process.pid}-${Date.now()}`);
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
  const profile = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(profile.probe.ok, true);
  assert.equal(profile.resolved.mode, 'gopls-direct');
  assert.deepEqual(profile.resolved.args, []);

  const explicitProfile = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: ['-rpc.trace'],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(explicitProfile.resolved.mode, 'gopls-explicit-args');
  assert.deepEqual(explicitProfile.resolved.args, ['-rpc.trace']);

  const nodeBin = path.dirname(process.execPath);
  await withTemporaryEnv({ PATH: nodeBin, Path: nodeBin }, async () => {
    const overrideProfile = resolveToolingCommandProfile({
      providerId: 'gopls',
      cmd: fixtureCmd,
      args: [],
      repoRoot: root,
      toolingConfig: {}
    });
    assert.equal(overrideProfile.probe.ok, true);
    assert.equal(path.resolve(overrideProfile.resolved.cmd), path.resolve(fixtureCmd));
  });

  __resetToolingCommandProbeCacheForTests();
  const initialStats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(initialStats.commandProbeEntries, 0);

  const first = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(first.probe.ok, true);
  assert.equal(first.probe.cached, false);

  const second = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(second.probe.ok, true);
  assert.equal(second.probe.cached, true);
  assert.equal(__getToolingCommandProbeCacheStatsForTests().commandProbeEntries >= 1, true);

  __resetToolingCommandProbeCacheForTests();
  const missingCmd = `poc-missing-cmd-${Date.now()}-${process.pid}`;
  const failedFirst = resolveToolingCommandProfile({
    providerId: 'custom-missing',
    cmd: missingCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(failedFirst.probe.ok, false);
  assert.equal(failedFirst.probe.cached, false);

  const failedSecond = resolveToolingCommandProfile({
    providerId: 'custom-missing',
    cmd: missingCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(failedSecond.probe.ok, false);
  assert.equal(failedSecond.probe.cached, true);

  __resetToolingCommandProbeCacheForTests();
  __setToolingCommandProbeSuccessTtlMsForTests(25);

  const ttlFirst = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(ttlFirst.probe.cached, false);

  const ttlSecond = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(ttlSecond.probe.cached, true);

  await sleep(60);

  const ttlThird = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(ttlThird.probe.cached, false);

  console.log('tooling doctor command profile probe cache matrix test passed');
} finally {
  __setToolingCommandProbeSuccessTtlMsForTests(null);
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  await restorePath();
}

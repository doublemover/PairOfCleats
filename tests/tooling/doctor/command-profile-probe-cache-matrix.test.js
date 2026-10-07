#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mock } from 'node:test';

import {
  __getToolingCommandProbeCacheStatsForTests,
  __resolveNoProvisionProbeEnvForTests,
  __resetToolingCommandProbeCacheForTests,
  __setToolingCommandProbeSuccessTtlMsForTests,
  invalidateProbeCacheOnInitializeFailure,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
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
  const clockStartMs = Date.now();
  mock.timers.enable({ apis: ['Date'], now: clockStartMs });
  __setToolingCommandProbeSuccessTtlMsForTests(25);
  const ttlToolingDir = path.join(tempRoot, 'ttl-tooling');

  const ttlFirst = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: ttlToolingDir, cache: { dir: ttlToolingDir } }
  });
  assert.equal(ttlFirst.probe.cached, false);

  const ttlSecond = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: ttlToolingDir, cache: { dir: ttlToolingDir } }
  });
  assert.equal(ttlSecond.probe.cached, true);

  mock.timers.setTime(clockStartMs + 26);

  const ttlThird = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: ttlToolingDir, cache: { dir: ttlToolingDir } }
  });
  assert.equal(ttlThird.probe.cached, false);
  mock.timers.reset();
  __setToolingCommandProbeSuccessTtlMsForTests(null);

  const baseProbeEnv = { GOTOOLCHAIN: 'auto', RUSTUP_AUTO_INSTALL: '1' };
  const probeEnv = __resolveNoProvisionProbeEnvForTests(baseProbeEnv);
  assert.equal(probeEnv.GOTOOLCHAIN, 'path');
  assert.equal(probeEnv.RUSTUP_AUTO_INSTALL, '0');
  assert.equal(baseProbeEnv.GOTOOLCHAIN, 'auto', 'probe guards cannot mutate caller environment');
  assert.equal(__resolveNoProvisionProbeEnvForTests({ GOTOOLCHAIN: 'local' }).GOTOOLCHAIN, 'local');
  assert.equal(__resolveNoProvisionProbeEnvForTests({ GOTOOLCHAIN: 'go1.27.1+auto' }).GOTOOLCHAIN, 'go1.27.1+path');

  // One application-owned fixture command is cwd-sensitive, like SDK shims.
  const cwdA = path.join(tempRoot, 'cwd-a with spaces');
  const cwdB = path.join(tempRoot, 'cwd-b with spaces');
  fs.mkdirSync(cwdA, { recursive: true });
  fs.mkdirSync(cwdB, { recursive: true });
  const cwdScript = path.join(tempRoot, 'cwd-probe.js');
  fs.writeFileSync(cwdScript, "console.log('fixture 1.0.0 cwd=' + process.cwd() + ' env=' + JSON.stringify({rust:process.env.RUSTUP_AUTO_INSTALL,go:process.env.GOTOOLCHAIN}));\n");
  const cwdCommand = path.join(tempRoot, process.platform === 'win32' ? 'cwd-probe.cmd' : 'cwd-probe');
  fs.writeFileSync(cwdCommand, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${cwdScript}" %*\r\n`
    : `#!${process.execPath}\nconsole.log('fixture 1.0.0 cwd=' + process.cwd() + ' env=' + JSON.stringify({rust:process.env.RUSTUP_AUTO_INSTALL,go:process.env.GOTOOLCHAIN}));\n`);
  if (process.platform !== 'win32') fs.chmodSync(cwdCommand, 0o755);
  const scopedConfig = { cache: { dir: path.join(tempRoot, 'scoped-cache') } };
  const scoped = cwd => resolveToolingCommandProfile({ providerId: 'cwd-sensitive-fixture',
    cmd: cwdCommand, args: [], repoRoot: cwd, toolingConfig: scopedConfig });
  __resetToolingCommandProbeCacheForTests();
  const scopedA = scoped(cwdA);
  const scopedB = scoped(cwdB);
  assert.equal(scopedA.probe.ok, true);
  assert.equal(scopedB.probe.ok, true);
  assert.match(scopedA.probe.versionText, /cwd-a/);
  assert.match(scopedB.probe.versionText, /cwd-b/);
  assert.match(scopedA.probe.versionText, /cwd-a with spaces/);
  assert.match(scopedB.probe.versionText, /cwd-b with spaces/);
  assert.match(scopedA.probe.versionText, /"rust":"0"/);
  assert.equal(scopedA.probe.versionText.includes(`"go":"${__resolveNoProvisionProbeEnvForTests(process.env).GOTOOLCHAIN}"`), true);
  assert.equal(scopedA.probe.cached, false);
  assert.equal(scopedB.probe.cached, false, 'another repository cwd cannot reuse the first probe');
  assert.equal(scoped(cwdA).probe.cached, true);
  __resetToolingCommandProbeCacheForTests();
  assert.equal(scoped(cwdA).probe.cacheSource, 'persistent');
  assert.equal(scoped(cwdB).probe.cacheSource, 'persistent');
  assert.equal(invalidateProbeCacheOnInitializeFailure({ checks: [{ name: 'tooling_initialize_failed' }],
    providerId: 'cwd-sensitive-fixture', command: cwdCommand, args: [], cwd: cwdA,
    toolingConfig: scopedConfig }), true);
  __resetToolingCommandProbeCacheForTests();
  assert.equal(scoped(cwdA).probe.cached, false, 'failed launch invalidates the matching cwd');
  assert.equal(scoped(cwdB).probe.cacheSource, 'persistent', 'other cwd success remains independent');

  console.log('tooling doctor command profile probe cache matrix test passed');
} finally {
  mock.timers.reset();
  __setToolingCommandProbeSuccessTtlMsForTests(null);
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  await restorePath();
}

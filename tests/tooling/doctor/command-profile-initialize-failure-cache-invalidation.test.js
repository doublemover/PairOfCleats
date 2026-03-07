#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  invalidateProbeCacheOnInitializeFailure,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
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

  const first = resolveToolingCommandProfile({
    providerId: 'clangd',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(first.probe.ok, true, 'expected fixture command probe success');
  assert.equal(first.probe.cached, false, 'expected cold probe on first resolve');

  const second = resolveToolingCommandProfile({
    providerId: 'clangd',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(second.probe.cached, true, 'expected warm probe cache before invalidation');
  assert.equal(
    __getToolingCommandProbeCacheStatsForTests().commandProbeEntries > 0,
    true,
    'expected probe cache entries before invalidation'
  );

  const ignored = invalidateProbeCacheOnInitializeFailure({
    checks: [{ name: 'tooling_capability_missing_document_symbol' }],
    providerId: 'clangd',
    command: fixtureCmd
  });
  assert.equal(ignored, false, 'expected no invalidation when initialize failure check is absent');

  const invalidated = invalidateProbeCacheOnInitializeFailure({
    checks: [{ name: 'tooling_initialize_failed' }],
    providerId: 'clangd',
    command: fixtureCmd
  });
  assert.equal(invalidated, true, 'expected invalidation on initialize failure check');

  const third = resolveToolingCommandProfile({
    providerId: 'clangd',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(third.probe.cached, false, 'expected cache miss after initialize-failure invalidation');

  console.log('command-profile initialize-failure cache invalidation test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
}

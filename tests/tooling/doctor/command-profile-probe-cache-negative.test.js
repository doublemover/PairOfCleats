#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const missingCmd = `poc-missing-cmd-${Date.now()}-${process.pid}`;

__resetToolingCommandProbeCacheForTests();

const first = resolveToolingCommandProfile({
  providerId: 'custom-missing',
  cmd: missingCmd,
  args: [],
  repoRoot: root,
  toolingConfig: {}
});
assert.equal(first.probe.ok, false, 'expected first probe failure');
assert.equal(first.probe.cached, false, 'expected first probe miss');

const second = resolveToolingCommandProfile({
  providerId: 'custom-missing',
  cmd: missingCmd,
  args: [],
  repoRoot: root,
  toolingConfig: {}
});
assert.equal(second.probe.ok, false, 'expected second probe failure');
assert.equal(second.probe.cached, true, 'expected second probe to hit negative cache');

const stats = __getToolingCommandProbeCacheStatsForTests();
assert.equal(stats.commandProbeEntries >= 1, true, 'expected probe cache entry after failures');

console.log('tooling doctor command profile negative probe cache test passed');

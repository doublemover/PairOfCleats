#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();

const zigProfile = resolveToolingCommandProfile({
  providerId: 'zig',
  cmd: 'zig',
  args: ['version'],
  repoRoot: root,
  toolingConfig: {}
});
assert.equal(
  zigProfile.probe.attempted?.[0]?.args?.[0],
  'version',
  'expected zig probe to prefer `zig version`'
);

const erlProfile = resolveToolingCommandProfile({
  providerId: 'elixir-ls-erl',
  cmd: 'erl',
  args: ['-version'],
  repoRoot: root,
  toolingConfig: {}
});
assert.equal(
  erlProfile.probe.attempted?.[0]?.args?.[0],
  '-version',
  'expected erl probe to prefer `erl -version`'
);

console.log('tooling doctor command profile runtime probe args test passed');

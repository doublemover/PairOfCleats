#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const profile = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: 'gopls',
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(profile.probe.ok, true, 'expected gopls probe to succeed with fixture binary');
  assert.equal(profile.resolved.mode, 'gopls-direct', 'expected gopls direct mode by default');
  assert.deepEqual(profile.resolved.args, [], 'expected gopls direct args by default');

  const explicitProfile = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: 'gopls',
    args: ['-rpc.trace'],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(
    explicitProfile.resolved.mode,
    'gopls-explicit-args',
    'expected explicit arg mode for gopls profile'
  );
  assert.deepEqual(
    explicitProfile.resolved.args,
    ['-rpc.trace'],
    'expected explicit gopls args to remain unchanged'
  );

  const fixtureCmd = path.join(
    root,
    'tests',
    'fixtures',
    'lsp',
    'bin',
    process.platform === 'win32' ? 'gopls.cmd' : 'gopls'
  );
  const originalPath = process.env.PATH || '';
  process.env.PATH = '';
  try {
    const overrideProfile = resolveToolingCommandProfile({
      providerId: 'gopls',
      cmd: fixtureCmd,
      args: [],
      repoRoot: root,
      toolingConfig: {}
    });
    assert.equal(overrideProfile.probe.ok, true, 'expected explicit gopls command path probe to succeed');
    assert.equal(
      path.resolve(overrideProfile.resolved.cmd),
      path.resolve(fixtureCmd),
      'expected explicit gopls command path to be preserved'
    );
  } finally {
    process.env.PATH = originalPath;
  }

  console.log('tooling doctor gopls command profile test passed');
} finally {
  restorePath();
}

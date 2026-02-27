#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
);

const nodeBin = path.dirname(process.execPath);

await withTemporaryEnv({ PATH: nodeBin, Path: nodeBin }, async () => {
  const profile = resolveToolingCommandProfile({
    providerId: 'pyright',
    cmd: fixtureCmd,
    args: ['--stdio'],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(profile.probe.ok, true, 'expected explicit pyright command path probe to succeed');
  assert.equal(
    path.resolve(profile.resolved.cmd),
    path.resolve(fixtureCmd),
    'expected explicit pyright command path to be preserved'
  );
});

await withTemporaryEnv({ PATH: nodeBin, Path: nodeBin }, async () => {
  const profile = resolveToolingCommandProfile({
    providerId: 'pyright',
    cmd: 'pyright-langserver',
    args: ['--stdio'],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(
    profile.probe.ok,
    true,
    'expected default pyright command probe to tolerate stdio usage error output'
  );
});

console.log('tooling doctor pyright command override profile test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
);

const originalPath = process.env.PATH || '';
process.env.PATH = '';

try {
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
} finally {
  process.env.PATH = originalPath;
}

console.log('tooling doctor pyright command override profile test passed');

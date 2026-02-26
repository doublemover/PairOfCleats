#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

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

  const serveOptInProfile = resolveToolingCommandProfile({
    providerId: 'gopls',
    cmd: 'gopls',
    args: [],
    repoRoot: root,
    toolingConfig: {
      gopls: {
        useServe: true
      }
    }
  });
  assert.equal(serveOptInProfile.resolved.mode, 'gopls-serve-opt-in', 'expected serve mode when explicitly enabled');
  assert.deepEqual(serveOptInProfile.resolved.args, ['serve'], 'expected gopls serve args for opt-in mode');

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

  console.log('tooling doctor gopls command profile test passed');
} finally {
  process.env.PATH = originalPath;
}

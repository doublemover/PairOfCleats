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
    providerId: 'jdtls',
    cmd: 'jdtls',
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });

  assert.equal(profile.probe.ok, true, 'expected jdtls probe to succeed via -version');
  assert.equal(
    profile.probe.attempted?.[0]?.args?.[0],
    '-version',
    'expected jdtls probe to prefer -version first'
  );
  assert.equal(profile.resolved.mode, 'direct', 'expected direct launch mode for jdtls');
} finally {
  process.env.PATH = originalPath;
}

console.log('tooling doctor jdtls command profile test passed');

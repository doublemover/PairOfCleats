#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const toolingDir = path.join(root, 'tests', 'fixtures', 'lsp');
const expectedBinDir = path.join(toolingDir, 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = '';

try {
  const profile = resolveToolingCommandProfile({
    providerId: 'jdtls',
    cmd: 'jdtls',
    args: [],
    repoRoot: root,
    toolingConfig: {
      dir: toolingDir
    }
  });
  assert.equal(profile.probe.ok, true, 'expected probe to succeed from tooling dir');
  assert.equal(path.dirname(profile.resolved.cmd), expectedBinDir, 'expected command to resolve from tooling dir bin');
  assert.equal(/^jdtls(\.cmd|\.exe|\.bat)?$/i.test(path.basename(profile.resolved.cmd)), true, 'expected jdtls binary');

  console.log('tooling doctor command profile tooling dir precedence test passed');
} finally {
  process.env.PATH = originalPath;
}

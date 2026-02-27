#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });

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
  restorePath();
}

console.log('tooling doctor jdtls command profile test passed');

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

  assert.equal(profile.probe.ok, true, 'expected jdtls probe to resolve command');
  assert.equal(
    Array.isArray(profile.probe.attempted) && profile.probe.attempted.length > 0,
    true,
    'expected jdtls probe to execute at least one probe argument'
  );
  assert.equal(profile.resolved.mode, 'direct', 'expected direct launch mode for jdtls');
} finally {
  await restorePath();
}

console.log('tooling doctor jdtls command profile test passed');


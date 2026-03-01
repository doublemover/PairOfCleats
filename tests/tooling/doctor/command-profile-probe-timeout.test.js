#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const restorePath = prependLspTestPath({ repoRoot: root });

try {
  __resetToolingCommandProbeCacheForTests();
  const startedAt = Date.now();
  const profile = resolveToolingCommandProfile({
    providerId: 'timeout-probe',
    cmd: 'hang-probe',
    args: [],
    repoRoot: root,
    toolingConfig: {},
    probeTimeoutMs: 120
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(profile.probe.ok, false, 'expected hanging probe command to fail');
  assert.equal(
    profile.probe.attempted?.[0]?.args?.[0],
    '--version',
    'expected default probe to start with --version'
  );
  assert.equal(
    profile.probe.attempted?.[0]?.errorCode,
    'SUBPROCESS_TIMEOUT',
    'expected hanging probe to be classified as a timeout'
  );
  assert.equal(
    elapsedMs < 2_000,
    true,
    `expected probe attempts to be bounded by timeout (elapsed=${elapsedMs}ms)`
  );

  console.log('tooling doctor command profile probe timeout test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  await restorePath();
}


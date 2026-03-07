#!/usr/bin/env node
import assert from 'node:assert/strict';
import { __resolveToolingProbeTimeoutMsForTests } from '../../../src/index/tooling/command-resolver.js';

const goplsTimeout = __resolveToolingProbeTimeoutMsForTests({
  providerId: 'gopls',
  requestedCmd: 'gopls',
  resolvedCmd: 'gopls'
});
assert.equal(goplsTimeout, 2000, 'expected fast-tier probe timeout for gopls');

const jdtlsTimeout = __resolveToolingProbeTimeoutMsForTests({
  providerId: 'jdtls',
  requestedCmd: 'jdtls',
  resolvedCmd: 'jdtls'
});
assert.equal(jdtlsTimeout, 8000, 'expected heavy-tier probe timeout for jdtls');

const sourcekitByCommandTimeout = __resolveToolingProbeTimeoutMsForTests({
  providerId: 'custom-provider',
  requestedCmd: 'sourcekit-lsp',
  resolvedCmd: 'sourcekit-lsp'
});
assert.equal(sourcekitByCommandTimeout, 8000, 'expected heavy-tier timeout by command token');

const defaultTimeout = __resolveToolingProbeTimeoutMsForTests({
  providerId: 'custom-unknown',
  requestedCmd: 'custom-tool',
  resolvedCmd: 'custom-tool'
});
assert.equal(defaultTimeout, 4000, 'expected balanced default probe timeout for unknown providers');

const explicitOverrideTimeout = __resolveToolingProbeTimeoutMsForTests({
  providerId: 'jdtls',
  requestedCmd: 'jdtls',
  resolvedCmd: 'jdtls',
  explicitTimeoutMs: 1234
});
assert.equal(explicitOverrideTimeout, 1234, 'expected explicit probe timeout override to win');

const explicitFloorTimeout = __resolveToolingProbeTimeoutMsForTests({
  providerId: 'jdtls',
  requestedCmd: 'jdtls',
  resolvedCmd: 'jdtls',
  explicitTimeoutMs: 10
});
assert.equal(explicitFloorTimeout, 100, 'expected explicit timeout to clamp to minimum floor');

console.log('tooling doctor command profile probe timeout tiers test passed');

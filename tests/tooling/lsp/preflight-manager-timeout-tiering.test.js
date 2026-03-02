#!/usr/bin/env node
import assert from 'node:assert/strict';
import { awaitToolingProviderPreflight } from '../../../src/index/tooling/preflight-manager.js';

const captured = new Map();
const createProvider = ({ id, preflightClass = null, preflightTimeoutMs = null }) => ({
  id,
  preflightId: `${id}.preflight`,
  ...(preflightClass ? { preflightClass } : {}),
  ...(Number.isFinite(preflightTimeoutMs) ? { preflightTimeoutMs } : {}),
  getConfigHash() {
    return `${id}-hash`;
  },
  async preflight(_ctx, inputs = {}) {
    captured.set(id, {
      preflightClass: String(inputs.preflightClass || ''),
      preflightTimeoutMs: Number(inputs.preflightTimeoutMs) || null
    });
    return { state: 'ready' };
  }
});

const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {
    preflight: {
      timeoutMs: 1111,
      timeoutMsByClass: {
        probe: 3210,
        workspace: 6543
      }
    }
  }
};

const sharedInputs = {
  documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }],
  targets: [{ chunkRef: { chunkUid: 'chunk-1', chunkId: 'chunk-1', file: 'src/file.fixture' } }]
};

await awaitToolingProviderPreflight(ctx, {
  provider: createProvider({ id: 'probe-provider', preflightClass: 'probe' }),
  inputs: sharedInputs
});
await awaitToolingProviderPreflight(ctx, {
  provider: createProvider({ id: 'workspace-provider', preflightClass: 'workspace' }),
  inputs: sharedInputs
});
await awaitToolingProviderPreflight(ctx, {
  provider: createProvider({ id: 'dependency-provider', preflightClass: 'dependency' }),
  inputs: sharedInputs
});
await awaitToolingProviderPreflight(ctx, {
  provider: createProvider({
    id: 'override-provider',
    preflightClass: 'workspace',
    preflightTimeoutMs: 7777
  }),
  inputs: sharedInputs
});

assert.equal(captured.get('probe-provider')?.preflightClass, 'probe', 'expected probe class input');
assert.equal(captured.get('workspace-provider')?.preflightClass, 'workspace', 'expected workspace class input');
assert.equal(captured.get('dependency-provider')?.preflightClass, 'dependency', 'expected dependency class input');
assert.equal(captured.get('probe-provider')?.preflightTimeoutMs, 3210, 'expected probe class timeout override');
assert.equal(
  captured.get('workspace-provider')?.preflightTimeoutMs,
  6543,
  'expected workspace class timeout override'
);
assert.equal(
  captured.get('dependency-provider')?.preflightTimeoutMs,
  1111,
  'expected dependency class to use global timeout when class-specific timeout is absent'
);
assert.equal(
  captured.get('override-provider')?.preflightTimeoutMs,
  7777,
  'expected provider timeout override to take precedence'
);

console.log('preflight manager timeout tiering test passed');

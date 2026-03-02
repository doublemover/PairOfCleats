#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createDedicatedLspProvider } from '../../../src/index/tooling/dedicated-lsp-provider.js';

const baseDescriptor = {
  id: 'fixture-dedicated',
  label: 'fixture dedicated provider',
  priority: 1,
  languages: ['fixture'],
  configKey: 'fixtureDedicated',
  docExtensions: ['.fixture'],
  command: {
    defaultCmd: 'missing-fixture-cmd'
  },
  parseSignature: () => null
};

const providerWithoutPreflight = createDedicatedLspProvider(baseDescriptor);
assert.equal(
  typeof providerWithoutPreflight.preflight,
  'undefined',
  'expected dedicated provider without descriptor.preflight to omit preflight hook'
);

const providerWithWorkspacePreflight = createDedicatedLspProvider({
  ...baseDescriptor,
  id: 'fixture-dedicated-workspace',
  workspace: {
    markerOptions: {
      exactNames: ['fixture.workspace']
    },
    missingCheck: {
      name: 'fixture_workspace_model_missing',
      message: 'fixture workspace markers missing.'
    }
  }
});
assert.equal(
  typeof providerWithWorkspacePreflight.preflight,
  'function',
  'expected dedicated provider with workspace model to expose preflight hook'
);

const providerWithRuntimeRequirementPreflight = createDedicatedLspProvider({
  ...baseDescriptor,
  id: 'fixture-dedicated-runtime-req',
  command: {
    defaultCmd: process.execPath
  },
  preflightRuntimeRequirements: [{
    id: 'missing-runtime',
    cmd: 'definitely-missing-runtime-preflight-command',
    args: ['--version'],
    label: 'Missing Runtime'
  }]
});
assert.equal(
  typeof providerWithRuntimeRequirementPreflight.preflight,
  'function',
  'expected dedicated provider with runtime requirements to expose preflight hook'
);

let preflightCalls = 0;
const provider = createDedicatedLspProvider({
  ...baseDescriptor,
  id: 'fixture-dedicated-preflight',
  preflightId: 'fixture-dedicated.workspace-bootstrap',
  preflight: async () => {
    preflightCalls += 1;
    return {
      state: 'blocked',
      reasonCode: 'fixture_preflight_blocked',
      blockProvider: true,
      check: {
        name: 'fixture_preflight_blocked',
        status: 'warn',
        message: 'fixture preflight blocked provider.'
      }
    };
  }
});

const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {
    fixtureDedicated: {
      enabled: true
    }
  },
  logger: () => {}
};

const result = await provider.run(ctx, {
  documents: [{
    virtualPath: 'src/app.fixture',
    languageId: 'fixture',
    docHash: 'hash-1'
  }],
  targets: [{
    virtualPath: 'src/app.fixture',
    chunkRef: {
      chunkUid: 'chunk-1',
      chunkId: 'chunk-1',
      file: 'src/app.fixture'
    }
  }],
  toolingPreflightWaveToken: 'fixture-wave'
});

assert.equal(preflightCalls, 1, 'expected preflight to run once');
assert.deepEqual(result.byChunkUid, {}, 'expected blocked preflight to return base empty output');
const checks = Array.isArray(result?.diagnostics?.checks) ? result.diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'fixture_preflight_blocked'),
  true,
  'expected blocked preflight check to surface in diagnostics'
);
assert.equal(
  checks.some((check) => check?.name === 'fixture-dedicated-preflight_command_unavailable'),
  false,
  'expected command probe checks to be skipped when preflight blocks provider early'
);

const workspaceBlocked = await providerWithWorkspacePreflight.run({
  ...ctx,
  toolingConfig: {
    fixtureDedicated: {
      enabled: true
    }
  }
}, {
  documents: [{
    virtualPath: 'src/ws.fixture',
    languageId: 'fixture',
    docHash: 'hash-ws-1'
  }],
  targets: [{
    virtualPath: 'src/ws.fixture',
    chunkRef: {
      chunkUid: 'chunk-ws-1',
      chunkId: 'chunk-ws-1',
      file: 'src/ws.fixture'
    }
  }],
  toolingPreflightWaveToken: 'workspace-wave'
});
assert.deepEqual(workspaceBlocked.byChunkUid, {}, 'expected workspace preflight to block provider output');
const workspaceChecks = Array.isArray(workspaceBlocked?.diagnostics?.checks)
  ? workspaceBlocked.diagnostics.checks
  : [];
assert.equal(
  workspaceChecks.some((check) => check?.name === 'fixture_workspace_model_missing'),
  true,
  'expected workspace preflight missing marker check'
);
assert.equal(
  workspaceChecks.some((check) => check?.name === 'fixture-dedicated-workspace_command_unavailable'),
  false,
  'expected command checks to be skipped when workspace preflight blocks provider'
);

const runtimeRequirementPreflight = await providerWithRuntimeRequirementPreflight.preflight({
  ...ctx,
  toolingConfig: {
    fixtureDedicated: {
      enabled: true
    }
  }
}, {});
assert.equal(runtimeRequirementPreflight?.state, 'degraded', 'expected runtime requirement preflight to degrade');
const runtimeRequirementChecks = Array.isArray(runtimeRequirementPreflight?.checks)
  ? runtimeRequirementPreflight.checks
  : [];
assert.equal(
  runtimeRequirementChecks.some((check) => String(check?.name || '').includes('_runtime_missing-runtime_missing')),
  true,
  'expected runtime requirement missing check from dedicated preflight'
);
assert.equal(
  runtimeRequirementPreflight?.reasonCode,
  'preflight_runtime_requirement_missing',
  'expected runtime requirement missing reason code from dedicated preflight'
);

console.log('dedicated provider preflight blocking test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRuntimeEnvelope } from '../src/shared/runtime-envelope.js';

const baseEnv = { ...process.env };
delete baseEnv.NODE_OPTIONS;
delete baseEnv.PAIROFCLEATS_NODE_OPTIONS;
delete baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB;

const request = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig: { runtime: { nodeOptions: '--trace-warnings', maxOldSpaceMb: 2048 } },
  env: baseEnv,
  cpuCount: 4,
  toolVersion: 'test'
});

const patch = request.envPatch.nodeOptions;
assert.ok(patch, 'expected NODE_OPTIONS patch');
assert.ok(patch.includes('--trace-warnings'), 'expected requested nodeOptions in patch');
assert.ok(patch.includes('--max-old-space-size=2048'), 'expected max-old-space-size in patch');
assert.strictEqual(
  patch.split('--trace-warnings').length - 1,
  1,
  'nodeOptions should only include requested flag once'
);

const externalEnv = { ...baseEnv, NODE_OPTIONS: '--max-old-space-size=1024 --trace-warnings' };
const externalOverride = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig: { runtime: { nodeOptions: '--trace-warnings', maxOldSpaceMb: 2048 } },
  env: externalEnv,
  cpuCount: 4,
  toolVersion: 'test'
});

assert.ok(!externalOverride.envPatch.nodeOptions, 'envPatch should not override external NODE_OPTIONS');
assert.strictEqual(
  externalOverride.runtime.maxOldSpaceMb.effective.value,
  1024,
  'effective maxOldSpace should reflect external NODE_OPTIONS'
);
assert.ok(
  externalOverride.warnings.some((warning) => warning.code === 'runtime.envOverride'
    && warning.fields?.includes('runtime.maxOldSpaceMb')),
  'expected envOverride warning for max-old-space-size override'
);

console.log('runtime-envelope-node-options-merge tests passed');

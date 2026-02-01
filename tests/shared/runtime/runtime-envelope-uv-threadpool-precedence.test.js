#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope.js';

const baseEnv = { ...process.env };
delete baseEnv.UV_THREADPOOL_SIZE;
delete baseEnv.PAIROFCLEATS_UV_THREADPOOL_SIZE;

const baseline = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig: {},
  env: baseEnv,
  cpuCount: 4,
  toolVersion: 'test'
});

assert.strictEqual(baseline.runtime.uvThreadpoolSize.effective.value, 4, 'default uv threadpool size should be 4');
assert.strictEqual(
  baseline.envPatch.set.UV_THREADPOOL_SIZE,
  '4',
  'envPatch should set UV_THREADPOOL_SIZE to the default'
);

const configEnv = { ...baseEnv };
const configRequest = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig: { runtime: { uvThreadpoolSize: 8 } },
  env: configEnv,
  cpuCount: 4,
  toolVersion: 'test'
});

assert.strictEqual(configRequest.runtime.uvThreadpoolSize.requested.value, 8, 'requested uv threadpool size should be 8');
assert.strictEqual(configRequest.runtime.uvThreadpoolSize.effective.value, 8, 'effective uv threadpool size should match config');
assert.strictEqual(configRequest.envPatch.set.UV_THREADPOOL_SIZE, '8', 'envPatch should set UV_THREADPOOL_SIZE when requested');

const externalEnv = { ...baseEnv, UV_THREADPOOL_SIZE: '6' };
const externalOverride = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig: { runtime: { uvThreadpoolSize: 8 } },
  env: externalEnv,
  cpuCount: 4,
  toolVersion: 'test'
});

assert.strictEqual(externalOverride.runtime.uvThreadpoolSize.effective.value, 6, 'external UV_THREADPOOL_SIZE should win');
assert.ok(!externalOverride.envPatch.set.UV_THREADPOOL_SIZE, 'envPatch should not override external UV_THREADPOOL_SIZE');
assert.ok(
  externalOverride.warnings.some((warning) => warning.code === 'runtime.envOverride'
    && warning.fields?.includes('runtime.uvThreadpoolSize')),
  'expected envOverride warning when external UV_THREADPOOL_SIZE overrides request'
);

console.log('runtime-envelope-uv-threadpool-precedence tests passed');

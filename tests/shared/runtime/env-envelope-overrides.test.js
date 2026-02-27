#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope.js';
import { resolveRuntimeEnv } from '../../../tools/dict-utils/paths/runtime.js';

const baseEnv = { ...process.env };
delete baseEnv.NODE_OPTIONS;
delete baseEnv.PAIROFCLEATS_NODE_OPTIONS;
delete baseEnv.PAIROFCLEATS_MAX_OLD_SPACE_MB;
delete baseEnv.UV_THREADPOOL_SIZE;
delete baseEnv.PAIROFCLEATS_UV_THREADPOOL_SIZE;

const envelope = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig: { runtime: { maxOldSpaceMb: 2048, uvThreadpoolSize: 6, nodeOptions: '--trace-warnings' } },
  env: baseEnv,
  execArgv: [],
  cpuCount: 8,
  toolVersion: 'test'
});

const runtimeConfig = {
  maxOldSpaceMb: envelope.runtime?.maxOldSpaceMb?.requested?.value ?? null,
  nodeOptions: envelope.runtime?.nodeOptions?.requested?.value ?? '',
  uvThreadpoolSize: envelope.runtime?.uvThreadpoolSize?.requested?.value ?? null,
  envelope
};

const baseline = resolveRuntimeEnv(runtimeConfig, { ...baseEnv, NODE_OPTIONS: '' });
assert.ok(
  baseline.NODE_OPTIONS?.includes('--max-old-space-size=2048'),
  'expected baseline NODE_OPTIONS to preserve envelope max-old-space-size'
);
assert.strictEqual(
  baseline.UV_THREADPOOL_SIZE,
  '6',
  'expected baseline UV_THREADPOOL_SIZE from envelope'
);

const heapOverridden = resolveRuntimeEnv(
  { ...runtimeConfig, maxOldSpaceMb: 4096 },
  { ...baseEnv, NODE_OPTIONS: '' }
);
assert.ok(
  heapOverridden.NODE_OPTIONS?.includes('--max-old-space-size=4096'),
  'expected explicit maxOldSpace override to apply'
);
assert.ok(
  !heapOverridden.NODE_OPTIONS?.includes('--max-old-space-size=2048'),
  'expected old envelope maxOldSpace to be replaced'
);

const uvOverridden = resolveRuntimeEnv(
  { ...runtimeConfig, uvThreadpoolSize: 12 },
  { ...baseEnv, NODE_OPTIONS: '' }
);
assert.strictEqual(
  uvOverridden.UV_THREADPOOL_SIZE,
  '12',
  'expected explicit uvThreadpool override to apply'
);

console.log('runtime env envelope override test passed');

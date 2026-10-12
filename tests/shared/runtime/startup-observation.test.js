#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import v8 from 'node:v8';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve-current-process-envelope.js';
import { buildWorkerExecArgv, resolveNodeHeapSource, parseNodeOptionsArgv, sanitizeNodeStartupOptions } from '../../../src/shared/workers/node-argv.js';

assert.deepEqual(parseNodeOptionsArgv('--require "a b.cjs" --max_old_space_size="512"'), ['--require', 'a b.cjs', '--max_old_space_size=512']);
assert.equal(resolveNodeHeapSource({ nodeOptions: '--max-old-space-size=256 --max_old_space_size="512"' }).value, 512);
assert.equal(resolveNodeHeapSource({ nodeOptions: '--max-old-space-size 512' }).value, null);
assert.deepEqual(resolveNodeHeapSource({ execArgv: ['--max-old-space-size=256'], nodeOptions: '--max-old-space-size=512' }), {
  value: 256, source: 'execArgv', detail: 'process.execArgv'
});
assert.deepEqual(buildWorkerExecArgv(['--max_old_space_size=512', '--max-semi-space-size', '16', '--trace-warnings']), ['--trace-warnings']);
const sanitized = sanitizeNodeStartupOptions({ nodeOptions: '--require https://user:secret@host --max-old-space-size=512 --api-token=secret' });
assert.equal(JSON.stringify(sanitized).includes('secret'), false);
const plan = resolveRuntimeEnvelope({ userConfig: { runtime: { maxOldSpaceMb: 256 } }, cpuCount: 4 });
assert.equal(plan.runtime.maxOldSpaceMb.planned.value, 256);
assert.equal(plan.runtime.maxOldSpaceMb.effective.evidenceScope, 'launch-plan');
const current = resolveCurrentProcessRuntimeEnvelope({ userConfig: { runtime: { maxOldSpaceMb: 256, uvThreadpoolSize: 6 } }, env: {}, execArgv: [] });
assert.equal(current.runtime.maxOldSpaceMb.planned.value, 256);
assert.equal(current.observed.heapSizeLimitBytes, v8.getHeapStatistics().heap_size_limit);
assert.equal(current.observed.uvThreadpoolSize, null);
assert.notEqual(current.runtime.maxOldSpaceMb.effective.evidenceScope, 'launch-plan');
assert.ok(current.observed.host.availableParallelism > 0);
const control = (args, options) => {
  const result = spawnSync(process.execPath, [...args, '-e', 'console.log(require("node:v8").getHeapStatistics().heap_size_limit)'], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_OPTIONS: options || '' }
  });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
};
assert.equal(control(['--max-old-space-size=256', '--max_old_space_size=512']), control(['--max-old-space-size=512']));
assert.equal(control(['--max-old-space-size=256'], '--max-old-space-size=512'), control(['--max-old-space-size=256']));
const invalidSpaced = spawnSync(process.execPath, ['--max-old-space-size', '256', '-e', '0'], {
  encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_OPTIONS: '' }
});
assert.notEqual(invalidSpaced.status, 0);
assert.equal(resolveNodeHeapSource({ execArgv: ['--max-old-space-size', '256'] }).source, 'invalid');
console.log('runtime startup observation test passed');

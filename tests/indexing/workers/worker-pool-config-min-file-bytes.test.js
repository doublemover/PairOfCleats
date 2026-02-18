#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const defaults = normalizeWorkerPoolConfig({}, { cpuLimit: 4 });
assert.equal(defaults.enabled, 'auto', 'expected worker pool default mode to remain auto');
assert.equal(defaults.minFileBytes, 16 * 1024, 'expected worker auto mode to keep tiny-file bypass default');

const explicit = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 4096,
  maxFileBytes: 8192
}, { cpuLimit: 4 });
assert.equal(explicit.minFileBytes, 4096, 'expected explicit minFileBytes to be respected');

const clamped = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 32768,
  maxFileBytes: 8192
}, { cpuLimit: 4 });
assert.equal(clamped.minFileBytes, 8192, 'expected minFileBytes to clamp to maxFileBytes');

const disabled = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 0
}, { cpuLimit: 4 });
assert.equal(disabled.minFileBytes, null, 'expected minFileBytes=0 to disable tiny-file bypass');

console.log('worker pool config min file bytes test passed');

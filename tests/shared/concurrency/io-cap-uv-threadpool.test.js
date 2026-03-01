#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveThreadLimits } from '../../../src/shared/threads.js';

const capped = resolveThreadLimits({
  argv: { threads: 64 },
  rawArgv: ['--threads', '64'],
  envConfig: {},
  cpuCount: 64,
  uvThreadpoolSize: 4,
  ioOversubscribe: false
});

assert.ok(capped.ioConcurrency <= 16, 'ioConcurrency should clamp to uv*4 when oversubscribe disabled');
assert.ok(capped.fileConcurrency <= 16, 'fileConcurrency should clamp to uv*4 when oversubscribe disabled');
assert.ok(capped.importConcurrency <= 16, 'importConcurrency should clamp to uv*4 when oversubscribe disabled');

const oversubscribed = resolveThreadLimits({
  argv: { threads: 64 },
  rawArgv: ['--threads', '64'],
  envConfig: {},
  cpuCount: 64,
  uvThreadpoolSize: 4,
  ioOversubscribe: true
});

assert.strictEqual(oversubscribed.fileConcurrency, 128, 'fileConcurrency should allow up to 2x resolved threads');
assert.strictEqual(oversubscribed.importConcurrency, 128, 'importConcurrency should allow up to 2x resolved threads when oversubscribe enabled');
assert.strictEqual(oversubscribed.ioConcurrency, 64, 'ioConcurrency should honor platform cap when oversubscribe enabled');

const cliOvercommitted = resolveThreadLimits({
  argv: { threads: 64 },
  rawArgv: ['--threads', '64'],
  envConfig: {},
  cpuCount: 16,
  uvThreadpoolSize: 4,
  ioOversubscribe: false
});

assert.strictEqual(cliOvercommitted.threads, 32, 'cli threads should clamp to 2x cpu count');
assert.strictEqual(cliOvercommitted.fileConcurrency, 64, 'fileConcurrency should allow up to 2x resolved threads for cli overcommit');
assert.strictEqual(cliOvercommitted.importConcurrency, 64, 'importConcurrency should allow up to 2x resolved threads for cli overcommit');
assert.strictEqual(cliOvercommitted.ioConcurrency, 64, 'ioConcurrency should follow elevated cli overcommit concurrency');
assert.strictEqual(cliOvercommitted.cpuConcurrency, 32, 'cpuConcurrency should remain bounded to resolved threads');

console.log('io concurrency cap tests passed');

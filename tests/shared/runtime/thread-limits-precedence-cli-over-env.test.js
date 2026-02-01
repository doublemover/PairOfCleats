#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveThreadLimits } from '../../../src/shared/threads.js';

const cliResult = resolveThreadLimits({
  argv: { threads: 8 },
  rawArgv: ['--threads', '8'],
  envConfig: { threads: 4 },
  cpuCount: 16
});

assert.strictEqual(cliResult.threads, 8, 'cli threads should override env');
assert.strictEqual(cliResult.source, 'cli', 'cli should be recorded as source');

const configResult = resolveThreadLimits({
  argv: {},
  rawArgv: [],
  envConfig: { threads: 4 },
  configConcurrency: 6,
  configConcurrencySource: 'config.indexing.concurrency',
  configSourceTag: 'config',
  cpuCount: 16
});

assert.strictEqual(configResult.threads, 6, 'config threads should override env');
assert.strictEqual(configResult.source, 'config', 'config should be recorded as source');

console.log('thread limits precedence tests passed');

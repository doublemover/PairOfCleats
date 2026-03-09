#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const childScript = [
  "import { buildOrderedAppender } from './src/index/build/indexer/steps/process-files/ordered.js';",
  'const appender = buildOrderedAppender(async () => {}, {}, {',
  '  expectedCount: 6,',
  '  startIndex: 0,',
  '  maxPendingBeforeBackpressure: 2',
  '});',
  'void appender.enqueue(1, { id: 1 }).catch(() => {});',
  'void appender.enqueue(2, { id: 2 }).catch(() => {});',
  'void appender.enqueue(3, { id: 3 }).catch(() => {});',
  'await appender.waitForCapacity({ orderIndex: 20, bypassWindow: 0 });'
].join('\n');

const child = spawn(
  process.execPath,
  ['--input-type=module', '-e', childScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  child.exitCode,
  null,
  `expected ordered capacity child to remain alive while blocked on waitForCapacity; stderr=${stderr || '<empty>'}`
);

child.kill();
const closeResult = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
});
assert.notEqual(
  closeResult.exitCode,
  13,
  `expected ordered capacity keepalive to avoid unsettled top-level await exit 13; stderr=${stderr || '<empty>'}`
);

console.log('ordered appender capacity keepalive test passed');

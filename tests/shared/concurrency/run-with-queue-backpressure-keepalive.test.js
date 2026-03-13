#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const childScript = [
  "import PQueue from 'p-queue';",
  "import { runWithQueue } from './src/shared/concurrency.js';",
  'const queue = new PQueue({ concurrency: 1 });',
  'queue.maxPending = 1;',
  'await runWithQueue(queue, [1, 2], async (item) => item, {',
  '  collectResults: false,',
  '  onResult: async () => {',
  '    await new Promise(() => {});',
  '  }',
  '});'
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
  `expected queue backpressure child to remain alive while waiting on pending signals; stderr=${stderr || '<empty>'}`
);

child.kill();
const closeResult = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
});
assert.notEqual(
  closeResult.exitCode,
  13,
  `expected runWithQueue backpressure keepalive to avoid unsettled top-level await exit 13; stderr=${stderr || '<empty>'}`
);

console.log('runWithQueue backpressure keepalive test passed');

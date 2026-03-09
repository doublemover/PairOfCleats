#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const childScript = [
  "import PQueue from 'p-queue';",
  "import { runWithQueue } from './src/shared/concurrency.js';",
  'const queue = new PQueue({ concurrency: 1 });',
  'try {',
  '  await runWithQueue(queue, [1], async (item) => item, {',
  '    collectResults: false,',
  '    pendingDrainTimeoutMs: 120,',
  '    onResult: async () => {',
  '      await new Promise(() => {});',
  '    }',
  '  });',
  "  throw new Error('expected pending drain timeout');",
  '} catch (error) {',
  "  if (error?.code !== 'RUN_WITH_QUEUE_PENDING_DRAIN_TIMEOUT') throw error;",
  "  process.stdout.write('TIMED_OUT\\n');",
  '}'
].join('\n');

const child = spawn(
  process.execPath,
  ['--input-type=module', '-e', childScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += String(chunk);
});
child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

const closeResult = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
});

assert.equal(
  closeResult.exitCode,
  0,
  `expected queue pending-drain child exit=0; signal=${closeResult.signal} stderr=${stderr || '<empty>'}`
);
assert.match(stdout, /TIMED_OUT/, 'expected queue pending-drain child to report timeout completion');

console.log('runWithQueue pending drain keepalive test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const childScript = [
  "import { createPostingsQueue } from './src/index/build/indexer/steps/process-files/postings-queue.js';",
  'const queue = createPostingsQueue({ maxPending: 1 });',
  'const reservation = await queue.reserve({ rows: 1, bytes: 1 });',
  'void reservation;',
  'await queue.reserve({ rows: 1, bytes: 1 });'
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
  `expected postings queue child to remain alive while blocked on capacity wait; stderr=${stderr || '<empty>'}`
);

child.kill();
const closeResult = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
});
assert.notEqual(
  closeResult.exitCode,
  13,
  `expected postings queue keepalive to avoid unsettled top-level await exit 13; stderr=${stderr || '<empty>'}`
);

console.log('postings queue capacity keepalive test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const childScript = [
  "import { createLifecycleRegistry } from './src/shared/lifecycle/registry.js';",
  "const registry = createLifecycleRegistry({ name: 'registry-pending-keepalive' });",
  "registry.registerPromise(new Promise(() => {}), { label: 'never-settles' });",
  'await registry.drain();'
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

await sleep(200);

assert.equal(
  child.exitCode,
  null,
  `expected lifecycle drain child to remain alive while pending promise is tracked; stderr=${stderr || '<empty>'}`
);

child.kill();

const closeResult = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
});

assert.notEqual(
  closeResult.exitCode,
  13,
  `expected lifecycle drain keepalive test to avoid unsettled top-level await exit 13; stderr=${stderr || '<empty>'}`
);

console.log('lifecycle registry pending keepalive test passed');

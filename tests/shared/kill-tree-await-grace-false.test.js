#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { killProcessTree } from '../../src/shared/kill-tree.js';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: 'ignore'
});

if (!child.pid) {
  console.error('kill-tree awaitGrace=false test failed: missing child pid');
  process.exit(1);
}

const startMs = Date.now();
const termination = await killProcessTree(child.pid, {
  killTree: false,
  graceMs: 2000,
  awaitGrace: false,
  detached: false
});
const durationMs = Date.now() - startMs;

assert.ok(durationMs < 1000, `expected non-blocking return when awaitGrace=false, got ${durationMs}ms`);
assert.equal(typeof termination?.terminated, 'boolean', 'expected termination payload');

await Promise.race([
  new Promise((resolve) => child.once('exit', resolve)),
  new Promise((_, reject) => setTimeout(() => reject(new Error('child did not exit after SIGTERM')), 3000))
]);

console.log('kill-tree awaitGrace=false test passed');

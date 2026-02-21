#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { skip } from '../helpers/skip.js';

if (process.platform !== 'win32') {
  skip('windows kill-tree test skipped on non-windows');
}

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: 'ignore',
  detached: true
});
child.unref();

if (!child.pid) {
  console.error('kill-tree windows test failed: missing child pid');
  process.exit(1);
}

await killProcessTree(child.pid, {
  killTree: true,
  detached: true,
  graceMs: 200
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(200);

try {
  process.kill(child.pid, 0);
  console.error('kill-tree windows test failed: process still alive');
  process.exit(1);
} catch (error) {
  if (error?.code === 'EPERM') {
    console.error('kill-tree windows test failed: process still alive (EPERM)');
    process.exit(1);
  }
}

console.log('kill-tree windows test passed');

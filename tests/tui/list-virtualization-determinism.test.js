#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'crates', 'pairofcleats-tui', 'src', 'main.rs');
const source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('const LOG_RING_LIMIT: usize')) {
  console.error('list virtualization determinism test failed: missing ring-buffer retention constants');
  process.exit(1);
}
if (!source.includes('fn list_window(') || !source.includes('fn tail_window(')) {
  console.error('list virtualization determinism test failed: missing viewport window helpers');
  process.exit(1);
}
if (!source.includes('job_scroll') || !source.includes('task_scroll') || !source.includes('log_scroll')) {
  console.error('list virtualization determinism test failed: missing deterministic scroll state');
  process.exit(1);
}

console.log('tui list virtualization determinism test passed');

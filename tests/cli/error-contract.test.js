#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cliPath = path.join(root, 'bin', 'pairofcleats.js');

const result = spawnSync(process.execPath, [cliPath, 'workspace'], {
  cwd: root,
  encoding: 'utf8'
});

if (result.status === 0) {
  console.error('cli error contract test failed: expected non-zero exit');
  process.exit(1);
}

const stderr = String(result.stderr || '');
if (!stderr.includes('[INVALID_REQUEST]')) {
  console.error('cli error contract test failed: missing error code prefix');
  process.exit(1);
}
if (!stderr.toLowerCase().includes('hint:')) {
  console.error('cli error contract test failed: missing hint output');
  process.exit(1);
}
if (!stderr.includes('Usage: pairofcleats')) {
  console.error('cli error contract test failed: expected help output');
  process.exit(1);
}

console.log('cli error contract test passed');

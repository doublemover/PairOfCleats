#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();

const pythonPolicy = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'tooling', 'python-check.js'), '--json'],
  { encoding: 'utf8' }
);
if (pythonPolicy.status !== 0) {
  console.error('sublime-api-server: required python toolchain is missing');
  if (pythonPolicy.stdout) console.error(pythonPolicy.stdout.trim());
  if (pythonPolicy.stderr) console.error(pythonPolicy.stderr.trim());
  process.exit(pythonPolicy.status ?? 1);
}

let pythonInfo = null;
try {
  pythonInfo = JSON.parse(pythonPolicy.stdout || '{}');
} catch {
  pythonInfo = null;
}
const python = pythonInfo?.python || process.env.PYTHON || 'python';
const script = path.join(root, 'tests', 'helpers', 'sublime', 'api_server.py');
const result = spawnSync(python, [script], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('sublime-api-server: python behavior test failed');
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(result.status || 1);
}

console.log('sublime api server test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'bench-language-repos.js');
const result = spawnSync(process.execPath, [scriptPath, '--list', '--json'], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error(result.stderr || 'bench-language-repos failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.languages), 'languages array missing');
assert.ok(payload.languages.includes('javascript'), 'javascript language missing');
assert.ok(payload.languages.includes('shell'), 'shell language missing');
assert.ok(Array.isArray(payload.tasks), 'tasks array missing');
assert.ok(payload.tasks.length > 0, 'no benchmark tasks listed');

console.log('bench-language-repos test passed.');

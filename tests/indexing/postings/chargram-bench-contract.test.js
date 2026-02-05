#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'index', 'chargram-postings.js');
const result = spawnSync(
  process.execPath,
  [script, '--vocab', '2000', '--docs', '1000', '--postings', '4', '--spill', '500', '--rolling-hash', '--mode', 'compare'],
  { cwd: root, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(1);
}

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.ok(output.includes('[bench] baseline'), 'missing baseline output');
assert.ok(output.includes('[bench] current'), 'missing current output');
assert.ok(output.includes('[bench] delta'), 'missing delta output');

console.log('chargram bench contract test passed');


#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../helpers/stdio.js';

const root = process.cwd();
const validatorPath = path.join(root, 'tools', 'index-validate.js');

const result = spawnSync(
  process.execPath,
  [validatorPath, '--mode', 'nope', '--json'],
  { encoding: 'utf8' }
);

assert.notEqual(result.status, 0, 'expected non-zero exit for unknown mode');
const combined = getCombinedOutput(result).toLowerCase();
assert.ok(combined.includes('unknown mode'), `expected unknown mode error, got: ${combined}`);

console.log('index-validate unknown mode test passed');

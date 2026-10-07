#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const validatorPath = path.join(root, 'tools', 'index', 'validate.js');

const result = runNode(
  [validatorPath, '--mode', 'nope', '--json'],
  'index validate unknown mode',
  root,
  process.env,
  {
    stdio: 'pipe',
    allowFailure: true
  }
);

assert.notEqual(result.status, 0, 'expected non-zero exit for unknown mode');
const combined = getCombinedOutput(result).toLowerCase();
assert.ok(combined.includes('unknown mode'), `expected unknown mode error, got: ${combined}`);

console.log('index-validate unknown mode test passed');

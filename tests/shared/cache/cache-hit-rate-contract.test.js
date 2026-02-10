#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const scriptPath = path.join(process.cwd(), 'tools', 'bench', 'cache-hit-rate.js');
const output = execFileSync(
  'node',
  [scriptPath, '--ops', '2000', '--keys', '200', '--hitRate', '0.7', '--mode', 'compare'],
  { encoding: 'utf8' }
);

assert.match(output, /\[bench\] baseline/, 'expected baseline output');
assert.match(output, /\[bench\] current/, 'expected current output');
assert.match(output, /\[bench\] delta/, 'expected delta output');

console.log('cache hit rate bench contract test passed');

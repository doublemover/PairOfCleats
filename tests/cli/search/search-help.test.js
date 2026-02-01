#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const result = spawnSync(process.execPath, [path.join(root, 'search.js')], { encoding: 'utf8' });
if (result.status === 0) {
  console.error('Expected search help to exit non-zero with no query.');
  process.exit(1);
}

const output = getCombinedOutput(result);
const requiredFlags = ['--calls', '--uses', '--author', '--import', '--explain'];
for (const flag of requiredFlags) {
  if (!output.includes(flag)) {
    console.error(`Help output missing flag: ${flag}`);
    process.exit(1);
  }
}

console.log('search help test passed');

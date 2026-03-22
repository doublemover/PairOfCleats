#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const env = { ...process.env };
delete env.PAIROFCLEATS_TESTING;
delete env.PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING;
delete env.CI;

const result = spawnSync(process.execPath, [path.join(root, 'search.js')], { encoding: 'utf8', env });
if (result.status === 0) {
  console.error('Expected search help to exit non-zero with no query.');
  process.exit(1);
}

const output = getCombinedOutput(result);
if (!output.includes('[deprecated] search.js')) {
  console.error('Expected search help output to include legacy wrapper warning.');
  process.exit(1);
}
const requiredFlags = ['--calls', '--uses', '--author', '--import', '--explain'];
for (const flag of requiredFlags) {
  if (!output.includes(flag)) {
    console.error(`Help output missing flag: ${flag}`);
    process.exit(1);
  }
}

console.log('search help test passed');

#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const searchPath = path.join(root, 'search.js');

function runFlag(flag) {
  return spawnSync(
    process.execPath,
    [searchPath, 'test', flag],
    { encoding: 'utf8' }
  );
}

const cases = [
  { flag: '--type', name: '--type' },
  { flag: '--author', name: '--author' },
  { flag: '--import', name: '--import' }
];

for (const entry of cases) {
  const result = runFlag(entry.flag);
  if (result.status === 0) {
    console.error(`Expected non-zero exit for ${entry.name}.`);
    process.exit(1);
  }
  const output = `${result.stderr || ''}${result.stdout || ''}`;
  if (!output.includes(`Missing value for ${entry.name}`)) {
    console.error(`Expected missing value message for ${entry.name}.`);
    process.exit(1);
  }
}

console.log('missing flag values test passed');

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
  { flag: '--human', label: 'human' },
  { flag: '--headline', label: 'headline' }
];

for (const entry of cases) {
  const result = runFlag(entry.flag);
  if (result.status === 0) {
    console.error(`Expected non-zero exit for ${entry.flag}.`);
    process.exit(1);
  }
  const output = `${result.stderr || ''}${result.stdout || ''}`;
  if (!output.toLowerCase().includes('removed') || !output.includes(entry.flag)) {
    console.error(`Expected actionable error for ${entry.flag}.`);
    process.exit(1);
  }
}

console.log('removed flags test passed');

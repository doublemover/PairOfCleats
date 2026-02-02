#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

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
  { flag: '--import', name: '--import' },
  { flag: '--repo', name: '--repo' },
  { flag: '--modified-since', name: '--modified-since' },
  { flag: '--bm25-k1', name: '--bm25-k1' },
  { flag: '--path', name: '--path' },
  { flag: '--lang', name: '--lang' },
  { flag: '--ext', name: '--ext' },
  { flag: '--ann-backend', name: '--ann-backend' },
  { flag: '--graph-ranking-max-work', name: '--graph-ranking-max-work' },
  { flag: '--fts-weights', name: '--fts-weights' },
  { flag: '--risk', name: '--risk' }
];

for (const entry of cases) {
  const result = runFlag(entry.flag);
  if (result.status === 0) {
    console.error(`Expected non-zero exit for ${entry.name}.`);
    process.exit(1);
  }
  const output = getCombinedOutput(result);
  if (!output.includes(`Missing value for ${entry.name}`)) {
    console.error(`Expected missing value message for ${entry.name}.`);
    process.exit(1);
  }
}

console.log('missing flag values test passed');

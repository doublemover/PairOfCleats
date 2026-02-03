#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'setup');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'setup', 'setup.js'),
    '--non-interactive',
    '--skip-install',
    '--skip-dicts',
    '--skip-models',
    '--skip-extensions',
    '--skip-tooling',
    '--skip-index',
    '--skip-sqlite',
    '--skip-artifacts'
  ],
  {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_CACHE_ROOT: cacheRoot }
  }
);

if (result.status !== 0) {
  console.error('setup test failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const output = getCombinedOutput(result);
if (!output.includes('Setup complete.')) {
  console.error('setup test failed: missing completion message');
  process.exit(1);
}

const jsonResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'setup', 'setup.js'),
    '--non-interactive',
    '--skip-install',
    '--skip-dicts',
    '--skip-models',
    '--skip-extensions',
    '--skip-tooling',
    '--skip-index',
    '--skip-sqlite',
    '--skip-artifacts',
    '--json'
  ],
  {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_CACHE_ROOT: cacheRoot }
  }
);

if (jsonResult.status !== 0) {
  console.error('setup --json test failed');
  if (jsonResult.stderr) console.error(jsonResult.stderr.trim());
  process.exit(jsonResult.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(jsonResult.stdout || '{}');
} catch (err) {
  console.error('setup --json test failed: invalid JSON output');
  process.exit(1);
}
if (!payload?.steps) {
  console.error('setup --json test failed: missing steps summary');
  process.exit(1);
}

console.log('setup test passed');


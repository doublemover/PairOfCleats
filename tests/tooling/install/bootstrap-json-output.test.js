#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, '.testCache', 'bootstrap-json-output');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'setup', 'bootstrap.js'),
    '--repo',
    fixtureRoot,
    '--skip-install',
    '--skip-dicts',
    '--skip-tooling',
    '--skip-index',
    '--skip-artifacts',
    '--json'
  ],
  {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_CACHE_ROOT: cacheRoot }
  }
);

if (result.status !== 0) {
  console.error('bootstrap json-output test failed: bootstrap exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('bootstrap json-output test failed: stdout is not valid JSON');
  process.exit(1);
}
if (!payload?.steps || typeof payload.steps !== 'object') {
  console.error('bootstrap json-output test failed: missing steps payload');
  process.exit(1);
}
if (!String(result.stderr || '').includes('[bootstrap]')) {
  console.error('bootstrap json-output test failed: expected bootstrap logs on stderr');
  process.exit(1);
}

console.log('bootstrap json-output test passed');

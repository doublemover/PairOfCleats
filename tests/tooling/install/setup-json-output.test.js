#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'setup-json-output');

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
  console.error('setup json-output test failed: setup exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('setup json-output test failed: stdout is not valid JSON');
  process.exit(1);
}
if (!payload?.steps || typeof payload.steps !== 'object') {
  console.error('setup json-output test failed: missing steps payload');
  process.exit(1);
}
if (!String(result.stderr || '').includes('[setup]')) {
  console.error('setup json-output test failed: expected setup logs on stderr');
  process.exit(1);
}

console.log('setup json-output test passed');

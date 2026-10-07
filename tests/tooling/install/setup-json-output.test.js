#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'setup-json-output');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = applyTestEnv({ syncProcess: false, cacheRoot });
const result = runNode(
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
  'setup json output',
  fixtureRoot,
  env,
  { stdio: 'pipe' }
);

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

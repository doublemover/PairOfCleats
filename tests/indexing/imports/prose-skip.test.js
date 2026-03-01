#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'prose-skip-imports');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub'
});

const result = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage2', '--mode', 'prose', '--repo', fixtureRoot],
  { cwd: fixtureRoot, env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('Failed: build_index prose mode');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const stderr = result.stderr || '';
if (stderr.includes('Scanning for imports')) {
  console.error('Prose mode should skip import scanning, but imports log was present.');
  process.exit(1);
}

console.log('Prose import scan skip test passed');


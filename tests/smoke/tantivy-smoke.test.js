#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tryRequire } from '../../src/shared/optional-deps.js';
applyTestEnv();
const gate = String(process.env.PAIROFCLEATS_TEST_TANTIVY || '').trim().toLowerCase();
if (!['1', 'true', 'yes', 'on'].includes(gate)) {
  console.warn('tantivy smoke test skipped (set PAIROFCLEATS_TEST_TANTIVY=1 to run).');
  process.exit(0);
}

const tantivyAvailable = tryRequire('tantivy').ok;
if (!tantivyAvailable) {
  console.error('tantivy missing; install the optional dependency to run this test.');
  process.exit(1);
}

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'tantivy-smoke');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build/tantivy-index.js'), '--mode', 'code', '--repo', repoRoot], 'build tantivy index');

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'index', '--mode', 'code', '--json', '--backend', 'tantivy', '--no-ann', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for Tantivy smoke test.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('Failed to parse Tantivy search JSON output.');
  process.exit(1);
}

if (payload.backend !== 'tantivy') {
  console.error(`Expected backend=tantivy, got ${payload.backend}`);
  process.exit(1);
}
if (!Array.isArray(payload.code) || payload.code.length === 0) {
  console.error('Expected Tantivy code results to be non-empty.');
  process.exit(1);
}

if (fs.existsSync(tempRoot)) {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('tantivy smoke test passed');


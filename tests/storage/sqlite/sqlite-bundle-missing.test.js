#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { getRepoCacheRoot, loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'sqlite-bundle-missing');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label, options = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
};

run([
  path.join(root, 'build_index.js'),
  '--incremental',
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--mode',
  'code',
  '--repo',
  repoRoot
], 'build index');

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
const bundleDir = path.join(repoCacheRoot, 'incremental', 'code', 'files');
if (!fs.existsSync(manifestPath)) {
  console.error('Missing incremental manifest for sqlite bundle test.');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestFiles = Object.values(manifest.files || {});
if (!manifestFiles.length) {
  console.error('Incremental manifest contains no files.');
  process.exit(1);
}
const bundleName = manifestFiles[0]?.bundle;
if (!bundleName) {
  console.error('Manifest entry missing bundle name.');
  process.exit(1);
}
const bundlePath = path.join(bundleDir, bundleName);
if (!fs.existsSync(bundlePath)) {
  console.error(`Expected bundle file missing: ${bundlePath}`);
  process.exit(1);
}
await fsPromises.rm(bundlePath, { force: true });

const sqliteLogs = [];
try {
  await runSqliteBuild(repoRoot, {
    mode: 'code',
    incremental: true,
    logger: {
      log: (message) => sqliteLogs.push(message),
      warn: (message) => sqliteLogs.push(message),
      error: (message) => sqliteLogs.push(message)
    }
  });
} catch (err) {
  console.error('sqlite build failed for missing bundle test.');
  if (err?.message) console.error(err.message);
  process.exit(1);
}
const output = getCombinedOutput({ stdout: sqliteLogs.join('\n'), stderr: '' });
const outputLower = output.toLowerCase();
if (
  !outputLower.includes('incremental bundles unavailable')
  && !outputLower.includes('falling back to artifacts')
  && !outputLower.includes('incremental update skipped')
  && !outputLower.includes('bundle missing')
  && !outputLower.includes('bundle file missing')
  && !outputLower.includes('bundle build failed')
) {
  console.error('Expected bundle fallback warning not found in output.');
  process.exit(1);
}

const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
if (!fs.existsSync(sqlitePaths.codePath)) {
  console.error(`Missing sqlite db after fallback: ${sqlitePaths.codePath}`);
  process.exit(1);
}

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite bundle test.');
  process.exit(1);
}
const db = new Database(sqlitePaths.codePath, { readonly: true });
const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
db.close();
if (!Number(row?.total)) {
  console.error('Expected sqlite index to contain chunks after fallback rebuild.');
  process.exit(1);
}

console.log('sqlite bundle missing fallback test passed');


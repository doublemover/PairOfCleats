#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LMDB_META_KEYS } from '../../../src/storage/lmdb/schema.js';
import { loadUserConfig, resolveLmdbPaths } from '../../../tools/dict-utils.js';

let open = null;
try {
  ({ open } = await import('lmdb'));
} catch (err) {
  console.error(`lmdb missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'lmdb-corruption');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label, options = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    ...options
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
};

run(
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { stdio: 'inherit' }
);
run(
  [path.join(root, 'tools', 'build-lmdb-index.js'), '--mode', 'all', '--repo', repoRoot],
  'build lmdb index',
  { stdio: 'inherit' }
);

const userConfig = loadUserConfig(repoRoot);
const lmdbPaths = resolveLmdbPaths(repoRoot, userConfig);
const db = open({ path: lmdbPaths.codePath, readOnly: false });
if (typeof db.removeSync === 'function') {
  db.removeSync(LMDB_META_KEYS.schemaVersion);
} else {
  db.remove(LMDB_META_KEYS.schemaVersion);
}
db.close();

const report = run(
  [path.join(root, 'tools', 'report-artifacts.js'), '--json', '--repo', repoRoot],
  'report artifacts',
  { encoding: 'utf8' }
);

let payload = null;
try {
  payload = JSON.parse(report.stdout || '{}');
} catch {
  console.error('Failed to parse report-artifacts JSON output.');
  process.exit(1);
}

if (payload?.corruption?.ok !== false) {
  console.error('Expected corruption report ok=false after LMDB tamper.');
  process.exit(1);
}
if (payload?.corruption?.lmdb?.ok !== false) {
  console.error('Expected LMDB corruption report ok=false.');
  process.exit(1);
}
const issues = Array.isArray(payload?.corruption?.issues) ? payload.corruption.issues : [];
if (!issues.some((issue) => issue.includes('lmdb/code'))) {
  console.error('Expected LMDB corruption issues for code db.');
  process.exit(1);
}
if (!issues.some((issue) => issue.includes('schema mismatch'))) {
  console.error('Expected LMDB schema mismatch issue after tampering.');
  process.exit(1);
}

console.log('lmdb corruption test passed');


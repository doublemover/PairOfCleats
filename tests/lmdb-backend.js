#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Packr, Unpackr } from 'msgpackr';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../src/storage/lmdb/schema.js';
import { resolveLmdbPaths } from '../tools/dict-utils.js';
import { getCombinedOutput } from './helpers/stdio.js';

let open = null;
try {
  ({ open } = await import('lmdb'));
} catch (err) {
  console.error(`lmdb missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lmdb-backend');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'const beta = 2;\\n');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_lmdb_index', [path.join(root, 'tools', 'build-lmdb-index.js'), '--mode', 'code', '--repo', repoRoot]);

const lmdbPaths = resolveLmdbPaths(repoRoot, {});
const dbPath = lmdbPaths.codePath;
const dataPath = path.join(dbPath, 'data.mdb');
if (!fs.existsSync(dataPath)) {
  console.error(`Expected LMDB data file to exist at ${dataPath}`);
  process.exit(1);
}

const db = open({ path: dbPath, readOnly: true });
const unpackr = new Unpackr();
const decode = (value) => (value == null ? null : unpackr.unpack(value));
const version = decode(db.get(LMDB_META_KEYS.schemaVersion));
if (version !== LMDB_SCHEMA_VERSION) {
  console.error(`Expected LMDB schema version ${LMDB_SCHEMA_VERSION}, got ${version}`);
  process.exit(1);
}
const mode = decode(db.get(LMDB_META_KEYS.mode));
if (mode !== 'code') {
  console.error(`Expected LMDB mode code, got ${mode}`);
  process.exit(1);
}
const chunkCount = Number(decode(db.get(LMDB_META_KEYS.chunkCount)) || 0);
if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
  console.error('Expected LMDB chunkCount to be positive.');
  process.exit(1);
}
db.close();

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'alpha', '--json', '--backend', 'lmdb', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  { encoding: 'utf8', env }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for LMDB backend test.');
  process.exit(searchResult.status ?? 1);
}
const output = String(searchResult.stdout || '').trim();
let payload = null;
try {
  payload = JSON.parse(output);
} catch {
  console.error('Failed to parse LMDB search JSON output.');
  process.exit(1);
}
if (payload.backend !== 'lmdb') {
  console.error(`Expected backend=lmdb, got ${payload.backend}`);
  process.exit(1);
}

const dbWrite = open({ path: dbPath, readOnly: false });
dbWrite.putSync(LMDB_META_KEYS.schemaVersion, new Packr().pack(LMDB_SCHEMA_VERSION + 1));
dbWrite.close();

const badSearch = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'alpha', '--json', '--backend', 'lmdb', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  { encoding: 'utf8', env }
);
if (badSearch.status === 0) {
  console.error('Expected lmdb search to fail on schema mismatch.');
  process.exit(1);
}
const badOutput = getCombinedOutput(badSearch);
if (!badOutput.includes('schema mismatch')) {
  console.error('Expected lmdb schema mismatch error message.');
  process.exit(1);
}

console.log('lmdb backend test passed');


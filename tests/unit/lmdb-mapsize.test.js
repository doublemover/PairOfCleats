#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Unpackr } from 'msgpackr';
import { LMDB_META_KEYS } from '../../src/storage/lmdb/schema.js';
import { resolveLmdbPaths } from '../../tools/dict-utils.js';
import { requireOrSkip } from '../helpers/require-or-skip.js';

requireOrSkip({ capability: 'lmdb', reason: 'Skipping lmdb mapsize test; lmdb not available.' });

const { open } = await import('lmdb');

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lmdb-mapsize');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\\n');

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
const db = open({ path: dbPath, readOnly: true });
const unpackr = new Unpackr();
const decode = (value) => (value == null ? null : unpackr.unpack(value));
const mapSizeBytes = Number(decode(db.get(LMDB_META_KEYS.mapSizeBytes)));
const mapSizeEstimatedBytes = Number(decode(db.get(LMDB_META_KEYS.mapSizeEstimatedBytes)));
db.close();

if (!Number.isFinite(mapSizeBytes) || mapSizeBytes <= 0) {
  console.error('Expected lmdb mapSizeBytes to be a positive number.');
  process.exit(1);
}
if (!Number.isFinite(mapSizeEstimatedBytes) || mapSizeEstimatedBytes < 0) {
  console.error('Expected lmdb mapSizeEstimatedBytes to be a non-negative number.');
  process.exit(1);
}
if (mapSizeBytes < mapSizeEstimatedBytes) {
  console.error(`Expected mapSizeBytes >= estimated bytes (${mapSizeBytes} < ${mapSizeEstimatedBytes}).`);
  process.exit(1);
}

console.log('lmdb mapSize meta test passed');

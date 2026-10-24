import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { createLockPayload } from '../../../src/shared/locks/file-lock-info.js';
import { repoAccessPaths, inspectRepoCacheAccess, acquireRepoCacheAccessLease,
  withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const temporary = await makeTempDir('poc-storage-unknown-owner-');
try {
  const root = path.join(temporary, 'owned-cache');
  const coordinationRoot = path.join(temporary, 'state', 'storage-access');
  const options = { coordinationRoot };
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'saved-evidence'), 'retained bytes');
  const paths = repoAccessPaths(root, options);
  await fs.mkdir(paths.leases, { recursive: true });
  const unknown = { ...createLockPayload({ scope: 'fixture-resource-reader', hostname: os.hostname() }), pid: Number.MAX_SAFE_INTEGER };
  const file = path.join(paths.leases, `${unknown.lockId}.json`);
  const unknownBytes = JSON.stringify(unknown);
  await fs.writeFile(file, unknownBytes);
  assert.equal((await inspectStorageAccess(root, options)).protected, true, 'unknown liveness is not death proof');
  assert.equal(inspectRepoCacheAccess(root, options).length, 1);
  assert.equal(await fs.readFile(file, 'utf8'), unknownBytes, 'out-of-range PID metadata cannot be reaped');
  const guarded = await withExclusiveRepoCacheCleanup(root, () => assert.fail('unknown reader cannot yield'), options);
  assert.equal(guarded.protected, true);
  await fs.writeFile(paths.lockPath, unknownBytes);
  const excluded = await withExclusiveRepoCacheCleanup(root, () => assert.fail('unknown exclusion owner cannot be replaced'), options);
  assert.equal(excluded.protected, true);
  assert.equal(await fs.readFile(paths.lockPath, 'utf8'), unknownBytes, 'generic stale fallback cannot force-remove unknown owner');
  assert.throws(() => acquireRepoCacheAccessLease(root, options), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
  assert.deepEqual(await fs.readdir(paths.leases), [path.basename(file)], 'failed reader admission removes only its exact newly-created lease');
  assert.equal(await fs.readFile(paths.lockPath, 'utf8'), unknownBytes);
  const annotated = { ...unknown, pid: 2147483647, references: { retained: true } };
  await fs.writeFile(file, JSON.stringify(annotated));
  const annotatedBytes = await fs.readFile(file);
  assert.equal(inspectRepoCacheAccess(root, options).length, 1, 'unknown reference fields retain lease evidence even for an apparently dead PID');
  assert.deepEqual(await fs.readFile(file), annotatedBytes);
  assert.equal(await fs.readFile(path.join(root, 'saved-evidence'), 'utf8'), 'retained bytes');
} finally { await rmDirRecursive(temporary); }
console.log('storage unknown owner authority passed');

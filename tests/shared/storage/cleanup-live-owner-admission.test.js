import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupDerivedRepoArtifacts } from '../../../src/shared/storage/repo-cleanup.js';
import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temporary = await makeTempDir('cleanup-live-owner-');
const cacheRoot = path.join(temporary, 'cache');
const root = path.join(cacheRoot, 'repos', 'fixture-000000000001');
const sentinel = path.join(root, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
const bytes = JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks'));
await fs.mkdir(path.dirname(sentinel), { recursive: true });
await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
await fs.writeFile(sentinel, bytes);
const clean = () => cleanupDerivedRepoArtifacts({ repoCacheRoot: root, cacheRoot });
let reader = acquireRepoCacheAccessLease(root);
try {
  assert.equal((await clean()).status, 'retained-protected');
  assert.equal(await fs.readFile(sentinel, 'utf8'), bytes, 'live reader can still lazily open its artifact');
  assert.equal(reader.release(), true); reader = null;
  await fs.mkdir(path.join(root, 'locks'));
  const lock = path.join(root, 'locks', 'index.lock');
  const owner = JSON.stringify({ pid: process.pid, lockId: 'controlled-writer' });
  await fs.writeFile(lock, owner);
  assert.equal((await clean()).reason, 'active-or-unknown-builder');
  assert.equal(await fs.readFile(lock, 'utf8'), owner);
  await fs.unlink(lock);
  const originalOpen = fs.open;
  let entered = false;
  fs.open = async (filename, flags, ...rest) => {
    if (!entered && String(filename).endsWith('cleanup.lock') && String(flags).includes('x')) {
      entered = true; reader = acquireRepoCacheAccessLease(root);
    }
    return originalOpen(filename, flags, ...rest);
  };
  try { assert.equal((await clean()).status, 'retained-protected'); }
  finally { fs.open = originalOpen; }
  assert.equal(entered, true, 'real exclusion handshake observes a reader arriving after initial planning');
  assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
  assert.equal(reader.release(), true); reader = null;
  const saved = path.join(root, 'snapshots', 'saved.txt');
  await fs.mkdir(path.dirname(saved)); await fs.writeFile(saved, 'retained-user-evidence');
  assert.equal((await clean()).status, 'retained-protected');
  assert.equal(await fs.readFile(saved, 'utf8'), 'retained-user-evidence');
  await fs.unlink(saved); await fs.rmdir(path.dirname(saved));
  assert.equal((await cleanupDerivedRepoArtifacts({ repoCacheRoot: root, cacheRoot, dryRun: true })).status, 'planned');
  assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
  assert.equal((await clean()).status, 'removed', 'released producer-qualified disposable cache remains cleanable');
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
} finally { reader?.release(); await rmDirRecursive(temporary); }
console.log('Cleanup retains live readers/builders/evidence and removes only qualified released data.');

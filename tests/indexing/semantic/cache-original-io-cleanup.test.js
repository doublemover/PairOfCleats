import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { openSemanticCacheEntry, relocateSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { readCachedBundle } from '../../../src/index/build/incremental/state-reconciliation.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/cache-original-io-cleanup/')[1];
assert.ok(['copy-pending', 'cleanup-pending', 'copy-null', 'copy-undefined', 'cleanup-zero',
  'descriptor-pending', 'reconciliation-pending', 'cancelled-descriptor-pending'].includes(mode));
const fixture = await createSemanticCacheFixture();
const copyFile = fs.copyFile, remove = fs.rm, open = fs.open;
let ready = false, session, closes = 0, removals = 0, copies = 0, codeReads = 0, failed = false, failure, staging;
const controller = new AbortController();
const pending = Object.assign(new Error('original outstanding cache I/O'), {
  cacheOwnershipReleased() { assert.equal(this, pending); return ready; }
});
Object.defineProperty(pending, 'code', { get() { codeReads++; pending.cacheOwnershipReleased = () => true; return 'ENOENT'; } });
const primary = Object.freeze(Object.assign(new Error('original copy failed'), { code: 'EIO' }));
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (Object.is(current, expected)) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, 'cause'), errors = Object.getOwnPropertyDescriptor(current, 'errors');
    if (cause && 'value' in cause) queue.push(cause.value);
    if (Array.isArray(errors?.value)) queue.push(...errors.value);
  }
  return false;
};
try {
  const file = await fixture.createFile(), targetBuildRoot = path.join(fixture.root, 'new-generation');
  const account = createSemanticDiskAccount(16 * 1024 * 1024);
  const options = { repoRoot: fixture.repoRoot, bundleDir: fixture.bundleDir, locator: file.entry.semanticCache,
    dependencySignatures: fixture.dependencies, sourceHash: file.source.byteHash, sourcePath: file.file,
    repositoryNamespace: fixture.repoRoot, targetBuildRoot,
    storage: { ...fixture.storage, generation: { baseBuildId: 'recovery-generation', semanticRevision: 0 } }, diskAccount: account };
  if (mode.endsWith('descriptor-pending') || mode === 'reconciliation-pending') {
    fs.open = async (filename, ...args) => {
      const handle = await open(filename, ...args);
      if (typeof filename !== 'string' || !filename.endsWith(path.sep + 'descriptor.json')) return handle;
      return new Proxy(handle, { get(owner, key) {
        if (key === 'read') return async () => { if (mode === 'cancelled-descriptor-pending') controller.abort(); throw pending; };
        if (key === 'close') return async () => { closes++; await owner.close(); };
        const value = Reflect.get(owner, key, owner); return typeof value === 'function' ? value.bind(owner) : value;
      } });
    };
    try {
      if (mode === 'reconciliation-pending') await readCachedBundle({ repoRoot: fixture.repoRoot, enabled: true,
        absPath: path.join(fixture.repoRoot, file.file), relKey: file.file,
        fileStat: { size: file.bytes.length, mtimeMs: file.entry.mtimeMs }, manifest: fixture.manifest, bundleDir: fixture.bundleDir,
        semanticContext: { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot, buildRoot: targetBuildRoot,
          storage: options.storage, diskAccount: account, dependencySignatures: fixture.dependencies } });
      else await openSemanticCacheEntry({ repoRoot: fixture.repoRoot, bundleDir: fixture.bundleDir,
        locator: file.entry.semanticCache, expectedDependencySignatures: fixture.dependencies, signal: controller.signal });
    } catch (error) { failed = true; failure = error; }
    assert.equal(failed, true, 'an original pending descriptor read cannot become an ordinary cache miss or abort');
    assert.equal(codeReads, 0); assert.equal(closes, 0);
    assert.equal(failure.cacheOwnershipReleased(), false); session = getContainedFileSession(failure);
    assert.equal(typeof session?.releaseAfterClose, 'function');
    pending.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; assert.equal((await session.releaseAfterClose()).settled, true);
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
  } else {
    fs.copyFile = async (from, to, ...args) => {
      copies++; staging = path.dirname(to);
      while (!path.basename(staging).startsWith('semantic-cache-')) {
        const parent = path.dirname(staging); assert.notEqual(parent, staging); staging = parent;
      }
      if (mode === 'copy-null') throw null;
      if (mode === 'copy-undefined') throw undefined;
      if (mode === 'copy-pending') { await copyFile(from, to, ...args); throw pending; }
      throw primary;
    };
    fs.rm = async (filename, ...args) => {
      if (path.toNamespacedPath(filename) === path.toNamespacedPath(staging)) {
        removals++;
        if (mode === 'cleanup-pending') throw pending;
        if (mode === 'cleanup-zero') throw 0;
      }
      return remove(filename, ...args);
    };
    try { await relocateSemanticCacheEntry(options); } catch (error) { failed = true; failure = error; }
    assert.equal(failed, true); assert.equal(copies, 1);
    assert.equal(contains(failure, mode === 'copy-null' ? null : mode === 'copy-undefined' ? undefined : mode === 'copy-pending' ? pending : primary), true);
    if (['copy-null', 'copy-undefined'].includes(mode)) {
      assert.equal(failure, mode === 'copy-null' ? null : undefined); assert.equal(removals, 1); assert.equal(account.used, 0);
      await assert.rejects(fs.lstat(staging), { code: 'ENOENT' });
    } else {
      assert.equal(removals, mode === 'copy-pending' ? 0 : 1);
      assert.ok((await fs.lstat(staging)).isDirectory()); assert.ok(account.used > 0, 'uncertain staging keeps original reservation');
      if (mode === 'cleanup-zero') assert.equal(contains(failure, 0), true, 'falsey cleanup failure cannot replace or disappear behind the operation cause');
      else {
        assert.equal(failure.cacheOwnershipReleased(), false); pending.cacheOwnershipReleased = () => true;
        assert.equal(failure.cacheOwnershipReleased(), false); ready = true;
        assert.equal(failure.cacheOwnershipReleased(), true);
      }
      assert.equal(copies, 1); assert.equal(removals, mode === 'copy-pending' ? 0 : 1, 'late settlement never replays copy or automatic deletion');
      const retained = await reopenSemanticDiskAccount({ roots: [targetBuildRoot], limit: Number.MAX_SAFE_INTEGER });
      assert.ok(account.used >= retained.retainedBytes);
    }
    fs.copyFile = copyFile; fs.rm = remove;
    const fresh = createSemanticDiskAccount(16 * 1024 * 1024), healthyRoot = path.join(fixture.root, 'healthy-generation');
    const healthy = await relocateSemanticCacheEntry({ ...options, targetBuildRoot: healthyRoot, diskAccount: fresh });
    assert.equal(healthy.canonicalHash, file.factsRef.canonicalHash);
    assert.equal(fresh.used, (await reopenSemanticDiskAccount({ roots: [healthyRoot], limit: Number.MAX_SAFE_INTEGER })).retainedBytes);
  }
} finally {
  fs.copyFile = copyFile; fs.rm = remove; fs.open = open; ready = true;
  if (session) await session.releaseAfterClose();
  await fixture.cleanup();
}

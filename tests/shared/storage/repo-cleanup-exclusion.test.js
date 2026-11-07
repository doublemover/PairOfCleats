import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cleanupDerivedRepoArtifacts } from '../../../src/shared/storage/repo-cleanup.js';
import { withRepoCleanupExclusion } from '../../../src/shared/storage/repo-cleanup-exclusion.js';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { getContainedFileSession, readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { cleanArtifacts } from '../../../tools/mcp/tools/handlers/artifacts.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('repo-cleanup-exclusion/')[1];
assert.ok(['readers-and-race', 'original-close', 'metadata-failure'].includes(selected));
const temporary = await makeTempDir(`repo-cleanup-${selected}-`);
const repo = path.join(temporary, 'repo'), cacheRoot = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
await fs.mkdir(repo); await fs.mkdir(cacheRoot);
const userConfig = { cache: { root: cacheRoot } };
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(userConfig));
await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
const env = applyTestEnv({ cacheRoot, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const repoCacheRoot = resolveRepoCacheRootPath(repo, userConfig), coordinationRoot = path.join(home, 'state', 'storage-access');
const sentinel = path.join(repoCacheRoot, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
const bytes = JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks'));
await fs.mkdir(path.dirname(sentinel), { recursive: true }); await fs.writeFile(sentinel, bytes);
const cleanup = dryRun => cleanupDerivedRepoArtifacts({ repoCacheRoot, cacheRoot, dryRun });
const admission = () => acquireStorageSession({ roots: [repoCacheRoot], authorizedRoots: [cacheRoot, path.join(home, 'state')],
  coordinationRoot, resourceId: 'actual-reader-resource' });
const release = session => session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
const open = fs.open, remove = fs.rm;
let session = null, failure, permitClose = false;
try {
  if (selected === 'readers-and-race') {
    session = admission();
    const child = runNode([path.resolve('tools/index/clean-artifacts.js'), '--repo', repo], 'modern reader cleanup CLI', process.cwd(), env,
      { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    assert.equal(child.status, 1); assert.match(child.stderr, /active-or-unknown-resource/);
    await assert.rejects(cleanArtifacts({ repoPath: repo }), /active-or-unknown-resource|Cleanup partial/);
    assert.equal((await cleanup(true)).status, 'retained-protected');
    assert.equal(await fs.readFile(sentinel, 'utf8'), bytes, 'lazy reader remains usable through CLI/MCP/preview');
    release(session); session = null;
    const writer = await acquireIndexLock({ repoCacheRoot, storageContext: { repoRoot: repo, userConfig } });
    assert.ok(writer);
    try { assert.equal((await cleanup(false)).status, 'retained-protected'); }
    finally { await writer.release(); }
    let injected = false;
    const legacyLock = repoAccessPaths(repoCacheRoot).lockPath;
    fs.open = async (target, ...args) => {
      if (!injected && target === legacyLock) { injected = true; session = admission(); }
      return open(target, ...args);
    };
    try {
      const outcome = await cleanup(false);
      assert.equal(injected, true, 'reader admission must occur after preflight and before exclusion apply');
      assert.equal(outcome.status, 'retained-protected');
      assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
    } finally { fs.open = open; if (session) { release(session); session = null; } }
    const leases = repoAccessPaths(repoCacheRoot, { coordinationRoot }).leases;
    await fs.mkdir(leases, { recursive: true });
    const unknown = path.join(leases, 'unknown.json'); await fs.writeFile(unknown, '{');
    assert.equal((await cleanup(false)).status, 'retained-protected', 'unreadable modern authority is never a clean inventory');
    await fs.unlink(unknown);
    await withRepoCleanupExclusion({ repoCacheRoot, cacheRoot, action: async () => {
      assert.throws(admission, { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      assert.throws(() => acquireRepoCacheAccessLease(repoCacheRoot), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      await assert.rejects(acquireIndexLock({ repoCacheRoot, storageContext: { repoRoot: repo, userConfig } }), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
      const category = await withExclusiveStorageAccess(cacheRoot, () => assert.fail('cleanup must pin its category'), { coordinationRoot });
      assert.equal(category.protected, true);
    } });
    assert.equal((await cleanup(true)).status, 'planned');
    assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
    const saved = path.join(repoCacheRoot, 'triage', 'saved.json');
    await fs.mkdir(path.dirname(saved)); await fs.writeFile(saved, '{"saved":"evidence"}');
    assert.equal((await cleanup(false)).status, 'retained-protected');
    assert.equal(await fs.readFile(saved, 'utf8'), '{"saved":"evidence"}');
    await fs.unlink(saved); await fs.rmdir(path.dirname(saved));
    assert.equal((await cleanup(false)).status, 'removed');
    await assert.rejects(fs.stat(repoCacheRoot), { code: 'ENOENT' });
  } else if (selected === 'original-close') {
    let closes = 0, reads = 0;
    fs.open = async (target, ...args) => {
      const descriptor = await open(target, ...args); if (target !== sentinel) return descriptor;
      const close = descriptor.close, read = descriptor.read;
      descriptor.read = async (...values) => { reads++; return read.call(descriptor, ...values); };
      descriptor.close = async () => { closes++; if (!permitClose) throw Object.freeze(new Error('controlled cleanup descriptor close failure')); return close.call(descriptor); };
      return descriptor;
    };
    await assert.rejects(withRepoCleanupExclusion({ repoCacheRoot, cacheRoot,
      action: () => readVerifiedContainedFile(repoCacheRoot, sentinel) }), error => { failure = error; return Boolean(error.repoCleanupOwner); });
    const native = getContainedFileSession(failure); assert.ok(native);
    await assert.rejects(failure.repoCleanupOwner.close());
    assert.equal(closes, 1); assert.equal(reads, 1);
    for (const options of [{}, { coordinationRoot }]) await fs.stat(repoAccessPaths(repoCacheRoot, options).lockPath);
    assert.equal((await inspectStorageAccess(cacheRoot, { coordinationRoot })).protected, true);
    permitClose = true; await native.releaseAfterClose();
    for (const options of [{}, { coordinationRoot }]) await fs.stat(repoAccessPaths(repoCacheRoot, options).lockPath);
    await failure.repoCleanupOwner.close(); await failure.repoCleanupOwner.close();
    assert.equal(closes, 2); assert.equal(reads, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal((await inspectStorageAccess(cacheRoot, { coordinationRoot })).protected, false);
    for (const options of [{}, { coordinationRoot }]) await assert.rejects(fs.stat(repoAccessPaths(repoCacheRoot, options).lockPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
  } else {
    const primary = Object.freeze(new Error('original work refusal'));
    const secondary = Object.freeze(Object.assign(new Error('owned exclusion removal refusal'), { code: 'EACCES' }));
    const modernLock = repoAccessPaths(repoCacheRoot, { coordinationRoot }).lockPath;
    let deny = true, calls = 0;
    fs.rm = async (target, ...args) => { if (target === modernLock && deny) throw secondary; return remove(target, ...args); };
    await assert.rejects(withRepoCleanupExclusion({ repoCacheRoot, cacheRoot, action: async () => { calls++; throw primary; } }),
      error => { failure = error; return errorGraphIncludes(error, primary) && Boolean(error.repoCleanupOwner); });
    assert.equal(errorGraphIncludes(failure, secondary), true, 'the exact metadata refusal must remain alongside the original work failure');
    let firstCause = failure;
    for (let depth = 0; Object.hasOwn(firstCause, 'cause') && depth < 16; depth++) firstCause = firstCause.cause;
    assert.equal(firstCause, primary, 'the primary cause chain must still end at the exact original work failure');
    assert.equal(failure.cacheOwnershipReleased(), false);
    deny = false; await failure.repoCleanupOwner.close();
    assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(calls, 1);
    for (const options of [{}, { coordinationRoot }]) await assert.rejects(fs.stat(repoAccessPaths(repoCacheRoot, options).lockPath), { code: 'ENOENT' });
  }
} finally {
  fs.open = open; fs.rm = remove; permitClose = true;
  if (session) release(session);
  if (failure) { await getContainedFileSession(failure)?.releaseAfterClose(); await failure.repoCleanupOwner?.close(); }
  await rmDirRecursive(temporary);
}
console.log(`Repository cleanup ${selected} preserves original resources and both admission namespaces.`);

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createWatchAttemptManager } from '../../../src/index/build/watch/attempts.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { getApplicationHome } from '../../../src/shared/cache-roots.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createSettledWatchAttempt } from '../../helpers/watch-attempts.js';

const { dir: root } = await prepareIsolatedTestCacheDir('watch-retention-native-close');
applyTestEnv({ cacheRoot: root, extraEnv: { PAIROFCLEATS_HOME: path.join(root, 'home') } });
const repoRoot = path.join(root, 'repo'); await fs.mkdir(repoRoot);
const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, {});
const manager = createWatchAttemptManager({ repoRoot, userConfig: {}, log() {} });
const record = attempt => manager.recordOutcome(attempt, false, { writersSettled: true });
const coordinationRoot = path.join(getApplicationHome(), 'state', 'storage-access');
const open = fs.open;
let permitClose = false, closes = 0, reads = 0, failure;
try {
  const a = await createSettledWatchAttempt(manager, repoRoot), b = await createSettledWatchAttempt(manager, repoRoot);
  const c = await createSettledWatchAttempt(manager, repoRoot), pointer = path.join(repoCacheRoot, 'builds', 'current.json');
  await fs.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: c.buildId, buildRoot: path.relative(repoCacheRoot, c.buildRoot), promotedAt: new Date().toISOString() }));
  await record(a); // One retained failure has not reached the pruning boundary.
  fs.open = async (target, ...args) => {
    const descriptor = await open(target, ...args); if (target !== pointer) return descriptor;
    const close = descriptor.close, read = descriptor.read;
    descriptor.read = async (...values) => { reads++; return read.call(descriptor, ...values); };
    descriptor.close = async () => {
      closes++;
      if (!permitClose) throw Object.freeze(new Error('controlled pointer descriptor close failure'));
      return close.call(descriptor);
    };
    return descriptor;
  };
  await assert.rejects(record(b), error => { failure = error; return Boolean(error.watchRetentionOwner); });
  assert.equal(closes, 1); assert.equal(reads, 1);
  const native = getContainedFileSession(failure); assert.ok(native);
  await assert.rejects(failure.watchRetentionOwner.close());
  assert.equal(closes, 1, 'metadata reconciliation cannot retry an outstanding native close');
  for (const options of [{}, { coordinationRoot }]) await fs.stat(repoAccessPaths(repoCacheRoot, options).lockPath);
  assert.equal(await acquireIndexLock({ repoCacheRoot, requireSettlement: true }), null);
  await fs.stat(a.buildRoot);
  assert.equal((await inspectStorageAccess(path.dirname(path.dirname(repoCacheRoot)), { coordinationRoot })).protected, true);
  permitClose = true; await native.releaseAfterClose();
  assert.equal(closes, 2); assert.equal(reads, 1, 'recovery closes the original descriptor without repeating its read');
  await fs.stat(path.join(repoCacheRoot, 'locks', 'index.lock'));
  await failure.watchRetentionOwner.close();
  assert.equal(failure.cacheOwnershipReleased(), true);
  await failure.watchRetentionOwner.close();
  for (const options of [{}, { coordinationRoot }]) await assert.rejects(fs.stat(repoAccessPaths(repoCacheRoot, options).lockPath), { code: 'ENOENT' });
  fs.open = open;
  await record(b); await assert.rejects(fs.stat(a.buildRoot), { code: 'ENOENT' });
  for (const attempt of [b, c]) await fs.stat(attempt.buildRoot);
} finally {
  fs.open = open; permitClose = true;
  if (failure) { await getContainedFileSession(failure)?.releaseAfterClose(); await failure.watchRetentionOwner?.close(); }
  await fs.rm(root, { recursive: true, force: true });
}
console.log('A failed pointer close retains original native recovery, both exclusions and promotion ownership until explicit reconciliation.');

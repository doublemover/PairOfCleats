import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createWatchAttemptManager } from '../../../src/index/build/watch/attempts.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { getApplicationHome } from '../../../src/shared/cache-roots.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { acquireStorageSession } from '../../../src/shared/storage/session.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createSettledWatchAttempt } from '../../helpers/watch-attempts.js';

const { dir: root } = await prepareIsolatedTestCacheDir('watch-retained-readers');
applyTestEnv({ cacheRoot: root, extraEnv: { PAIROFCLEATS_HOME: path.join(root, 'home') } });
const coordinationRoot = path.join(getApplicationHome(), 'state', 'storage-access');
const exists = async attempt => assert.equal(await fs.readFile(path.join(attempt.buildRoot, 'lazy-shard'), 'utf8'), attempt.attemptId);
const missing = attempt => assert.rejects(fs.stat(attempt.buildRoot), { code: 'ENOENT' });
const fixture = async name => {
  const repoRoot = path.join(root, name); await fs.mkdir(repoRoot);
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, {});
  const manager = createWatchAttemptManager({ repoRoot, userConfig: {}, log() {} });
  const create = async () => {
    const attempt = await createSettledWatchAttempt(manager, repoRoot);
    await fs.writeFile(path.join(attempt.buildRoot, 'lazy-shard'), attempt.attemptId); return attempt;
  };
  const pointer = path.join(repoCacheRoot, 'builds', 'current.json');
  const publish = attempt => fs.writeFile(pointer, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: attempt.buildId, buildRoot: path.relative(repoCacheRoot, attempt.buildRoot), promotedAt: new Date().toISOString() }));
  const record = attempt => manager.recordOutcome(attempt, true, { writersSettled: true });
  return { repoRoot, repoCacheRoot, manager, create, publish, record };
};
try {
  for (const protocol of ['legacy', 'resource']) {
    const f = await fixture(protocol), a = await f.create(), b = await f.create(), c = await f.create(), d = await f.create();
    await f.publish(a); await f.record(a);
    const descriptor = await fs.open(path.join(a.buildRoot, 'lazy-shard'), 'r');
    const session = protocol === 'resource' ? acquireStorageSession({ roots: [f.repoCacheRoot],
      authorizedRoots: [root], coordinationRoot, resourceId: `watch-reader-${protocol}` }) : null;
    const lease = session ? null : acquireRepoCacheAccessLease(f.repoCacheRoot,
      { requireSettlement: true, resourceId: `watch-reader-${protocol}` });
    let closed = false;
    const close = async allow => {
      if (!allow) throw new Error('controlled descriptor close failure');
      await descriptor.close(); closed = true;
      if (session) session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
      else assert.equal(lease.release(), true);
    };
    try {
      await f.publish(b); await f.record(b); await f.publish(c); await f.record(c); await f.record(d);
      await exists(a); // This shard was not opened when the reader acquired its lease.
      const lazy = await fs.open(path.join(a.buildRoot, 'lazy-shard'), 'r');
      try { assert.equal(await lazy.readFile('utf8'), a.attemptId); } finally { await lazy.close(); }
      await assert.rejects(close(false), /controlled descriptor close failure/);
      await f.record(d); await exists(a);
      await close(true);
      await f.record(d); await missing(a);
      for (const attempt of [b, c, d]) await exists(attempt);
    } finally {
      if (!closed) await close(true);
    }
  }
  for (const protocol of ['legacy', 'resource']) {
    const f = await fixture(`unknown-${protocol}`), a = await f.create(), b = await f.create(), c = await f.create();
    const options = protocol === 'resource' ? { coordinationRoot } : {};
    const leases = repoAccessPaths(f.repoCacheRoot, options).leases;
    await fs.mkdir(leases, { recursive: true });
    const unknown = path.join(leases, 'unknown-fixture.json'); await fs.writeFile(unknown, '{unreadable');
    for (const attempt of [a, b, c]) await f.record(attempt);
    await exists(a); await fs.unlink(unknown); await f.record(c); await missing(a);
  }
  {
    const f = await fixture('publication-exclusion'), a = await f.create(), b = await f.create(), c = await f.create();
    await f.record(a); await f.record(b);
    const publisher = await acquireIndexLock({ repoCacheRoot: f.repoCacheRoot, requireSettlement: true });
    assert.ok(publisher);
    try {
      await f.record(c); await exists(a);
      await f.publish(a); // The admitted publisher changes authority before retention can acquire the index lock.
    } finally { await publisher.release(); }
    await f.record(c); for (const attempt of [a, b, c]) await exists(attempt);
    const d = await f.create(); await f.record(d);
    await exists(a); await missing(b);
  }
  {
    const f = await fixture('issued-authority'), a = await f.create(), b = await f.create(), c = await f.create();
    await assert.rejects(f.manager.createAttempt(), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });
    await assert.rejects(f.record({ ...a }), /exact issued attempt/);
    await f.record(a); await f.record(b);
    await f.manager.recordOutcome(c, true); // No writer-settlement acknowledgement grants no deletion admission.
    await exists(a);
    const original = `${a.buildRoot}-original`; await fs.rename(a.buildRoot, original); await fs.mkdir(a.buildRoot);
    await fs.writeFile(path.join(a.buildRoot, 'replacement'), 'unowned replacement');
    await assert.rejects(f.record(c), /directory identity changed/);
    assert.equal(await fs.readFile(path.join(a.buildRoot, 'replacement'), 'utf8'), 'unowned replacement');
    await fs.rm(a.buildRoot, { recursive: true }); await fs.rename(original, a.buildRoot);
    await f.record(c); await missing(a);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Watch retention honors both reader protocols, unknown evidence, promotion exclusion and exact issued directory identity.');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../../src/shared/storage/cleanup.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import os from 'node:os';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';

const temporary = await makeTempDir('poc-storage-cleanup-');
try {
  const root = path.join(temporary, 'cache');
  const probes = path.join(root, 'tooling', 'command-probes');
  const markerOnly = path.join(probes, `${'a'.repeat(40)}.json`);
  await fs.mkdir(probes, { recursive: true });
  const originalMarkerBytes = JSON.stringify(withGeneratedCacheMetadata({ result: 'derived' }, 'command-probe'));
  await fs.writeFile(markerOnly, originalMarkerBytes);
  for (const category of ['triage', 'snapshots', 'diffs', 'builds']) {
    await fs.mkdir(path.join(root, 'repos', 'repo-123456789abc', category), { recursive: true });
    await fs.writeFile(path.join(root, 'repos', 'repo-123456789abc', category, 'saved.json'), 'preserved');
  }
  const preprocess = path.join(root, 'repos', 'repo-123456789abc', 'preprocess', 'snapshot.json');
  await fs.mkdir(path.dirname(preprocess), { recursive: true });
  await fs.writeFile(preprocess, 'source-classification-replay-evidence');
  const unmarked = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  assert.equal(unmarked.operations.length, 0, 'launch selection alone cannot adopt an unmarked root');
  await fs.writeFile(path.join(root, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const markedOnly = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  assert.equal(markedOnly.operations.length, 0, 'a header alone cannot prove complete command-probe ownership');
  assert.equal(await fs.readFile(markerOnly, 'utf8'), originalMarkerBytes);
  // Positive authority now comes from the real producer's complete key and
  // payload. The old marker-only bytes above remain an explicit protected case.
  const producerCache = path.join(temporary, 'producer-cache');
  assert.equal(writePersistentCommandProbeCache({ providerId: 'fixture', command: process.execPath, args: ['--version'],
    cwd: temporary, probeEnv: {}, toolingConfig: { cache: { dir: producerCache } }, attempted: [{ ok: true }] }), true);
  const producerDir = path.join(producerCache, 'command-probes');
  const [producerName] = await fs.readdir(producerDir);
  const producerBytes = await fs.readFile(path.join(producerDir, producerName));
  const candidate = path.join(probes, producerName);
  await fs.writeFile(candidate, producerBytes);
  const planned = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  assert.equal(planned.operations.length, 1);
  await assert.rejects(applyStorageCleanupPlan(planned, { authorityRoots: [root], approvedPlanId: 'force' }), /exact complete/);
  await fs.writeFile(candidate, JSON.stringify(withGeneratedCacheMetadata({ result: 'replacement' }, 'command-probe')));
  const changed = await applyStorageCleanupPlan(planned, { authorityRoots: [root], approvedPlanId: planned.planId });
  assert.equal(changed.results[0].status, 'failed', 'preview/apply replacement fails closed');
  assert.match(await fs.readFile(candidate, 'utf8'), /replacement/);
  const { leases } = repoAccessPaths(probes);
  await fs.mkdir(leases, { recursive: true });
  const live = path.join(leases, 'fixture-live.json');
  await fs.writeFile(live, JSON.stringify({ pid: process.pid, hostname: os.hostname(), lockId: 'fixture' }));
  const active = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  assert.equal(active.operations.length, 0, 'live assets are not disposable');
  await fs.unlink(live);
  const ready = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  assert.equal(ready.operations.length, 0, 'replacement metadata is retained without genuine producer authority');
  await fs.writeFile(candidate, producerBytes);
  const genuinelyReady = await planCacheRootCleanup({ cacheRoot: root, authorityRoots: [root] });
  const applied = await applyStorageCleanupPlan(genuinelyReady, { authorityRoots: [root], approvedPlanId: genuinelyReady.planId });
  assert.equal(applied.results[0].status, 'deleted');
  assert.equal(applied.actualReclaimedBytes, null, 'unlink is not physical free-space measurement');
  for (const category of ['triage', 'snapshots', 'diffs', 'builds']) {
    assert.equal(await fs.readFile(path.join(root, 'repos', 'repo-123456789abc', category, 'saved.json'), 'utf8'), 'preserved');
  }
  assert.equal(await fs.readFile(preprocess, 'utf8'), 'source-classification-replay-evidence', 'registration does not grant generic snapshot deletion authority');
  assert.equal(await fs.readFile(markerOnly, 'utf8'), originalMarkerBytes, 'original marker-only negative remains unchanged after positive cleanup');
} finally { await rmDirRecursive(temporary); }
console.log('storage cleanup authority passed');

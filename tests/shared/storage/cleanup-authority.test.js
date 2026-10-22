import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../../src/shared/storage/cleanup.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import os from 'node:os';

const temporary = await makeTempDir('poc-storage-cleanup-');
try {
  const root = path.join(temporary, 'cache');
  const probes = path.join(root, 'tooling', 'command-probes');
  const candidate = path.join(probes, `${'a'.repeat(40)}.json`);
  await fs.mkdir(probes, { recursive: true });
  await fs.writeFile(candidate, JSON.stringify(withGeneratedCacheMetadata({ result: 'derived' }, 'command-probe')));
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
  const applied = await applyStorageCleanupPlan(ready, { authorityRoots: [root], approvedPlanId: ready.planId });
  assert.equal(applied.results[0].status, 'deleted');
  assert.equal(applied.actualReclaimedBytes, null, 'unlink is not physical free-space measurement');
  for (const category of ['triage', 'snapshots', 'diffs', 'builds']) {
    assert.equal(await fs.readFile(path.join(root, 'repos', 'repo-123456789abc', category, 'saved.json'), 'utf8'), 'preserved');
  }
  assert.equal(await fs.readFile(preprocess, 'utf8'), 'source-classification-replay-evidence', 'registration does not grant generic snapshot deletion authority');
} finally { await rmDirRecursive(temporary); }
console.log('storage cleanup authority passed');

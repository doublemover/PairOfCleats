import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../../src/shared/storage/cleanup.js';
import { STORAGE_CLEANUP_PLAN_VERSION } from '../../../src/contracts/schemas/storage-cleanup.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/cleanup-admission-boundaries/')[1];
assert.ok(['pre-cancelled-plan-and-apply', 'deadline-after-authority-stat', 'deadline-before-probe-read',
  'cancel-between-unlinks', 'cancelled-reader-still-closes', 'current-format-and-positive-apply'].includes(mode));
const scope = path.resolve('.tmp/tasks/cleanup-admission'); await fsp.mkdir(scope, { recursive: true });
const root = await fsp.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fsp.writeFile(path.join(root, '.owned-test-fixture'), marker);
const cacheRoot = path.join(root, 'cache'), probes = path.join(cacheRoot, 'tooling', 'command-probes');
const originals = { open: fsp.open, lstat: fsp.lstat, opendir: fsp.opendir, lstatSync: fs.lstatSync,
  openSync: fs.openSync, unlinkSync: fs.unlinkSync, now: Date.now };
const restore = () => { fsp.open = originals.open; fsp.lstat = originals.lstat; fsp.opendir = originals.opendir;
  fs.lstatSync = originals.lstatSync; fs.openSync = originals.openSync; fs.unlinkSync = originals.unlinkSync; Date.now = originals.now; };
const same = (left, right) => typeof left === 'string' && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null }), async () => {
    await fsp.mkdir(probes, { recursive: true });
    await fsp.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
    const producer = path.join(root, 'producer');
    for (const argument of ['a', 'b', 'c']) assert.equal(writePersistentCommandProbeCache({ providerId: 'cleanup-boundary-fixture',
      command: process.execPath, args: [argument], cwd: root, probeEnv: {}, toolingConfig: { cache: { dir: producer } }, attempted: [{ ok: true }] }), true);
    for (const name of await fsp.readdir(path.join(producer, 'command-probes'))) await fsp.copyFile(path.join(producer, 'command-probes', name), path.join(probes, name));
    const files = (await fsp.readdir(probes)).sort().map(name => path.join(probes, name)), bytes = await Promise.all(files.map(file => fsp.readFile(file)));
    assert.equal(files.length, 3);
    const input = { cacheRoot, authorityRoots: [cacheRoot], maxDurationMs: 1000 };
    const apply = (plan, signal) => applyStorageCleanupPlan(plan, { authorityRoots: [cacheRoot], approvedPlanId: plan.planId, signal });
    const originalPlan = await planCacheRootCleanup(input); assert.equal(originalPlan.applyReady, true); assert.equal(originalPlan.operations.length, 3);
    if (mode === 'pre-cancelled-plan-and-apply') {
      const controller = new AbortController(); controller.abort(); let admissions = 0;
      for (const [owner, field] of [[fsp, 'open'], [fsp, 'lstat'], [fsp, 'opendir'], [fs, 'openSync'], [fs, 'lstatSync']]) {
        const method = owner[field]; owner[field] = function (...args) { admissions++; return method.apply(this, args); };
      }
      const plan = await planCacheRootCleanup({ ...input, signal: controller.signal });
      assert.equal(plan.complete, false); assert.equal(plan.applyReady, false); assert.equal(plan.stopReason, 'cancelled'); assert.deepEqual(plan.operations, []);
      const result = await apply(originalPlan, controller.signal);
      assert.equal(result.complete, false); assert.equal(result.mutationPerformed, false); assert.equal(result.stopReason, 'cancelled');
      assert.ok(result.results.every(row => row.status === 'skipped')); assert.equal(admissions, 0);
    } else if (mode === 'deadline-after-authority-stat' || mode === 'deadline-before-probe-read') {
      let clock = 0, candidateStats = 0, laterAdmissions = 0, candidateReads = 0;
      Date.now = () => clock;
      const late = () => { if (clock >= 1000) laterAdmissions++; };
      fsp.open = (...args) => { late(); if (files.some(file => same(args[0], file))) candidateReads++; return originals.open(...args); };
      fsp.opendir = (...args) => { late(); return originals.opendir(...args); };
      fs.lstatSync = (...args) => { late(); return originals.lstatSync(...args); };
      fs.openSync = (...args) => { late(); return originals.openSync(...args); };
      fsp.lstat = async (file, ...args) => {
        late(); const stat = await originals.lstat(file, ...args);
        if (mode === 'deadline-after-authority-stat' && same(file, cacheRoot)
          || mode === 'deadline-before-probe-read' && same(file, files[0]) && ++candidateStats === 2) clock = 1000;
        return stat;
      };
      const plan = await planCacheRootCleanup(input);
      assert.equal(plan.stopReason, 'time-budget'); assert.equal(plan.complete, false); assert.equal(plan.applyReady, false);
      assert.equal(plan.operations.length, 0); assert.equal(candidateReads, 0); assert.equal(laterAdmissions, 0);
    } else if (mode === 'cancel-between-unlinks') {
      const controller = new AbortController(); let deleted = 0, laterCandidates = 0;
      fs.unlinkSync = file => {
        const result = originals.unlinkSync(file);
        if (files.some(candidate => same(file, candidate))) { deleted++; controller.abort(); }
        return result;
      };
      fsp.open = (...args) => { if (controller.signal.aborted && files.some(file => same(args[0], file))) laterCandidates++; return originals.open(...args); };
      const result = await apply(originalPlan, controller.signal);
      assert.equal(result.complete, false); assert.equal(result.stopReason, 'cancelled'); assert.equal(result.mutationPerformed, true);
      assert.equal(result.results.filter(row => row.status === 'deleted').length, 1); assert.equal(deleted, 1); assert.equal(laterCandidates, 0);
      assert.equal(result.results.filter(row => row.status === 'skipped').length, 2); assert.equal(result.actualReclaimedBytes, null);
      restore();
      for (const [index, file] of files.entries()) {
        if (index === 0) await assert.rejects(fsp.stat(file), { code: 'ENOENT' }); else assert.deepEqual(await fsp.readFile(file), bytes[index]);
      }
    } else if (mode === 'cancelled-reader-still-closes') {
      const controller = new AbortController(); let opened = 0, closed = 0;
      fsp.open = async (...args) => {
        const handle = await originals.open(...args);
        if (files.some(file => same(args[0], file))) {
          opened++; const close = handle.close;
          handle.close = function (...args) { closed++; return close.apply(this, args); }; controller.abort();
        }
        return handle;
      };
      const result = await apply(originalPlan, controller.signal);
      assert.equal(result.complete, false); assert.equal(result.mutationPerformed, false); assert.equal(opened, 1); assert.equal(closed, 1);
      assert.ok(result.results.every(row => row.status !== 'deleted')); assert.equal(result.stopReason, 'cancelled');
      restore(); for (const [index, file] of files.entries()) assert.deepEqual(await fsp.readFile(file), bytes[index]);
    } else {
      assert.equal(originalPlan.schemaVersion, STORAGE_CLEANUP_PLAN_VERSION); assert.equal(originalPlan.stopReason, null);
      await assert.rejects(apply({ ...originalPlan, schemaVersion: STORAGE_CLEANUP_PLAN_VERSION - 1 }));
      for (const maxEntries of [0, 100001, Infinity, 1.5]) await assert.rejects(planCacheRootCleanup({ ...input, maxEntries }), TypeError);
      const result = await apply(originalPlan);
      assert.equal(result.complete, true); assert.equal(result.stopReason, null); assert.equal(result.results.filter(row => row.status === 'deleted').length, 3);
      assert.equal(result.deletedLogicalBytes, bytes.reduce((sum, buffer) => sum + buffer.length, 0)); assert.equal(result.actualReclaimedBytes, null);
    }
    restore();
  });
} finally {
  restore();
  const physicalScope = await fsp.realpath(scope), physicalRoot = await fsp.realpath(root);
  assert.ok(isPathWithinRoot(physicalRoot, physicalScope) && physicalRoot !== physicalScope);
  assert.equal(await fsp.readFile(path.join(physicalRoot, '.owned-test-fixture'), 'utf8'), marker);
  await fsp.rm(physicalRoot, { recursive: true, force: true });
}
console.log('Cleanup bounds cover original authority, ownership, qualification and unlink admission while opened readers still close.');

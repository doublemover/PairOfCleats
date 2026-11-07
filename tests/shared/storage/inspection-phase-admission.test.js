import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { inspectStorageLayout, diagnoseStorageLayout } from '../../../src/shared/storage/operator.js';
import { createStorageInspectionAdmission } from '../../../src/shared/storage/inspection-admission.js';
import { withStorageDirectory, getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { planStorageProbePolicy, applyStorageProbePolicy } from '../../../src/shared/storage/probe-policy.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/inspection-phase-admission/')[1];
const scope = path.resolve('.tmp/tasks/storage-inspection-admission'); await fsp.mkdir(scope, { recursive: true });
const temporary = await fsp.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fsp.writeFile(path.join(temporary, '.owned-fixture'), marker);
const home = path.join(temporary, 'home'), layout = resolveStorageLayout({ home, env: {} }), cache = layout.descriptors.cache.path;
for (const descriptor of Object.values(layout.descriptors)) await fsp.mkdir(descriptor.path, { recursive: true });
await fsp.writeFile(path.join(cache, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
const original = { lstat: fsp.lstat, realpath: fsp.realpath, open: fsp.open, opendir: fsp.opendir,
  openSync: fs.openSync, lstatSync: fs.lstatSync, now: Date.now };
const same = (a, b) => typeof a === 'string' && path.resolve(a) === path.resolve(b);
const restore = () => { fsp.lstat = original.lstat; fsp.realpath = original.realpath; fsp.open = original.open; fsp.opendir = original.opendir;
  fs.openSync = original.openSync; fs.lstatSync = original.lstatSync; Date.now = original.now; };
let lease = null, retainedDirectory = null, permitClose = false;
try {
  if (mode === 'pre-cancelled-diagnosis') {
    const controller = new AbortController(); controller.abort(null); let admissions = 0;
    for (const [owner, field] of [[fsp, 'lstat'], [fsp, 'realpath'], [fsp, 'open'], [fsp, 'opendir'], [fs, 'openSync'], [fs, 'lstatSync']]) {
      const method = owner[field]; owner[field] = (...args) => { admissions++; return method(...args); };
    }
    const result = await diagnoseStorageLayout(layout, { signal: controller.signal });
    assert.equal(admissions, 0); assert.equal(result.inventory.cancelled, true); assert.equal(result.leaseStopReason, 'cancelled');
    assert.equal(result.commandProbePolicy, null); assert.equal(result.commandProbePolicyInspected, false);
    assert.equal(result.leaseInspectionComplete, false); assert.equal(result.inventory.items.length, Object.keys(layout.descriptors).length);
    assert.ok(result.inventory.items.every(item => item.status === 'unscanned' && item.logicalBytes === null));
  } else if (['deadline-after-root-stat', 'deadline-after-realpath', 'deadline-before-volume-fallback'].includes(mode)) {
    let clock = 0, laterAdmissions = 0, markerReads = 0; Date.now = () => clock;
    const late = () => { if (clock >= 1000) laterAdmissions++; };
    const absent = path.join(temporary, 'absent');
    fsp.lstat = async (...args) => { late(); const value = await original.lstat(...args);
      if (mode === 'deadline-after-root-stat' && same(args[0], cache)) clock = 1000; return value; };
    fsp.realpath = async (...args) => { late(); const value = await original.realpath(...args);
      if (mode === 'deadline-after-realpath' && same(args[0], cache)) clock = 1000; return value; };
    fsp.open = (...args) => { late(); markerReads++; return original.open(...args); };
    fs.lstatSync = (...args) => {
      late(); try { return original.lstatSync(...args); }
      catch (error) { if (mode === 'deadline-before-volume-fallback' && same(args[0], absent)) clock = 1000; throw error; }
    };
    const result = await inspectStorageLayout(layout, { category: 'cache', maxDurationMs: 1000,
      ...(mode === 'deadline-before-volume-fallback' ? { extraRoots: [{ id: 'absent', category: 'cache', path: absent }] } : {}) });
    assert.equal(result.stopReason, 'time-budget'); assert.equal(laterAdmissions, 0);
    assert.equal(result.items.at(-1).status, 'unscanned'); assert.equal(result.items.at(-1).logicalBytes, null);
    if (mode !== 'deadline-before-volume-fallback') assert.equal(markerReads, 0);
  } else if (mode === 'deadline-between-policy-files') {
    const plan = await planStorageProbePolicy({ home, patch: { entryLimit: 1 } });
    const selected = await applyStorageProbePolicy(plan, { approvedPlanId: plan.planId, home, category: 'command-probes' });
    assert.equal(selected.complete, true);
    let clock = 0, laterReads = 0; Date.now = () => clock;
    const policyFile = path.join(home, 'config', 'storage-policies.json');
    fs.openSync = (...args) => { if (clock >= 1000) laterReads++; const descriptor = original.openSync(...args);
      if (same(args[0], policyFile)) clock = 1000; return descriptor; };
    const result = await diagnoseStorageLayout(layout, { maxDurationMs: 1000 });
    assert.equal(result.leaseStopReason, 'time-budget'); assert.equal(result.commandProbePolicyInspected, false);
    assert.equal(laterReads, 0, 'the immutable selection receipt is not admitted after the locator exhausts the budget');
    assert.equal(result.leaseInventory.length, 0);
  } else if (mode === 'deadline-in-original-lease-reader') {
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    lease = acquireRepoCacheAccessLease(cache, { coordinationRoot });
    const paths = repoAccessPaths(cache, { coordinationRoot }); let clock = 0, actualCloses = 0, laterReads = 0; Date.now = () => clock;
    fsp.open = (...args) => { if (clock >= 1000) laterReads++; return original.open(...args); };
    fsp.opendir = async (...args) => {
      const directory = await original.opendir(...args);
      if (same(args[0], paths.leases)) {
        const read = directory.read.bind(directory), close = directory.close.bind(directory);
        directory.read = async () => { const value = await read(); clock = 1000; return value; };
        directory.close = async () => { const value = await close(); actualCloses++; return value; };
      }
      return directory;
    };
    const result = await diagnoseStorageLayout(layout, { maxDurationMs: 1000 });
    assert.equal(result.leaseStopReason, 'time-budget'); assert.equal(result.leaseInspectionComplete, false);
    assert.equal(actualCloses, 1, 'the original admitted directory closes despite the stopped enumeration'); assert.equal(laterReads, 0);
    assert.ok(result.inventory.lifecycle.roots.every(item => !item.cleanupEligible));
  } else if (mode === 'pending-original-close-over-stop') {
    const admission = createStorageInspectionAdmission(1000), closeFailure = new Error('original native close refused');
    let attempts = 0, actualCloses = 0;
    fsp.opendir = async (...args) => {
      const directory = await original.opendir(...args), close = directory.close.bind(directory);
      directory.close = async () => { attempts++; if (!permitClose) throw closeFailure; const value = await close(); actualCloses++; return value; };
      return directory;
    };
    let failure;
    await assert.rejects(withStorageDirectory(cache, async () => admission.stopFor('time-budget')), error => { failure = error; return true; });
    assert.equal(failure, admission.stop, 'the real directory owner can decorate the exact primary stop');
    retainedDirectory = getStorageDirectorySession(failure); assert.ok(retainedDirectory); assert.equal(retainedDirectory.isSettled(), false);
    assert.throws(() => admission.isStop(failure), error => error.cacheOwnershipPending === true, 'pending close cannot be demoted to an ordinary stopped report');
    assert.equal(actualCloses, 0); permitClose = true;
    assert.equal((await retainedDirectory.releaseAfterClose()).settled, true); assert.equal(actualCloses, 1); assert.equal(attempts, 2);
    assert.equal(admission.isStop(failure), true, 'only actual original close settlement permits stop classification');
    retainedDirectory = null;
  } else if (mode === 'exact-stop-observation') {
    const admission = createStorageInspectionAdmission(1000); let failure;
    try { admission.stopFor('time-budget'); } catch (error) { failure = error; }
    assert.equal(admission.isStop(failure), true); assert.equal(admission.reason, 'time-budget');
    assert.equal(admission.isStop(new Error(failure.message)), false); assert.equal(admission.isStop({ ...failure }), false);
    assert.throws(() => createStorageInspectionAdmission(0));
    const observed = await diagnoseStorageLayout(layout);
    assert.equal(observed.commandProbePolicyInspected, true); assert.equal(observed.commandProbePolicy.status, 'missing');
    assert.equal(observed.leaseInspectionComplete, true);
  } else throw new Error('Unknown storage inspection admission case: ' + mode);
} finally {
  restore(); permitClose = true; if (retainedDirectory) await retainedDirectory.releaseAfterClose(); lease?.release();
  assertNoSymlinkPath(path.parse(temporary).root, temporary);
  const physicalScope = await fsp.realpath(scope), physicalTemporary = await fsp.realpath(temporary);
  assert.ok(isPathWithinRoot(physicalTemporary, physicalScope) && path.dirname(physicalTemporary) === physicalScope);
  assert.equal(await fsp.readFile(path.join(physicalTemporary, '.owned-fixture'), 'utf8'), marker);
  await fsp.rm(physicalTemporary, { recursive: true, force: false });
}
console.log('Storage diagnosis stops later admissions while retaining actual pending resource owners: ' + mode);

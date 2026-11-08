import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { inspectStorageLayout, diagnoseStorageLayout } from '../../../src/shared/storage/operator.js';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';
import { createStorageInspectionAdmission } from '../../../src/shared/storage/inspection-admission.js';
import { withStorageDirectory, getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { planStoragePolicy, applyStoragePolicy } from '../../../src/shared/storage/probe-policy.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { inspectStorageCategory } from '../../../tools/storage/category-inventory.js';
import { inspectManagedStorageReceipts } from '../../../tools/storage/managed-receipt-inventory.js';
import { inspectDictionaryStorage } from '../../../src/shared/storage/dictionary-adapter.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

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
    const empty = await inspectStorageInventory({ roots: [], signal: controller.signal });
    assert.equal(empty.complete, false); assert.equal(empty.stopReason, 'cancelled'); assert.equal(admissions, 0);
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
  } else if (['deadline-between-policy-files', 'category-policy-deadline'].includes(mode)) {
    const plan = await planStoragePolicy({ home, patch: { entryLimit: 1 } });
    const selected = await applyStoragePolicy(plan, { approvedPlanId: plan.planId, home, category: 'command-probes' });
    assert.equal(selected.complete, true);
    let clock = 0, laterReads = 0; Date.now = () => clock;
    const policyFile = path.join(home, 'config', 'storage-policies.json');
    fs.openSync = (...args) => { if (clock >= 1000) laterReads++; const descriptor = original.openSync(...args);
      if (same(args[0], policyFile)) clock = 1000; return descriptor; };
    const result = mode === 'category-policy-deadline'
      ? await inspectStorageCategory({ category: 'command-probes', root: cache, home, maxDurationMs: 1000 })
      : await diagnoseStorageLayout(layout, { maxDurationMs: 1000 });
    if (mode === 'category-policy-deadline') {
      assert.equal(result.stopReason, 'time-budget'); assert.equal(result.policyInspected, false);
      assert.equal(result.policy, null); assert.equal(result.lease, null);
    } else {
      assert.equal(result.leaseStopReason, 'time-budget'); assert.equal(result.commandProbePolicyInspected, false);
      assert.equal(result.leaseInventory.length, 0);
    }
    assert.equal(laterReads, 0, 'the immutable selection receipt is not admitted after the locator exhausts the budget');
  } else if (['deadline-in-original-lease-reader', 'category-original-lease-deadline', 'managed-original-lease-deadline'].includes(mode)) {
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
    const result = mode === 'category-original-lease-deadline'
      ? await inspectStorageCategory({ category: 'dictionaries', root: cache, home, maxDurationMs: 1000 })
      : mode === 'managed-original-lease-deadline'
        ? await inspectManagedStorageReceipts({ root: cache, home, maxDurationMs: 1000 })
        : await diagnoseStorageLayout(layout, { maxDurationMs: 1000 });
    if (mode === 'deadline-in-original-lease-reader') {
      assert.equal(result.leaseStopReason, 'time-budget'); assert.equal(result.leaseInspectionComplete, false);
      assert.ok(result.inventory.lifecycle.roots.every(item => !item.cleanupEligible));
    } else {
      assert.equal(result.stopReason, 'time-budget'); assert.equal(result.complete, false);
      assert.equal(result.lease.complete, false); assert.equal(result.lease.protected, true, 'the interrupted original lease observation remains explicit and unknown');
    }
    assert.equal(actualCloses, 1, 'the original admitted directory closes despite the stopped enumeration'); assert.equal(laterReads, 0);
  } else if (mode === 'dictionary-manifest-deadline') {
    const manifest = path.join(cache, 'dictionaries.json');
    await fsp.writeFile(manifest, '{}'); await fsp.writeFile(path.join(cache, 'words.txt'), 'word\n');
    let clock = 0, actualCloses = 0, laterOpens = 0, manifestOpens = 0; Date.now = () => clock;
    fsp.open = async (...args) => {
      if (clock >= 1000) laterOpens++;
      const handle = await original.open(...args);
      if (same(args[0], manifest)) {
        manifestOpens++; clock = 1000;
        const close = handle.close.bind(handle); handle.close = async () => { await close(); actualCloses++; };
      }
      return handle;
    };
    await assert.rejects(() => inspectDictionaryStorage({ root: cache, maxDurationMs: 1000 }), /Storage inspection admission stopped/);
    assert.equal(manifestOpens, 1); assert.equal(actualCloses, 1, 'the admitted original manifest descriptor still closes');
    assert.equal(laterOpens, 0, 'dictionary hashes/marker reads are not admitted after manifest exhaustion');
  } else if (['exact-root-deadline', 'exact-directory-close', 'exact-revalidation-deadline'].includes(mode)) {
    let clock = 0, rootStats = 0, laterAdmissions = 0, opens = 0, closes = 0;
    const late = () => { if (clock >= 1000) laterAdmissions++; };
    Date.now = () => clock;
    fsp.lstat = async (...args) => {
      late(); const value = await original.lstat(...args);
      if (args[1]?.bigint === true && same(args[0], cache)) {
        rootStats++;
        if (mode === 'exact-root-deadline' && rootStats === 1 || mode === 'exact-revalidation-deadline' && rootStats === 3) clock = 1000;
      }
      return value;
    };
    fsp.open = (...args) => { late(); opens++; return original.open(...args); };
    fsp.opendir = async (...args) => {
      late(); const directory = await original.opendir(...args), read = directory.read.bind(directory), close = directory.close.bind(directory);
      directory.read = async () => { late(); const value = await read(); if (mode === 'exact-directory-close') clock = 1000; return value; };
      directory.close = async () => { const value = await close(); closes++; return value; };
      return directory;
    };
    const result = await inspectStorageInventory({ roots: [{ id: 'cache', category: 'cache', path: cache },
      { id: 'next', category: 'cache', path: home }], includeFiles: true, maxDurationMs: 1000 });
    assert.equal(result.complete, false); assert.equal(result.stopReason, 'time-budget'); assert.equal(laterAdmissions, 0);
    assert.equal(result.items[1].status, 'unscanned'); assert.equal(result.items[1].logicalBytes, null);
    assert.equal(result.totals.uniqueLogicalBytes, null);
    if (mode === 'exact-root-deadline') { assert.equal(opens, 0); assert.equal(closes, 0); assert.equal(result.items[0].logicalBytes, null); }
    else if (mode === 'exact-directory-close') assert.equal(closes, 1, 'the exact scanner still closes the original directory after its read exhausts time');
    else assert.equal(rootStats, 3, 'expiry on final directory revalidation cannot mark the scan complete');
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
    assert.equal(errorGraphIncludes(failure, admission.stop), true, 'the real directory owner retains the exact primary stop in its aggregate');
    retainedDirectory = getStorageDirectorySession(failure); assert.ok(retainedDirectory); assert.equal(retainedDirectory.isSettled(), false);
    assert.equal(admission.isStop(failure), false, 'a distinct cleanup aggregate cannot masquerade as the exact invocation stop');
    assert.throws(() => describeStorageFailure(failure), error => error.cacheOwnershipPending === true, 'pending close cannot be demoted to an ordinary diagnostic');
    assert.equal(actualCloses, 0); permitClose = true;
    assert.equal((await retainedDirectory.releaseAfterClose()).settled, true); assert.equal(actualCloses, 1); assert.equal(attempts, 2);
    assert.equal(admission.isStop(failure), false, 'metadata recovery does not relabel the failed invocation as its original plain stop');
    assert.equal(describeStorageFailure(failure).message, admission.stop.message, 'the settled aggregate can now be projected without losing the original stop');
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

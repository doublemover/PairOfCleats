import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readStorageLocator } from '../../../src/shared/storage/locator-read.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { getStorageCategorySelection } from '../../../src/shared/cache-roots.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { isStorageObservationFailure } from '../../../src/shared/storage/failure-observation.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual disposable locator/configuration producers and routing
// consumers. No child launch, install, physical link or real user cache mutation.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-locator-resource-failure-');
const originalOpen = fs.openSync, originalClose = fs.closeSync;
const disposal = new Set();
try {
  const home = path.join(root, 'home'), selected = path.join(root, 'selected-tmp');
  await fsp.mkdir(path.join(home, 'config'), { recursive: true });
  const layout = resolveStorageLayout({ home, env: {} });
  const plan = await planStorageConfiguration({ layout, category: 'tmp', target: selected });
  const applied = await applyStorageConfiguration(plan, { approvedPlanId: plan.planId, home, category: 'tmp', target: selected });
  const locator = applied.configFile, receipt = applied.receiptFile;
  const locatorBytes = await fsp.readFile(locator), receiptBytes = await fsp.readFile(receipt);
  const env = { PAIROFCLEATS_HOME: home };
  const childInput = { layout, baseEnv: {}, command: 'npm', managed: true, toolId: 'fixture', toolIdentity: 'fixture-v1', runId: 'source-control', cwd: root };
  const consumers = [
    () => readStorageLocator(home),
    () => getStorageCategorySelection('tmp', { env }),
    () => planManagedChildStorage(childInput),
    () => planStorageConfiguration({ layout, category: 'tmp', target: path.join(root, 'next-tmp'), currentPath: selected, currentSource: 'locator.categories.tmp' })
  ];
  assert.equal(readStorageLocator(home).status, 'present');
  assert.equal(getStorageCategorySelection('tmp', { env }), selected);
  assert.ok(planManagedChildStorage(childInput).scratch.startsWith(path.join(selected, 'managed-children') + path.sep));
  for (const file of [locator, receipt]) {
    for (const value of [undefined, null, false, 0, '']) {
      fs.openSync = (target, ...args) => { if (target === file) throw value; return originalOpen(target, ...args); };
      const report = readStorageLocator(home);
      assert.equal(report.status, 'invalid'); assert.equal(report.error.code, 'ERR_STORAGE_LOCATOR');
      assert.equal(report.error.message, String(value)); fs.openSync = originalOpen;
    }
    for (const marker of [undefined, false, true]) {
      for (const consume of consumers) {
        let settled = false, codeReads = 0;
        const primary = Object.defineProperties(new Error('original storage locator read owns native work'), {
          ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
          cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
          code: { get() { codeReads += 1; return 'ENOENT'; } }
        });
        fs.openSync = (target, ...args) => { if (target === file) throw primary; return originalOpen(target, ...args); };
        const failure = await rejected(consume);
        assert.equal(contains(failure, primary), true); assert.equal(isStorageObservationFailure(failure), true);
        assert.equal(codeReads, 0, 'unknown original work cannot become missing locator/default routing');
        primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
        settled = true; assert.equal(failure.cacheOwnershipReleased(), true); fs.openSync = originalOpen;
      }
    }
    for (const consume of consumers) {
      let settled = false;
      const inspection = Object.assign(new Error('independent locator code inspection still owns work'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
      });
      const primary = Object.freeze(Object.defineProperty(new Error('original readonly locator code'), 'code', {
        get() { assert.equal(this, primary); throw inspection; }
      }));
      fs.openSync = (target, ...args) => { if (target === file) throw primary; return originalOpen(target, ...args); };
      const failure = await rejected(consume);
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, inspection), true);
      inspection.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true; assert.equal(failure.cacheOwnershipReleased(), true); fs.openSync = originalOpen;
    }
    for (const consume of consumers) {
      let fd, closes = 0;
      const secondary = Object.freeze(new Error('actual locator/receipt descriptor close remains unconfirmed'));
      fs.openSync = (target, ...args) => {
        const actual = originalOpen(target, ...args); if (target === file) { fd = actual; disposal.add(actual); } return actual;
      };
      fs.closeSync = actual => { if (actual === fd) { closes += 1; throw secondary; } return originalClose(actual); };
      const failure = await rejected(consume), session = getContainedFileSession(failure);
      assert.ok(session); assert.equal(contains(failure, secondary), true); assert.equal(closes, 1);
      await rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
      originalClose(fd); disposal.delete(fd); assert.equal(session.isSettled(), false);
      fs.openSync = originalOpen; fs.closeSync = originalClose;
    }
  }
  await fsp.unlink(receipt);
  assert.equal(readStorageLocator(home).status, 'invalid', 'missing selected receipt cannot turn an already read locator into defaults');
  await fsp.writeFile(receipt, receiptBytes);
  await fsp.unlink(locator);
  assert.equal(readStorageLocator(home).status, 'missing');
  assert.equal(getStorageCategorySelection('tmp', { env }), null);
  await fsp.writeFile(locator, locatorBytes);
  assert.deepEqual(await fsp.readFile(locator), locatorBytes); assert.deepEqual(await fsp.readFile(receipt), receiptBytes);
  await assert.rejects(fsp.lstat(selected), { code: 'ENOENT' }, 'planning/report failures do not prepare a selected category');
} finally {
  fs.openSync = originalOpen; fs.closeSync = originalClose;
  for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('locator-resource-failure-observation passed');

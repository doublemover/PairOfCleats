// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { loadDictionaryWordSetFromFiles } from '../../../src/shared/dictionary-wordlists.js';
import { registerDictionaryStorageRoot, dictionaryStorageCoordinationRoot } from '../../../src/shared/storage/dictionary-access.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const root = await makeTempDir('dictionary-secondary-failures-');
const originalCreate = fsSync.createReadStream;
const originalOpen = fs.open;
const retained = [];
const retainsPrimary = (error, primary) => {
  const seen = new Set();
  for (let value = error; value && typeof value === 'object' && !seen.has(value); value = value.cause) {
    if (value === primary) return true; seen.add(value);
  }
  return false;
};
const findDescriptorOwner = error => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (!value || typeof value !== 'object' || seen.has(value)) continue; seen.add(value);
    const owner = getContainedFileSession(value); if (owner) return owner;
    pending.push(value.cause, ...(Array.isArray(value.errors) ? value.errors : []),
      ...(Array.isArray(value.dictionaryCleanupErrors) ? value.dictionaryCleanupErrors : []),
      ...(Array.isArray(value.dictionarySiblingFailures) ? value.dictionarySiblingFailures : []));
  }
  return null;
};
const findAccess = error => {
  if (error.dictionaryStorageAccess) return error.dictionaryStorageAccess;
  for (const nested of [...(Array.isArray(error.dictionaryCleanupErrors) ? error.dictionaryCleanupErrors : []),
    ...(Array.isArray(error.dictionarySiblingFailures) ? error.dictionarySiblingFailures : [])]) {
    const access = findAccess(nested);
    if (access) return access;
  }
  return null;
};
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TESTING: '1' }, async () => {
    const dictionary = path.join(root, 'dictionary');
    const blocked = path.join(root, 'blocked');
    await fs.mkdir(dictionary); await fs.mkdir(blocked);
    const file = path.join(dictionary, 'fixture.txt');
    const blockedFile = path.join(blocked, 'blocked.txt');
    await fs.writeFile(file, 'alpha\nbeta\n');
    await fs.writeFile(blockedFile, 'not admitted\n');
    registerDictionaryStorageRoot(dictionary); registerDictionaryStorageRoot(blocked);
    const coordinationRoot = dictionaryStorageCoordinationRoot();
    let nativeCloseObserved = false, selectedHandle = null;
    fs.open = async (selected, ...args) => {
      const handle = await originalOpen.call(fs, selected, ...args);
      if (selected === file) selectedHandle = handle;
      return handle;
    };
    let readFailure = null;
    let frozenAdmission = null;
    fsSync.createReadStream = (...args) => {
      if (frozenAdmission && args[0] === blockedFile) throw frozenAdmission;
      const stream = originalCreate(...args);
      if (readFailure) stream.once('open', () => stream.destroy(readFailure));
      stream.once('close', () => {
        nativeCloseObserved = true;
        // Inject the ambiguous close diagnostic on a real fixture stream.
        // Production must retain ownership; fixture cleanup separately knows
        // this descriptor did close and can release its retained metadata.
        stream.emit('error', Object.assign(new Error('inert native close ambiguity'), { code: 'EIO', syscall: 'close' }));
      });
      return stream;
    };
    await withExclusiveRepoCacheCleanup(blocked, async () => {
      let primary;
      await assert.rejects(loadDictionaryWordSetFromFiles([blockedFile, file]), error => {
        primary = error;
        return error.code === 'ERR_REPO_CACHE_CLEANUP_BUSY' && error.cacheOwnershipPending === true;
      });
      assert.equal(nativeCloseObserved, true);
      assert.ok(primary.dictionarySiblingFailures.length > 0, 'first denied admission retains the later pending-close failure');
      assert.equal((await inspectStorageAccess(dictionary, { coordinationRoot })).protected, true);
      const access = findAccess(primary);
      assert.ok(access, 'the actual retained sibling owner remains reachable from the primary failure');
      retained.push(access);
      access.releaseAfterClosure(); retained.pop();
    }, { coordinationRoot });

    nativeCloseObserved = false;
    readFailure = Object.assign(new Error('inert primary dictionary read failure'), {
      code: 'EIO', syscall: 'read', cacheOwnershipReleased: () => true
    });
    let primary;
    await assert.rejects(loadDictionaryWordSetFromFiles([file]), error => {
      primary = error;
      return retainsPrimary(error, readFailure) && error.cacheOwnershipPending === true;
    });
    assert.equal(nativeCloseObserved, true);
    assert.equal(selectedHandle.fd, -1, 'the original descriptor actually closed, separately from ReadStream close notification');
    assert.ok(primary.dictionaryCleanupErrors.length > 0, 'close cleanup does not replace the original read failure');
    assert.equal(primary.cacheOwnershipReleased(), false, 'a primary confirmed observer cannot settle an unconfirmed cleanup owner');
    const access = findAccess(primary);
    assert.ok(access);
    retained.push(access);
    access.releaseAfterClosure(); retained.pop();
    assert.equal((await inspectStorageAccess(dictionary, { coordinationRoot })).protected, false);

    readFailure = null;
    frozenAdmission = Object.freeze(Object.assign(new Error('inert frozen primary admission'), {
      code: 'ERR_DICTIONARY_STORAGE_FIXTURE_BUSY', dictionarySiblingFailures: 'legacy readonly diagnostic', cacheOwnershipReleased: () => true
    }));
    let aggregated;
    await assert.rejects(loadDictionaryWordSetFromFiles([blockedFile, file]), error => {
      aggregated = error;
      return error instanceof AggregateError && retainsPrimary(error, frozenAdmission)
        && error.cacheOwnershipPending === true && error.code === frozenAdmission.code;
    });
    assert.equal(aggregated.dictionarySiblingFailures.length, 1, 'nonarray readonly diagnostics cannot be spread as a failure list');
    assert.equal(frozenAdmission.dictionarySiblingFailures, 'legacy readonly diagnostic');
    assert.equal(aggregated.cacheOwnershipReleased(), false, 'frozen fallback composes the primary observer with the missing pending sibling observer');
    const frozenAccess = findAccess(aggregated);
    assert.ok(frozenAccess, 'frozen primary fallback retains the actual pending sibling handle');
    retained.push(frozenAccess);
    frozenAccess.releaseAfterClosure(); retained.pop();

    frozenAdmission = null;
    let inspectionReady = false;
    const inspectionFailure = new Error('inert throwing primary observer');
    readFailure = Object.freeze(Object.assign(new Error('inert frozen primary read'), {
      code: 'EIO', syscall: 'read', dictionaryCleanupErrors: 'legacy readonly cleanup diagnostic',
      cacheOwnershipReleased: () => { if (!inspectionReady) throw inspectionFailure; return true; }
    }));
    await assert.rejects(loadDictionaryWordSetFromFiles([file]), error => {
      aggregated = error;
      return error instanceof AggregateError && retainsPrimary(error, readFailure)
        && error.cacheOwnershipPending === true;
    });
    assert.equal(aggregated.dictionaryCleanupErrors.length, 1, 'metadata close receipt remains a separate diagnostic from the original descriptor failure graph');
    assert.equal(aggregated.cacheOwnershipReleased(), false, 'throwing closure observers remain unconfirmed');
    const frozenReadAccess = findAccess(aggregated);
    assert.ok(frozenReadAccess);
    retained.push(frozenReadAccess);
    assert.throws(() => frozenReadAccess.releaseAfterClosure(), 'metadata release cannot bypass independently pending native closure');
    assert.ok(selectedHandle.fd >= 0, 'a ReadStream close notification cannot stand in for the blocked original descriptor');
    const originalOwner = findDescriptorOwner(aggregated); assert.ok(originalOwner, 'the exact original native close owner remains reachable');
    inspectionReady = true;
    await originalOwner.releaseAfterClose(); assert.equal(selectedHandle.fd, -1);
    frozenReadAccess.releaseAfterClosure(); retained.pop();

    let firstClosed = true, secondClosed = false;
    const firstPending = Object.assign(new Error('inert first pending owner'), { code: 'ERR_DICTIONARY_STORAGE_FIXTURE_FIRST',
      cacheOwnershipPending: true, cacheOwnershipReleased: () => firstClosed });
    const secondPending = Object.assign(new Error('inert second pending owner'), { code: 'ERR_DICTIONARY_STORAGE_FIXTURE_SECOND',
      cacheOwnershipPending: true, cacheOwnershipReleased: () => secondClosed });
    fsSync.createReadStream = filePath => { throw filePath === blockedFile ? firstPending : secondPending; };
    let combined;
    await assert.rejects(loadDictionaryWordSetFromFiles([blockedFile, file]), error => { combined = error; return retainsPrimary(error, firstPending); });
    assert.equal(combined.cacheOwnershipReleased(), false);
    const combinedAccess = findAccess(combined); assert.ok(combinedAccess); retained.push(combinedAccess);
    assert.throws(() => combinedAccess.releaseAfterClosure(), 'an unsettled original callback still protects metadata');
    secondClosed = true;
    assert.equal(combined.cacheOwnershipReleased(), false, 'native settlement alone cannot report retained metadata as released');
    combinedAccess.releaseAfterClosure(); retained.pop();
    assert.equal(combined.cacheOwnershipReleased(), true, 'composed observation captures the original primary function without self-recursion');
    firstClosed = false;
    assert.equal(combined.cacheOwnershipReleased(), false, 'every captured pending owner remains required');
  });
} finally {
  fsSync.createReadStream = originalCreate;
  fs.open = originalOpen;
  for (const access of retained) access.releaseAfterClosure();
  await rmDirRecursive(root);
}
console.log('Dictionary primary failures preserve pending sibling/cleanup ownership evidence.');

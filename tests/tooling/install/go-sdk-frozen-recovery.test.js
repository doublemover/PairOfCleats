import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { ensureManagedGoSdk, probeInstalledSdk } from '../../../tools/tooling/install-go-sdk.js';
import { GO_RELEASE_INDEX_URL, resolveManagedGoSdk } from '../../../src/shared/managed-go.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual SDK/staging/storage owners; every download/probe is inert.
const temporary = await makeTempDir('poc-go-sdk-frozen-recovery-');
const contains = (error, primary) => {
  const pending = [error], seen = new Set();
  while (pending.length) { const current = pending.pop(); if (current === primary) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue; seen.add(current);
    pending.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : [])); }
  return false;
};
try {
  const prelaunch = Object.freeze(Object.assign(new Error('frozen Go prelaunch failed'), { code: 'EIO' }));
  await assert.rejects(probeInstalledSdk('inert-fixture', { resourceId: 'prelaunch-fixture' }, {
    spawn: async () => { throw prelaunch; }
  }), error => contains(error, prelaunch) && error.settlement.resourceId === 'prelaunch-fixture'
    && error.settlement.settled === true && error.settlement.pending === false);
  const child = new EventEmitter();
  const delayed = Object.freeze(Object.assign(new Error('frozen Go close is delayed'), {
    result: { termination: { closeObserved: false, treeCleanupSettled: true, treeCleanupFailed: false } }
  }));
  let delayedFailure;
  try { await probeInstalledSdk('inert-fixture', { resourceId: 'delayed-fixture' }, {
    spawn: async (_command, _args, options) => { options.onSpawn(child); throw delayed; }
  }); } catch (error) { delayedFailure = error; }
  assert.equal(contains(delayedFailure, delayed), true);
  assert.equal(delayedFailure.cacheOwnershipReleased(), false);
  child.emit('close');
  assert.equal(delayedFailure.cacheOwnershipReleased(), true, 'the exact child close plus existing tree evidence changes the original observer');
  for (const known of [true, false]) {
    let confirmed = false;
    const native = Object.freeze(Object.assign(new Error('frozen independent native probe owner'), {
      cacheOwnershipPending: true,
      ...(known ? { cacheOwnershipReleased() { return this === native && confirmed; } } : {}),
      result: { termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } }
    }));
    let failure;
    const child = new EventEmitter();
    try { await probeInstalledSdk('inert-fixture', { resourceId: `independent-${known}` }, {
      spawn: async (_command, _args, options) => { options.onSpawn(child); throw native; }
    }); } catch (error) { failure = error; }
    child.emit('close');
    assert.equal(failure.cacheOwnershipReleased(), false, 'direct close and typed flags cannot override the independent original observer');
    confirmed = true;
    assert.equal(failure.cacheOwnershipReleased(), known);
  }

  const home = path.join(temporary, 'home'), coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
    const version = 'go1.27.1', archive = Buffer.from('inert Go SDK fixture archive');
    const filename = `${version}.windows-amd64.zip`;
    const releases = [{ stable: true, version, files: [{ filename, version, os: 'windows', arch: 'amd64', kind: 'archive',
      size: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }] }];
    const dependencies = {
      download: async ({ url }) => ({ sourceUrl: url, body: url === GO_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(releases)) : archive }),
      extract: async (_archive, destination) => {
        for (const relative of ['go/bin/go.exe', 'go/bin/gofmt.exe', 'go/pkg/tool/windows_amd64/compile.exe', 'go/src/runtime/runtime.go']) {
          const file = path.join(destination, relative); await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, 'inert SDK fixture file');
        }
        await fs.writeFile(path.join(destination, 'go', 'VERSION'), version);
      },
      probe: async (_command, { resourceId }) => ({ ok: true, stdout: `go version ${version} windows/amd64`,
        settlement: { resourceId, settled: true, pending: false } })
    };
    const input = root => ({ toolingRoot: root, cwd: temporary, baseEnv: {}, platform: 'win32', arch: 'x64',
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] }, dependencies });
    const inspect = root => inspectStorageAccess(root, { coordinationRoot });
    const pendingRoot = path.join(temporary, 'pending');
    let closed = false, primary, failure;
    try { await ensureManagedGoSdk({ ...input(pendingRoot), dependencies: { ...dependencies, probe: async (_command, { resourceId }) => {
      primary = Object.freeze(Object.assign(new Error('frozen Go native owner remains pending'), { code: 'EIO', cacheOwnershipPending: true,
        cacheOwnershipReleased() { return this === primary && closed; }, settlement: { resourceId, settled: true, pending: false } }));
      throw primary;
    } } }); } catch (error) { failure = error; }
    assert.equal(contains(failure, primary), true);
    assert.equal(failure.code, 'EIO');
    await assert.rejects(failure.goSdkInstallSession.releaseAfterClosure(), /remains pending/);
    assert.equal((await inspect(pendingRoot)).protected, true);
    closed = true;
    assert.equal(await failure.goSdkInstallSession.releaseAfterClosure(), true);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal((await inspect(pendingRoot)).protected, false);
    assert.deepEqual(await fs.readdir(path.join(pendingRoot, 'sdk', 'go')), []);

    const remove = fs.rm;
    let deny = true;
    const cleanupRoot = path.join(temporary, 'cleanup-failure');
    try {
      fs.rm = async (target, options) => {
        if (deny && String(target).startsWith(cleanupRoot + path.sep) && path.basename(target).startsWith('.install-')) {
          throw Object.assign(new Error('actual SDK transaction cleanup denied'), { code: 'EACCES' });
        }
        return remove(target, options);
      };
      let primary, combined;
      try { await ensureManagedGoSdk({ ...input(cleanupRoot), dependencies: { ...dependencies, probe: async (_command, { resourceId }) => {
        primary = Object.freeze(Object.assign(new Error('frozen settled Go verifier failed'), { code: 'EIO',
          settlement: { resourceId, settled: true, pending: false } }));
        throw primary;
      } } }); } catch (error) { combined = error; }
      assert.equal(contains(combined, primary), true);
      assert.equal(combined.goSdkCleanupError.code, 'EACCES');
      assert.equal(combined.cacheOwnershipReleased(), false);
      assert.equal((await inspect(cleanupRoot)).protected, true);
      let latest;
      try { await combined.goSdkInstallSession.releaseAfterClosure(); } catch (error) { latest = error; }
      assert.equal(latest.goSdkInstallSession, combined.goSdkInstallSession, 'the outer wrapper survives the latest cleanup rejection');
      deny = false;
      assert.equal(await latest.goSdkInstallSession.releaseAfterClosure(), true);
      assert.equal(combined.cacheOwnershipReleased(), true);
      assert.equal((await inspect(cleanupRoot)).protected, false);
    } finally { fs.rm = remove; }

    const changedRoot = path.join(temporary, 'changed-transaction');
    let transaction, retained, changed;
    try { await ensureManagedGoSdk({ ...input(changedRoot), dependencies: { ...dependencies,
      probe: async (command, { resourceId }) => {
        transaction = path.dirname(path.dirname(path.dirname(path.dirname(command))));
        retained = transaction + '-retained-fixture';
        await fs.rename(transaction, retained);
        await fs.mkdir(transaction);
        await fs.writeFile(path.join(transaction, 'unknown-evidence'), 'preserved foreign replacement');
        throw Object.freeze(Object.assign(new Error('frozen failure after transaction replacement'), {
          settlement: { resourceId, settled: true, pending: false }
        }));
      } } }); } catch (error) { changed = error; }
    assert.equal(await fs.readFile(path.join(transaction, 'unknown-evidence'), 'utf8'), 'preserved foreign replacement');
    assert.equal(changed.cacheOwnershipReleased(), false);
    await assert.rejects(changed.goSdkInstallSession.releaseAfterClosure(), error => /transaction identity changed/.test(error.goSdkCleanupError?.message || ''),
      'known child settlement cannot authorize deleting a replacement transaction directory');
    assert.equal(path.dirname(transaction), path.join(changedRoot, 'sdk', 'go'));
    await fs.rm(path.join(transaction, 'unknown-evidence'));
    await fs.rmdir(transaction);
    await fs.rename(retained, transaction);
    assert.equal(await changed.goSdkInstallSession.releaseAfterClosure(), true, 'only restoration of the original fixture directory permits its exact cleanup');
    assert.equal(changed.cacheOwnershipReleased(), true);

    const goodRoot = path.join(temporary, 'successful');
    const sdk = await ensureManagedGoSdk(input(goodRoot));
    assert.equal(sdk.reused, false);
    assert.equal(resolveManagedGoSdk(goodRoot, { platform: 'win32', arch: 'x64' }).command, sdk.command);
    assert.equal((await inspect(goodRoot)).protected, false);

    const unknownRoot = path.join(temporary, 'unknown-native');
    const unknownPrimary = Object.freeze(Object.assign(new Error('unknown frozen Go native owner'), { cacheOwnershipPending: true }));
    let unknown;
    try { await ensureManagedGoSdk({ ...input(unknownRoot), dependencies: { ...dependencies, probe: async () => { throw unknownPrimary; } } }); }
    catch (error) { unknown = error; }
    assert.equal(contains(unknown, unknownPrimary), true);
    await assert.rejects(unknown.goSdkInstallSession.releaseAfterClosure(), /remains pending/);
    assert.equal(unknown.cacheOwnershipReleased(), false);
    assert.equal((await inspect(unknownRoot)).protected, true);
  });
} finally { await rmDirRecursive(temporary); }
console.log('Go SDK ownership preserves frozen errors and exact transaction cleanup.');

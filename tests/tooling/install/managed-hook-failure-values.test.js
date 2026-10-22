import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

// UNVALIDATED: actual tiny transaction/storage owners, inert recipe hooks.
const temporary = await makeTempDir('poc-managed-hook-values-');
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (Object.is(current, expected)) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return false;
};
try {
  const home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
    const archive = Buffer.from('inert archive for hook-failure controls');
    const descriptor = version => ({ schemaVersion: 1, toolId: 'fixture-hook-values', recipeId: 'fixture', version,
      platform: process.platform, arch: process.arch,
      archive: { url: `https://fixture.invalid/hooks-${version}.zip`, type: 'zip', bytes: archive.length,
        sha256: createHash('sha256').update(archive).digest('hex') },
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] },
      root: 'package', command: 'tool', args: [], requiredFiles: ['tool'] });
    const defaults = { approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => ({ body: archive, sourceUrl: url }),
      extract: async (_archive, destination) => { await fs.mkdir(path.join(destination, 'package'), { recursive: true });
        await fs.writeFile(path.join(destination, 'package', 'tool'), 'inert executable bytes'); },
      verify: async ({ resourceId }) => ({ ok: true, settlement: { resourceId, settled: true, pending: false } }) };
    const inspect = () => inspectStorageAccess(toolingRoot, { coordinationRoot });
    const exact = held => ({ resourceId: held.resourceId, settled: true, pending: false });
    let version = 0;
    for (const [phase, value] of [['download', null], ['extract', false], ['onProgress', undefined], ['asyncProgress', 0], ['verify', '']]) {
      let failure, downloads = 0, progressSettled = false;
      const options = { ...defaults, download: async input => { downloads++; return defaults.download(input); } };
      if (phase === 'asyncProgress') options.onProgress = async () => { await Promise.resolve(); progressSettled = true; throw value; };
      else if (phase === 'onProgress') options.onProgress = () => { throw value; };
      else options[phase] = async () => { throw value; };
      try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(`1.0.${version++}`), ...options }); }
      catch (error) { failure = error; }
      assert.equal(contains(failure, value), true, `${phase} preserves its exact falsey thrown value as a cause`);
      assert.equal(failure instanceof Error, true);
      if (phase.includes('Progress')) {
        assert.equal(downloads, 0, 'failed progress callback completes before the next acquisition starts');
        if (phase === 'asyncProgress') assert.equal(progressSettled, true);
      }
      if (phase === 'verify') {
        const held = failure.managedInstallSession;
        assert.equal(failure.cacheOwnershipReleased(), false);
        assert.equal(await held.releaseAfterSettlement(exact(held)), true);
        assert.equal(failure.cacheOwnershipReleased(), true);
      }
      assert.equal((await inspect()).protected, false);
    }

    const codeRead = new Error('code diagnostic getter failed'), messageRead = new Error('message diagnostic getter failed');
    const primary = new Error('unreadable frozen diagnostics');
    Object.defineProperties(primary, { code: { get() { throw codeRead; } }, message: { get() { throw messageRead; } } });
    Object.freeze(primary);
    let diagnostic;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(`1.0.${version++}`), ...defaults,
      download: async () => { throw primary; } }); } catch (error) { diagnostic = error; }
    assert.equal(contains(diagnostic, primary), true);
    assert.equal(contains(diagnostic, codeRead), true);
    assert.equal(contains(diagnostic, messageRead), true);
    assert.equal(typeof diagnostic.message, 'string', 'top-level recovery diagnostics do not invoke an unreadable original message');
    assert.equal((await inspect()).protected, false);

    const receiptRead = new Error('original settlement getter failed');
    const verifier = new Error('frozen verifier settlement is unreadable');
    Object.defineProperty(verifier, 'settlement', { get() { throw receiptRead; } });
    Object.freeze(verifier);
    let receiptFailure;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(`1.0.${version++}`), ...defaults,
      verify: async () => { throw verifier; } }); } catch (error) { receiptFailure = error; }
    assert.equal(contains(receiptFailure, verifier), true);
    assert.equal(contains(receiptFailure, receiptRead), true);
    assert.equal(await receiptFailure.managedInstallSession.releaseAfterSettlement(exact(receiptFailure.managedInstallSession)), true);
    assert.equal(receiptFailure.cacheOwnershipReleased(), true);

    for (const observed of [true, false]) {
      let inspectionClosed = false;
      const inspectionToolingRoot = path.join(temporary, `receipt-inspection-${observed}`);
      const inspectInspection = () => inspectStorageAccess(inspectionToolingRoot, { coordinationRoot });
      const pendingInspection = new Error('settlement inspection owns a pending child');
      Object.assign(pendingInspection, { cacheOwnershipPending: true,
        ...(observed ? { cacheOwnershipReleased() { assert.equal(this, pendingInspection); return inspectionClosed; } } : {}) });
      Object.freeze(pendingInspection);
      const original = new Error('verifier with independent receipt-inspection failure');
      Object.defineProperty(original, 'settlement', { get() { throw pendingInspection; } });
      Object.freeze(original);
      let failure;
      try { await installPinnedManagedTool({ toolingRoot: inspectionToolingRoot, descriptor: descriptor(`1.0.${version++}`), ...defaults,
        verify: async () => { throw original; } }); } catch (error) { failure = error; }
      assert.equal(contains(failure, original), true);
      assert.equal(contains(failure, pendingInspection), true);
      const held = failure.managedInstallSession;
      await assert.rejects(held.releaseAfterSettlement(exact(held)), /observer remains pending/,
        'an explicit recipe receipt cannot settle the independent receipt-inspection owner');
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await inspectInspection()).protected, true);
      if (observed) {
        inspectionClosed = true;
        assert.equal(await held.releaseAfterSettlement(exact(held)), true);
        assert.equal(failure.cacheOwnershipReleased(), true);
        assert.equal((await inspectInspection()).protected, false);
      } else {
        // Inert fixture only: keep missing observer evidence protected, then
        // remove it with the final bounded disposable-root cleanup.
      }
    }

    const resultRead = new Error('returned settlement getter failed');
    const result = Object.freeze({ ok: true, get settlement() { throw resultRead; } });
    let resultFailure;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(`1.0.${version++}`), ...defaults,
      verify: async () => result }); } catch (error) { resultFailure = error; }
    assert.equal(contains(resultFailure, result), true);
    assert.equal(contains(resultFailure, resultRead), true);
    assert.equal(await resultFailure.managedInstallSession.releaseAfterSettlement(exact(resultFailure.managedInstallSession)), true);
    assert.equal(resultFailure.cacheOwnershipReleased(), true);

    const okRead = Object.freeze(new Error('capability getter failed after exact settled receipt'));
    let settledFailure;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(`1.0.${version++}`), ...defaults,
      verify: async ({ resourceId }) => ({ get ok() { throw okRead; }, settlement: { resourceId, settled: true, pending: false } }) }); }
    catch (error) { settledFailure = error; }
    assert.equal(contains(settledFailure, okRead), true);
    assert.equal((await inspect()).protected, false, 'known settled verifier resources release after failed result inspection');

    const unreadable = new Error('original lifecycle flag is unreadable');
    const lifecycleRead = new Error('pending flag getter failed');
    Object.defineProperty(unreadable, 'cacheOwnershipPending', { get() { throw lifecycleRead; } });
    Object.freeze(unreadable);
    let unknown;
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(`1.0.${version++}`), ...defaults,
      extract: async () => { throw unreadable; } }); } catch (error) { unknown = error; }
    assert.equal(contains(unknown, unreadable), true);
    const held = unknown.managedInstallSession;
    await assert.rejects(held.releaseAfterSettlement(exact(held)), /observer remains pending/);
    assert.equal(unknown.cacheOwnershipReleased(), false);
    assert.equal((await inspect()).protected, true);
    // The hook is inert; final disposable-fixture cleanup removes its unknown
    // evidence without asserting any production resource's closure.
  });
} finally { await rmDirRecursive(temporary); }
console.log('Managed hook failures preserve exact values and unreadable lifecycle causes.');

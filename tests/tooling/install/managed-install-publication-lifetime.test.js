#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installPinnedManagedTool, inspectManagedInstallation, retainManagedToolInstallation, inspectManagedToolRemoval, removePinnedManagedTool, validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { resolveManagedToolInstallation, retainManagedToolInstallationSync } from '../../../src/shared/managed-installation.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { applyToolLifecyclePlan } from '../../../tools/tooling/lifecycle.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'managed-install-publication-lifetime');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const toolingRoot = path.join(root, 'tools');
    const archive = Buffer.from('inert approved archive fixture');
    const checksum = createHash('sha256').update(archive).digest('hex');
    let downloads = 0;
    const descriptor = version => ({ schemaVersion: 1, toolId: 'fixture-tool', recipeId: 'fixture-archive', version,
      platform: process.platform, arch: process.arch, archive: { url: `https://official.example.test/tool-${version}.zip`, type: 'zip', bytes: archive.length, sha256: checksum },
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] },
      root: 'package', command: 'bin/tool', args: [], requiredFiles: ['bin/tool', 'lib/data'] });
    const dependencies = {
      approvedOrigins: ['https://official.example.test'],
      download: async ({ url }) => { downloads++; return { body: archive, sourceUrl: url }; },
      extract: async (_archive, destination) => {
        await fs.mkdir(path.join(destination, 'package', 'bin'), { recursive: true });
        await fs.mkdir(path.join(destination, 'package', 'lib'));
        await fs.writeFile(path.join(destination, 'package', 'bin', 'tool'), 'fixture executable bytes');
        await fs.writeFile(path.join(destination, 'package', 'lib', 'data'), 'fixture runtime library');
      },
      verify: async ({ command, resourceId }) => ({ ok: (await fs.readFile(command, 'utf8')).includes('fixture'), level: 'fixture-only', settlement: { resourceId, settled: true, pending: false } })
    };
    assert.throws(() => validatePinnedInstallDescriptor({ ...descriptor('1.0.0'), pinned: true },
      { approvedOrigins: dependencies.approvedOrigins }), /canonical tool\/profile\/recipe descriptor/,
    'unknown retention semantics cannot be adopted as a canonical installation recipe');
    const first = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies });
    assert.equal(first.ok, true);
    assert.equal(resolveManagedToolInstallation(toolingRoot, 'fixture-tool').command, first.command);
    const cancelled = new AbortController();
    const cancellation = new Error('fixture lifecycle cancelled before execution');
    cancelled.abort(cancellation);
    await assert.rejects(inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool', signal: cancelled.signal }),
      error => error === cancellation, 'cancellation must not be flattened to repair-required');
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies, signal: cancelled.signal }),
      error => error === cancellation);
    await assert.rejects(applyToolLifecyclePlan({}, { signal: cancelled.signal }), error => error === cancellation,
      'an already-cancelled lifecycle apply cannot even start target re-planning');
    const cancellableRemoval = await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' });
    await assert.rejects(removePinnedManagedTool(cancellableRemoval, { signal: cancelled.signal }), error => error === cancellation);
    assert.equal(downloads, 1, 'cancelled operations acquire no replacement archives');
    const readCancellation = new AbortController();
    const readFailure = new Error('fixture cancellation during actual managed file read');
    const originalOpen = fs.open;
    let readClosed = false;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] !== path.join(first.root, 'lib', 'data')) return handle;
      return new Proxy(handle, { get(target, property) {
        if (property === 'read') return async (...readArgs) => {
          const value = await target.read(...readArgs);
          readCancellation.abort(readFailure);
          return value;
        };
        if (property === 'close') return async () => { await target.close(); readClosed = true; };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    try {
      await assert.rejects(inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool', signal: readCancellation.signal }),
        error => error === readFailure);
      assert.equal(readClosed, true, 'cancellation returns only after the actual owned file handle closes');
    } finally { fs.open = originalOpen; }
    assert.equal(resolveManagedToolInstallation(toolingRoot, 'fixture-tool').command, first.command);
    await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies });
    assert.equal(downloads, 1, 'compatible existing managed generation performs zero downloads');
    let pendingVerification;
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies,
      verify: async () => { throw new Error('fixture verifier failed without settlement'); } }), error => {
      pendingVerification = error;
      return error.cacheOwnershipPending === true;
    });
    assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' })).state, 'blocked', 'failed verifier without settlement retains consumer ownership');
    const pendingSession = pendingVerification.managedInstallSession;
    assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: 'another-resource', settled: true }), /remains pending/);
    assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true }), /remains pending/,
      'omitted pending is not exact settlement evidence');
    assert.equal(pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false }), true);
    const held = await retainManagedToolInstallation({ toolingRoot, toolId: 'fixture-tool' });
    const blocked = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies });
    assert.equal(blocked.state, 'verified-awaiting-owner-release');
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool' })).command, first.command);
    assert.equal(held.release(), true);
    const heldSync = retainManagedToolInstallationSync({ toolingRoot, toolId: 'fixture-tool', installId: first.receipt.installId });
    assert.equal(heldSync.receipt.installId, first.receipt.installId, 'shared synchronous consumers pin exact physical bytes without probing');
    assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' })).state, 'blocked');
    assert.throws(() => retainManagedToolInstallationSync({ toolingRoot, toolId: 'fixture-tool', installId: '0'.repeat(64) }), /unavailable/);
    assert.equal(heldSync.release(), true);
    const resumed = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies });
    assert.equal(resumed.ok, true);
    assert.equal(downloads, 2, 'resuming verified sibling does not reacquire archive');
    let pendingSibling;
    const siblingDescriptor = descriptor('2.1.0');
    const heldForSibling = await retainManagedToolInstallation({ toolingRoot, toolId: 'fixture-tool' });
    assert.equal((await installPinnedManagedTool({ toolingRoot, descriptor: siblingDescriptor, ...dependencies })).state, 'verified-awaiting-owner-release');
    heldForSibling.release();
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: siblingDescriptor, ...dependencies,
      verify: async ({ resourceId }) => { throw Object.assign(new Error('fixture sibling verifier missing explicit pending state'),
        { settlement: { resourceId, settled: true } }); } }), error => { pendingSibling = error; return error.cacheOwnershipPending === true; });
    const siblingOwner = path.join(toolingRoot, 'installs', 'fixture-tool');
    const siblingAccess = await inspectStorageAccess(siblingOwner,
      { coordinationRoot: path.join(root, 'home', 'state', 'storage-access') });
    assert.equal(siblingAccess.owners.some(owner => owner.status === 'resource-settlement-unconfirmed'
      && owner.resourceId === pendingSibling.managedInstallSession.resourceId), true,
    'retained sibling verification uses the durable exact-resource owner');
    await pendingSibling.managedInstallSession.releaseAfterSettlement({ resourceId: pendingSibling.managedInstallSession.resourceId,
      settled: true, pending: false });
    const downloadsBeforeRepair = downloads;
    // Keep the selected 2.0.0 generation for the original repair/removal checks.
    await fs.writeFile(resumed.command, 'damaged selected installation bytes');
    const drift = await inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool' });
    assert.equal(drift.state, 'repair-required');
    assert.equal(resolveManagedToolInstallation(toolingRoot, 'fixture-tool'), null, 'drift cannot be selected by consumers');
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies }), /explicit owned repair/);
    assert.equal(downloads, downloadsBeforeRepair, 'ordinary install preserves drift without downloading over it');
    const repaired = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), repair: true, ...dependencies });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.receipt.descriptorId, resumed.receipt.descriptorId, 'repair retains the exact pinned recipe identity');
    assert.notEqual(repaired.receipt.installId, resumed.receipt.installId, 'repair creates a distinct immutable physical generation');
    assert.equal(await fs.readFile(resumed.command, 'utf8'), 'damaged selected installation bytes', 'damaged evidence survives repair');
    assert.equal(downloads, downloadsBeforeRepair + 1);
    const failed = descriptor('3.0.0');
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: failed, ...dependencies,
      verify: async ({ resourceId }) => ({ ok: false, settlement: { resourceId, settled: true, pending: false } }) }), /verification failed/);
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool' })).command, repaired.command);
    const removal = await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' });
    const library = path.join(repaired.root, 'lib', 'data');
    const libraryBytes = await fs.readFile(library);
    await fs.writeFile(library, 'library-only drift');
    assert.throws(() => retainManagedToolInstallationSync({ toolingRoot, toolId: 'fixture-tool' }), /unavailable/, 'full shared retain rejects drift outside the launcher');
    await fs.writeFile(library, libraryBytes);
    assert.equal(removal.state, 'owned-and-idle');
    const receiptFile = path.join(toolingRoot, 'installs', 'fixture-tool', 'receipts', `${repaired.installId}.json`);
    const receiptBytes = await fs.readFile(receiptFile);
    for (const patch of [value => ({ ...value, pinned: true }),
      value => ({ ...value, source: { ...value.source, forensic: true } })]) {
      const protectedReceipt = Buffer.from(JSON.stringify(patch(JSON.parse(receiptBytes))));
      await fs.writeFile(receiptFile, protectedReceipt);
      assert.equal(resolveManagedToolInstallation(toolingRoot, 'fixture-tool'), null,
        'unknown receipt metadata is not a qualified current consumer');
      assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' })).state, 'blocked');
      await assert.rejects(removePinnedManagedTool(removal), /plan changed or has an active\/unknown owner/);
      assert.deepEqual(await fs.readFile(receiptFile), protectedReceipt, 'removal cannot normalize or overwrite retained evidence');
      assert.deepEqual(await fs.readFile(library), libraryBytes);
      await fs.writeFile(receiptFile, receiptBytes);
    }
    assert.equal((await removePinnedManagedTool(removal)).ok, true);
    await assert.rejects(fs.stat(repaired.root), { code: 'ENOENT' });
    assert.equal((await fs.stat(resumed.root)).isDirectory(), true, 'repair evidence survives selected generation removal');
    assert.equal((await fs.stat(first.root)).isDirectory(), true, 'prior retained generation survives selected removal');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Pinned managed installs preserve prior versions, leases and failed-update evidence.');

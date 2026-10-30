import fs from 'node:fs/promises';
import path from 'node:path';
import { validateToolInstallReceipt, validateToolSecondaryStorage } from '../tooling/install-receipts.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { inspectStorageInventory, storageFileIdentity, sameStorageFileIdentity } from '../../src/shared/storage/inventory.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
const errorRecord = error => describeStorageFailure(error, { phase: 'managed-storage-receipt-inventory',
  defaultCode: 'ERR_MANAGED_STORAGE_RECEIPT' });

/** Read existing producer receipts and account only launch-selected registered
 * roots. A persisted path is declaration evidence, never read/write adoption,
 * migration or deletion authority. External overrides stay metadata-only.
 */
export const inspectManagedStorageReceipts = async ({ root, home, registeredRoots = [], maxEntries = 100000,
  maxDurationMs = 10000, signal = null } = {}) => {
  if (!path.isAbsolute(root || '') || !path.isAbsolute(home || '') || !Array.isArray(registeredRoots)
    || registeredRoots.length > 1024 || registeredRoots.some(candidate => !path.isAbsolute(candidate || ''))
    || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) {
    throw new TypeError('Managed receipt inventory requires explicit tooling/home and launch-selected roots.');
  }
  root = path.resolve(root); home = path.resolve(home);
  const started = Date.now();
  const receiptRoot = path.join(root, 'install-receipts');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  const receipts = [];
  const scan = new Map();
  const stopped = () => signal?.aborted ? 'cancelled' : Date.now() - started >= maxDurationMs ? 'time-budget' : null;
  let beforeLease = null, afterLease = null, inventory = null, secondaryInventory = null, complete = false;
  const finish = (stopReason = stopped()) => ({ schemaVersion: 1, category: 'managed-installations', path: root, home,
    complete: complete && !stopReason, stopReason,
    status: complete && !stopReason ? 'observed-declared-secondary-storage' : 'incomplete-or-unqualified-secondary-storage',
    receiptInventory: inventory, secondaryInventory, receipts, lease: afterLease || beforeLease,
    leaseRevalidation: afterLease ? 'observed' : 'not-performed-budget-or-cancellation-or-protected-owner', mutationPerformed: false,
    deletionAuthority: false, migrationAuthority: false, observedWrites: false,
    accounting: 'existing-producer-receipts-and-bounded-launch-selected-paths; external-and-unknown-bytes-unscanned',
    limitation: 'Declared routing does not prove subprocess write containment or settled descendants; receipt paths grant no mutation authority.' });
  if (stopped()) return finish();
  beforeLease = await inspectStorageAccess(root, { coordinationRoot });
  if (stopped() || !beforeLease.complete || beforeLease.protected) return finish();
  inventory = await inspectStorageInventory({ roots: [{ id: 'managed-install-receipts', category: 'tooling',
    path: receiptRoot, retention: 'evidence' }], includeFiles: true, maxEntries,
  maxDurationMs: Math.max(1, maxDurationMs - (Date.now() - started)), signal });
  if (stopped() || inventory.stopReason) return finish(stopped() || inventory.stopReason);
  complete = inventory.complete && inventory.items[0].status === 'scanned'
    && inventory.items[0].files.length > 0 && beforeLease.complete && !beforeLease.protected;
  for (const file of inventory.items[0].files || []) {
    if (stopped()) { complete = false; break; }
    const target = path.join(receiptRoot, file.relativePath);
    try {
      const parts = file.relativePath.split(path.sep);
      if (parts.length !== 2 || !/^[a-z0-9][a-z0-9.-]{0,100}$/u.test(parts[0])
        || !/^[a-f0-9]{64}\.json$/u.test(parts[1])) throw new Error('Unknown receipt path is protected.');
      const read = await readVerifiedContainedFile(receiptRoot, target, { maxBytes: 1024 * 1024,
        expectedBytes: file.identity.size, expectedFileIdentity: { dev: file.identity.dev, ino: file.identity.ino }, signal });
      if (stopped()) { complete = false; break; }
      if (!sameStorageFileIdentity(file.identity, storageFileIdentity(await fs.lstat(target, { bigint: true })))) {
        throw new Error('Managed receipt changed during inventory.');
      }
      if (stopped()) { complete = false; break; }
      const value = validateToolInstallReceipt(JSON.parse(read.buffer.toString('utf8')));
      const { receiptId } = value;
      if (value.toolId !== parts[0] || receiptId !== parts[1].slice(0, -5)) {
        throw new Error('Managed install receipt producer identity is incompatible.');
      }
      if (!value.secondaryStorage || value.secondaryStorage.state === 'unknown-or-not-recorded') {
        complete = false;
        receipts.push({ path: target, toolId: value.toolId, receiptId, status: 'secondary-writes-not-recorded',
          reason: value.secondaryStorage?.reason || 'prior-receipt-without-canonical-child-storage',
          retention: 'evidence', protected: true, ownerQualified: false, deletionAuthority: false });
        continue;
      }
      const secondary = validateToolSecondaryStorage(value.secondaryStorage);
      const locations = [];
      for (const location of secondary.locations) {
        if (stopped()) { complete = false; break; }
        const selected = path.resolve(location.path);
        const admitted = !location.external && [root, ...registeredRoots].some(approved => isPathWithinRoot(selected, path.resolve(approved)));
        const status = location.external ? 'declared-external-override-unscanned'
          : !admitted ? 'receipt-path-is-not-launch-selected-scan-scope' : 'registered-location-accounting-requested';
        if (!admitted) complete = false;
        else if (!scan.has(selected)) {
          if (scan.size >= 1024) { complete = false; }
          else scan.set(selected, { id: `managed-secondary-${scan.size}`, category: 'managed-secondary', path: selected,
            retention: location.retention, source: 'declared-receipt-with-launch-selected-inspection-scope' });
        }
        locations.push({ ...location, path: selected, status, logicalBytes: null, allocatedBytes: null,
          protected: true, ownerQualified: false, deletionAuthority: false, migrationAuthority: false });
      }
      receipts.push({ path: target, toolId: value.toolId, receiptId, status: 'declared-secondary-storage-observed',
        profileIdentity: secondary.profileIdentity, runId: secondary.runId, locations, exceptions: secondary.exceptions,
        consumerQualification: value.verification?.consumer || 'unknown', observedWrites: false,
        retention: 'evidence', protected: true, ownerQualified: false, deletionAuthority: false });
    } catch (error) { complete = false; receipts.push({ path: target, status: 'unknown-or-incomplete-receipt',
      protected: true, ownerQualified: false, deletionAuthority: false, error: errorRecord(error) }); }
  }
  if (stopped()) return finish();
  const remainingEntries = maxEntries - inventory.visitedEntries;
  const remainingDuration = maxDurationMs - (Date.now() - started);
  if (scan.size && remainingEntries > 0 && remainingDuration > 0 && !signal?.aborted) {
    secondaryInventory = await inspectStorageInventory({ roots: [...scan.values()], maxEntries: remainingEntries,
      maxDurationMs: remainingDuration, signal });
    complete &&= secondaryInventory.complete;
    const items = new Map(secondaryInventory.items.map(item => [item.path, item]));
    for (const receipt of receipts) for (const location of receipt.locations || []) {
      const observed = items.get(location.path);
      if (observed) Object.assign(location, { status: observed.status, logicalBytes: observed.logicalBytes,
        allocatedBytes: observed.allocatedBytes, accountingComplete: observed.complete,
        activeLease: 'installation/runtime-resource-owner-coverage-is-category-specific' });
    }
  } else if (scan.size) { complete = false; return finish(remainingEntries <= 0 ? 'entry-budget' : 'time-budget'); }
  if (stopped() || secondaryInventory?.stopReason) return finish(stopped() || secondaryInventory?.stopReason);
  afterLease = await inspectStorageAccess(root, { coordinationRoot });
  complete &&= afterLease.complete && !afterLease.protected;
  return finish();
};

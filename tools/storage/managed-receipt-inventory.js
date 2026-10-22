import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TOOL_INSTALL_RECEIPT_VERSION, TOOL_SECONDARY_STORAGE_VERSION } from '../tooling/install-receipts.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { inspectStorageInventory, storageFileIdentity, sameStorageFileIdentity } from '../../src/shared/storage/inventory.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';
import { MANAGED_CHILD_STORAGE_RETENTION_TIERS } from '../../src/shared/storage/child-environment.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const errorRecord = error => ({ code: error.code || 'ERR_MANAGED_STORAGE_RECEIPT', message: error.message });
const locationKeys = ['environmentKey', 'path', 'retention', 'external', 'source', 'purpose', 'file', 'cleanupAuthority'];
const retention = new Set(MANAGED_CHILD_STORAGE_RETENTION_TIERS);

const readSecondaryStorage = value => {
  if (!exact(value, ['schemaVersion', 'state', 'profileIdentity', 'runId', 'locations', 'exceptions'])
    || value.schemaVersion !== TOOL_SECONDARY_STORAGE_VERSION || value.state !== 'settled-declared-not-observed'
    || !/^[a-f0-9]{64}$/u.test(value.profileIdentity || '')
    || !/^[a-zA-Z0-9._-]{1,120}$/u.test(value.runId || '') || ['.', '..'].includes(value.runId) || !Array.isArray(value.locations)
    || value.locations.length > 128 || !Array.isArray(value.exceptions) || value.exceptions.length > 128) {
    throw new Error('Managed secondary storage receipt is unknown or incomplete.');
  }
  for (const location of value.locations) {
    if (!exact(location, locationKeys) || !/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/u.test(location.environmentKey || '')
      || !path.isAbsolute(location.path || '') || /[\x00-\x1f]/u.test(location.path) || !retention.has(location.retention)
      || typeof location.external !== 'boolean' || typeof location.file !== 'boolean' || location.cleanupAuthority !== false
      || !['inherited-or-explicit-environment', 'managed-storage-profile'].includes(location.source)
      || (location.purpose !== null && typeof location.purpose !== 'string')) throw new Error('Unregistered secondary location is retained without scan authority.');
  }
  for (const exception of value.exceptions) {
    if (!exception || typeof exception !== 'object' || Array.isArray(exception)
      || Object.keys(exception).some(key => !['environmentKey', 'path', 'kind', 'status'].includes(key))
      || ['kind', 'status'].some(key => exception[key] !== null && typeof exception[key] !== 'string')
      || (exception.path !== undefined && !path.isAbsolute(exception.path))) throw new Error('Unknown secondary exception metadata is retained.');
  }
  return value;
};

/** Read existing producer receipts and account only launch-selected registered
 * roots. A persisted path is declaration evidence, never read/write adoption,
 * migration or deletion authority. External overrides stay metadata-only.
 */
export const inspectManagedStorageReceipts = async ({ root, home, registeredRoots = [], maxEntries = 100000,
  maxDurationMs = 10000, signal = null } = {}) => {
  if (!path.isAbsolute(root || '') || !path.isAbsolute(home || '') || !Array.isArray(registeredRoots)
    || registeredRoots.length > 1024 || registeredRoots.some(candidate => !path.isAbsolute(candidate || ''))) {
    throw new TypeError('Managed receipt inventory requires explicit tooling/home and launch-selected roots.');
  }
  root = path.resolve(root); home = path.resolve(home);
  const started = Date.now();
  const receiptRoot = path.join(root, 'install-receipts');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  const beforeLease = await inspectStorageAccess(root, { coordinationRoot });
  const inventory = await inspectStorageInventory({ roots: [{ id: 'managed-install-receipts', category: 'tooling',
    path: receiptRoot, retention: 'evidence' }], includeFiles: true, maxEntries, maxDurationMs, signal });
  const receipts = [];
  const scan = new Map();
  let complete = inventory.complete && inventory.items[0].status === 'scanned'
    && inventory.items[0].files.length > 0 && beforeLease.complete && !beforeLease.protected;
  for (const file of inventory.items[0].files || []) {
    if (signal?.aborted || Date.now() - started >= maxDurationMs) { complete = false; break; }
    const target = path.join(receiptRoot, file.relativePath);
    try {
      const parts = file.relativePath.split(path.sep);
      if (parts.length !== 2 || !/^[a-z0-9][a-z0-9.-]{0,100}$/u.test(parts[0])
        || !/^[a-f0-9]{64}\.json$/u.test(parts[1])) throw new Error('Unknown receipt path is protected.');
      const read = await readVerifiedContainedFile(receiptRoot, target, { maxBytes: 1024 * 1024,
        expectedBytes: file.identity.size, expectedFileIdentity: { dev: file.identity.dev, ino: file.identity.ino } });
      if (!sameStorageFileIdentity(file.identity, storageFileIdentity(await fs.lstat(target, { bigint: true })))) {
        throw new Error('Managed receipt changed during inventory.');
      }
      const value = JSON.parse(read.buffer.toString('utf8'));
      const { receiptId, ...body } = value;
      if (value.schemaVersion !== TOOL_INSTALL_RECEIPT_VERSION || value.kind !== 'tool-install-receipt'
        || value.toolId !== parts[0] || receiptId !== parts[1].slice(0, -5) || digest(body) !== receiptId) {
        throw new Error('Managed install receipt producer identity is incompatible.');
      }
      if (!value.secondaryStorage || value.secondaryStorage.state === 'unknown-or-not-recorded') {
        complete = false;
        receipts.push({ path: target, toolId: value.toolId, receiptId, status: 'secondary-writes-not-recorded',
          reason: value.secondaryStorage?.reason || 'prior-receipt-without-canonical-child-storage',
          retention: 'evidence', protected: true, ownerQualified: false, deletionAuthority: false });
        continue;
      }
      const secondary = readSecondaryStorage(value.secondaryStorage);
      const locations = [];
      for (const location of secondary.locations) {
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
  let secondaryInventory = null;
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
  } else if (scan.size) complete = false;
  const afterLease = await inspectStorageAccess(root, { coordinationRoot });
  complete &&= afterLease.complete && !afterLease.protected;
  return { schemaVersion: 1, category: 'managed-installations', path: root, home, complete,
    status: complete ? 'observed-declared-secondary-storage' : 'incomplete-or-unqualified-secondary-storage',
    receiptInventory: inventory, secondaryInventory, receipts, lease: afterLease, mutationPerformed: false,
    deletionAuthority: false, migrationAuthority: false, observedWrites: false,
    accounting: 'existing-producer-receipts-and-bounded-launch-selected-paths; external-and-unknown-bytes-unscanned',
    limitation: 'Declared routing does not prove subprocess write containment or settled descendants; receipt paths grant no mutation authority.' };
};

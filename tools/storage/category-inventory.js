import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { inspectStorageInventory, storageFileIdentity, sameStorageFileIdentity } from '../../src/shared/storage/inventory.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';
import { inspectDictionaryStorage } from '../../src/shared/storage/dictionary-adapter.js';
import { readToolingCacheEntry } from '../../src/index/tooling/cache-storage.js';
import { isOwnedCommandProbeCacheEntry } from '../../src/index/tooling/command-probe-persistent-cache.js';
import { inspectEmbeddingStorageProfile } from './embedding-adapter.js';
import { readStorageProbePolicy } from '../../src/shared/storage/probe-policy-read.js';
import { inspectManagedStorageReceipts } from './managed-receipt-inventory.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

export const STORAGE_INVENTORY_ADAPTERS = Object.freeze(['embedding-profiles', 'dictionaries', 'command-probes', 'managed-installations']);
const errorRecord = error => describeStorageFailure(error, { phase: 'storage-category-inventory',
  defaultCode: 'ERR_STORAGE_CATEGORY_INVENTORY' });

/** Same structured read-only owner entry for CLI and native/TUI consumers.
 * A requested path is inspection scope, never adoption or mutation authority.
 */
export const inspectStorageCategory = async ({ category, root, home, request = null,
  registeredRoots = [], maxEntries = 100000, maxDurationMs = 10000, signal = null } = {}) => {
  if (!STORAGE_INVENTORY_ADAPTERS.includes(category) || !path.isAbsolute(root || '') || !path.isAbsolute(home || '')) {
    throw new TypeError('Category inventory requires a registered owner and explicit absolute root/home.');
  }
  root = path.resolve(root); home = path.resolve(home);
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) {
    throw new TypeError('Category inventory requires positive bounded limits.');
  }
  const started = Date.now();
  const stopped = () => signal?.aborted ? 'cancelled' : Date.now() - started >= maxDurationMs ? 'time-budget' : null;
  const base = { schemaVersion: 1, category, path: root, home, timestamp: new Date().toISOString(),
    external: !isPathWithinRoot(root, home), scopeProvenance: 'explicit-read-only-category-inspection',
    mutationPerformed: false, deletionAuthority: false, cleanupAuthority: false };
  const interrupted = (extra, stopReason = stopped()) => ({ ...base, ...extra, complete: false, status: stopReason, stopReason,
    ownerQualified: false, leaseRevalidation: 'not-performed-budget-or-cancellation', logicalBytes: null, allocatedBytes: null });
  if (stopped()) return interrupted({ lease: null });
  if (category === 'command-probes') base.policy = readStorageProbePolicy(home);
  if (stopped()) return interrupted({ lease: null });
  if (category === 'managed-installations') return { ...await inspectManagedStorageReceipts({ root, home, registeredRoots,
    maxEntries, maxDurationMs: Math.max(1, maxDurationMs - (Date.now() - started)), signal }), ...base, owner: 'existing-managed-install-receipt-producer' };
  if (category === 'embedding-profiles') {
    if (!request || request.schemaVersion !== 1 || request.kind !== 'embedding-storage-profile-request'
      || !request.identity || typeof request.identity !== 'object' || Array.isArray(request.identity)
      || Object.keys(request).some(key => !['schemaVersion', 'kind', 'identity', 'repoId'].includes(key))) {
      throw new TypeError('Embedding inventory requires a read-only full-identity profile request JSON.');
    }
    const profile = await inspectEmbeddingStorageProfile({ cacheRoot: root, identity: request.identity,
      repoId: request.repoId || null, maxEntries, maxDurationMs: Math.max(1, maxDurationMs - (Date.now() - started)), signal });
    return { ...profile, ...base, complete: profile.complete, owner: 'existing-strict-embedding-index-and-reference-readers' };
  }
  const lease = await inspectStorageAccess(root, category === 'dictionaries'
    ? { coordinationRoot: path.join(home, 'state', 'storage-access') } : {});
  if (stopped()) return interrupted({ lease });
  if (lease.protected || !lease.complete) return { ...base, complete: false, status: 'active-or-unknown-owner', lease,
    logicalBytes: null, allocatedBytes: null, ownerQualified: false };
  if (category === 'dictionaries') {
    try {
      const inventory = await inspectDictionaryStorage({ root, maxEntries,
        maxDurationMs: Math.max(1, maxDurationMs - (Date.now() - started)), signal });
      if (stopped()) return interrupted({ inventory, lease });
      const afterLease = await inspectStorageAccess(root, { coordinationRoot: path.join(home, 'state', 'storage-access') });
      if (stopped()) return interrupted({ inventory, lease, afterLease });
      return { ...base, inventory, lease, complete: inventory.complete && afterLease.complete && !afterLease.protected, status: 'known-consumer-bytes-observed',
        afterLease, leaseRevalidation: 'observed',
        ownerQualified: false, consumerSchemaRecognized: true, retention: 'includes-durable-user-and-repository-dictionaries',
        limitation: 'Read-only category recognition grants neither migration permission proof nor cleanup authority.' };
    } catch (error) { return { ...base, complete: false, ownerQualified: false, status: 'unknown-or-incomplete-category',
      lease, logicalBytes: null, allocatedBytes: null, error: errorRecord(error) }; }
  }
  const physical = await inspectStorageInventory({ roots: [{ id: 'command-probes', category, path: root,
    retention: 'derived' }], maxEntries, maxDurationMs: Math.max(1, maxDurationMs - (Date.now() - started)), signal, includeFiles: true });
  const files = [];
  if (physical.stopReason) return interrupted({ physical, files, lease }, physical.stopReason);
  let complete = physical.complete;
  for (const file of physical.items[0].files || []) {
    if (stopped()) { complete = false; break; }
    const target = path.join(root, file.relativePath);
    try {
      const read = readToolingCacheEntry(target);
      if (stopped()) { complete = false; break; }
      const after = storageFileIdentity(await fs.lstat(target, { bigint: true }));
      if (stopped()) { complete = false; break; }
      const qualified = path.basename(file.relativePath) === file.relativePath
        && isOwnedCommandProbeCacheEntry(read.payload, file.relativePath) && sameStorageFileIdentity(file.identity, after);
      files.push({ path: target, ownerQualified: qualified, protected: !qualified, retention: qualified ? 'derived' : 'unknown',
        logicalBytes: file.identity.size, allocatedBytes: file.allocatedBytes,
        lastUse: { timestamp: null, provenance: 'unknown-no-disk-touch-per-hit' },
        impact: qualified ? 'command-reprobe-on-next-use' : 'unknown-bytes-retained', deletionAuthority: false });
    } catch (error) { complete = false; files.push({ path: target, ownerQualified: false, protected: true,
      retention: 'unknown', logicalBytes: null, allocatedBytes: null, error: errorRecord(error), deletionAuthority: false }); }
  }
  if (stopped()) return interrupted({ physical, files, lease, protectedFiles: files.filter(file => file.protected).length });
  const afterLease = await inspectStorageAccess(root);
  if (stopped() || !afterLease.complete || afterLease.protected) complete = false;
  return { ...base, complete, status: complete ? 'observed-owner-files' : 'incomplete-or-concurrent-owner', physical, files,
    lease: afterLease, leaseRevalidation: 'observed', stopReason: stopped(), protectedFiles: files.filter(file => file.protected).length,
    owner: 'complete-command-probe-producer-key', measurement: 'observed-files-not-a-filesystem-snapshot' };
};

import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { inspectStorageInventory, storageFileIdentity, sameStorageFileIdentity } from '../../src/shared/storage/inventory.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';
import { inspectDictionaryStorage } from '../../src/shared/storage/dictionary-adapter.js';
import { readToolingCacheEntry } from '../../src/index/tooling/cache-storage.js';
import { isOwnedCommandProbeCacheEntry } from '../../src/index/tooling/command-probe-persistent-cache.js';
import { inspectEmbeddingStorageProfile } from './embedding-adapter.js';

export const STORAGE_INVENTORY_ADAPTERS = Object.freeze(['embedding-profiles', 'dictionaries', 'command-probes']);
const errorRecord = error => ({ code: error.code || 'ERR_STORAGE_CATEGORY_INVENTORY', message: error.message });

/** Same structured read-only owner entry for CLI and native/TUI consumers.
 * A requested path is inspection scope, never adoption or mutation authority.
 */
export const inspectStorageCategory = async ({ category, root, home, request = null,
  maxEntries = 100000, maxDurationMs = 10000, signal = null } = {}) => {
  if (!STORAGE_INVENTORY_ADAPTERS.includes(category) || !path.isAbsolute(root || '') || !path.isAbsolute(home || '')) {
    throw new TypeError('Category inventory requires a registered owner and explicit absolute root/home.');
  }
  root = path.resolve(root); home = path.resolve(home);
  const base = { schemaVersion: 1, category, path: root, home, timestamp: new Date().toISOString(),
    external: !isPathWithinRoot(root, home), scopeProvenance: 'explicit-read-only-category-inspection',
    mutationPerformed: false, deletionAuthority: false, cleanupAuthority: false };
  if (category === 'embedding-profiles') {
    if (!request || request.schemaVersion !== 1 || request.kind !== 'embedding-storage-profile-request'
      || !request.identity || typeof request.identity !== 'object' || Array.isArray(request.identity)
      || Object.keys(request).some(key => !['schemaVersion', 'kind', 'identity', 'repoId'].includes(key))) {
      throw new TypeError('Embedding inventory requires a read-only full-identity profile request JSON.');
    }
    const profile = await inspectEmbeddingStorageProfile({ cacheRoot: root, identity: request.identity,
      repoId: request.repoId || null, maxEntries, maxDurationMs, signal });
    return { ...profile, ...base, complete: profile.complete, owner: 'existing-strict-embedding-index-and-reference-readers' };
  }
  const lease = await inspectStorageAccess(root, category === 'dictionaries'
    ? { coordinationRoot: path.join(home, 'state', 'storage-access') } : {});
  if (lease.protected || !lease.complete) return { ...base, complete: false, status: 'active-or-unknown-owner', lease,
    logicalBytes: null, allocatedBytes: null, ownerQualified: false };
  if (category === 'dictionaries') {
    try {
      const inventory = await inspectDictionaryStorage({ root, maxEntries, maxDurationMs, signal });
      return { ...base, inventory, lease, complete: inventory.complete, status: 'known-consumer-bytes-observed',
        ownerQualified: false, consumerSchemaRecognized: true, retention: 'includes-durable-user-and-repository-dictionaries',
        limitation: 'Read-only category recognition grants neither migration permission proof nor cleanup authority.' };
    } catch (error) { return { ...base, complete: false, ownerQualified: false, status: 'unknown-or-incomplete-category',
      lease, logicalBytes: null, allocatedBytes: null, error: errorRecord(error) }; }
  }
  const started = Date.now();
  const physical = await inspectStorageInventory({ roots: [{ id: 'command-probes', category, path: root,
    retention: 'derived' }], maxEntries, maxDurationMs, signal, includeFiles: true });
  const files = [];
  let complete = physical.complete;
  for (const file of physical.items[0].files || []) {
    if (signal?.aborted || Date.now() - started >= maxDurationMs) { complete = false; break; }
    const target = path.join(root, file.relativePath);
    try {
      const read = readToolingCacheEntry(target);
      const after = storageFileIdentity(await fs.lstat(target, { bigint: true }));
      const qualified = path.basename(file.relativePath) === file.relativePath
        && isOwnedCommandProbeCacheEntry(read.payload, file.relativePath) && sameStorageFileIdentity(file.identity, after);
      files.push({ path: target, ownerQualified: qualified, protected: !qualified, retention: qualified ? 'derived' : 'unknown',
        logicalBytes: file.identity.size, allocatedBytes: file.allocatedBytes,
        lastUse: { timestamp: null, provenance: 'unknown-no-disk-touch-per-hit' },
        impact: qualified ? 'command-reprobe-on-next-use' : 'unknown-bytes-retained', deletionAuthority: false });
    } catch (error) { complete = false; files.push({ path: target, ownerQualified: false, protected: true,
      retention: 'unknown', logicalBytes: null, allocatedBytes: null, error: errorRecord(error), deletionAuthority: false }); }
  }
  const afterLease = await inspectStorageAccess(root);
  if (!afterLease.complete || afterLease.protected) complete = false;
  return { ...base, complete, status: complete ? 'observed-owner-files' : 'incomplete-or-concurrent-owner', physical, files,
    lease: afterLease, protectedFiles: files.filter(file => file.protected).length,
    owner: 'complete-command-probe-producer-key', measurement: 'observed-files-not-a-filesystem-snapshot' };
};

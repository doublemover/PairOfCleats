import path from 'node:path';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../../src/shared/contained-file.js';
import { throwIfAborted } from '../../../../src/shared/abort.js';
import { isPathWithinRoot } from '../../../../src/shared/file-paths.js';
import { withStorageDirectory } from '../../../../src/shared/storage/directory.js';
import { inspectStorageInventory, sameStorageFileIdentity } from '../../../../src/shared/storage/inventory.js';
import { inspectStorageAccess } from '../../../../src/shared/storage/access.js';
import { decideStorageLifecycle } from '../../../../src/shared/storage/policy.js';
import { EMBEDDING_PROFILE_MARKER, EMBEDDING_PROFILE_OWNER, resolveEmbeddingProfileAccess } from './profile-access.js';
import { readEmbeddingIndex } from './index-log.js';
import { collectReferenceProtection } from './file-references.js';
import { isOwnedStandaloneCacheFile } from './physical-storage.js';

export const EMBEDDING_PROFILE_LIMITS = Object.freeze({ maxProfiles: 8, maxBytes: 2 * 1024 * 1024 * 1024,
  maxInventoryEntries: 8192, maxInventoryMs: 2000 });
const MODES = ['code', 'prose', 'extracted-prose', 'records'];
const registeredFile = filename => filename === EMBEDDING_PROFILE_MARKER
  || /^text-vectors\.sqlite(?:-wal|-shm|-journal)?$/.test(filename)
  || MODES.some(mode => filename === `${mode}/cache.meta.json`)
  || /^(?:global-chunks|(?:code|prose|extracted-prose|records)\/files)\/(?:cache\.index\.(?:json|bin|delta)|cache\.meta\.json|[A-Za-z0-9_-]{1,256}\.(?:embcache\.zst|json)|shards\/shard-\d{5,}\.bin)$/.test(filename);
const registeredDirectory = filename => !filename || filename === 'global-chunks' || filename === 'global-chunks/shards'
  || MODES.some(mode => [mode, `${mode}/files`, `${mode}/files/shards`].includes(filename));
export const isProfileMarker = (marker, descriptor) => marker?.owner === EMBEDDING_PROFILE_OWNER && marker.version === 1
  && marker.layoutVersion === 3 && marker.identityKey === descriptor.key && Number.isFinite(Date.parse(marker.lastUse || ''));
export const readProfileMarker = async descriptor => {
  try { return JSON.parse((await readVerifiedContainedFile(descriptor.profile, descriptor.marker, { maxBytes: 4096 })).buffer.toString('utf8')); }
  catch (error) { if (error.cacheOwnershipPending || error instanceof AggregateError) throw error; return null; }
};
export const inspectProfileFiles = (descriptor, { signal = null } = {}) => inspectStorageInventory({
  roots: [{ id: descriptor.key, path: descriptor.profile, retention: 'derived' }], includeFiles: true,
  maxEntries: EMBEDDING_PROFILE_LIMITS.maxInventoryEntries, maxDurationMs: EMBEDDING_PROFILE_LIMITS.maxInventoryMs, signal });
export const sameProfileInventory = (left, right) => {
  const sameEntries = (a, b) => { const byPath = new Map(b?.map(entry => [entry.relativePath, entry])); return a?.length === b?.length && a.every(entry => {
    const match = byPath.get(entry.relativePath);
    return match && sameStorageFileIdentity(entry.identity, match.identity);
  }); };
  return left?.complete && right?.complete && sameStorageFileIdentity(left.identity, right.identity)
    && sameEntries(left.files, right.files) && sameEntries(left.directories, right.directories);
};

/** A whole profile is a closed derived-storage unit: references never escape
 * its indexes. Exclusive admission is supplied only by the shared lifecycle owner. */
export const inspectProfileRetirement = async (descriptor, inventory, { exclusive = false } = {}) => {
  const item = inventory.items[0], marker = await readProfileMarker(descriptor);
  let qualified = item.complete && isProfileMarker(marker, descriptor)
    && item.files.every(file => file.identity.nlink === 1 && registeredFile(file.relativePath.split(path.sep).join('/')))
    && item.directories.every(directory => registeredDirectory(directory.relativePath.split(path.sep).join('/')));
  let globalIndex = null;
  if (qualified) {
    for (const file of item.files) {
      const name = path.basename(file.relativePath);
      if (/\.(?:embcache\.zst|json)$/.test(name) && !['profile.meta.json', 'cache.meta.json', 'cache.index.json'].includes(name)) {
        try { if (!await isOwnedStandaloneCacheFile(descriptor.profile, path.join(descriptor.profile, file.relativePath), descriptor.key)) qualified = false; }
        catch (error) { if (error.cacheOwnershipPending || error instanceof AggregateError) throw error; qualified = false; }
      }
    }
    const directories = new Set(item.files.filter(file => /cache\.index\.(?:json|bin|delta)$/.test(file.relativePath))
      .map(file => path.dirname(path.join(descriptor.profile, file.relativePath))));
    for (const directory of directories) {
      try {
        const index = await readEmbeddingIndex(directory, descriptor.key, { strict: true });
        if (index.identityKey !== descriptor.key || Object.values(index.entries || {}).some(entry => entry.path
          && !isPathWithinRoot(path.resolve(entry.path), directory))) qualified = false;
        if (path.basename(directory) === 'global-chunks') globalIndex = index;
        if (!globalIndex && Object.values(index.entries || {}).some(entry => entry.chunkReferences)) {
          globalIndex = await readEmbeddingIndex(path.join(descriptor.profile, 'global-chunks'), descriptor.key, { strict: true });
        }
      } catch (error) { if (error.cacheOwnershipPending || error instanceof AggregateError) throw error; qualified = false; }
    }
    if (globalIndex) {
      const references = await collectReferenceProtection(path.join(descriptor.profile, 'global-chunks'), globalIndex, { readIndex: readEmbeddingIndex });
      if (references.incomplete) qualified = false;
    }
  }
  const lease = exclusive ? { complete: true, protected: false }
    : await inspectStorageAccess(descriptor.profile, { coordinationRoot: descriptor.coordinationRoot });
  const decision = decideStorageLifecycle({ complete: item.complete, ownerQualified: qualified, retention: 'derived', lease,
    references: { complete: qualified, retained: false }, lastUse: { timestamp: marker?.lastUse, provenance: 'profile-owner-advisory-touch' } });
  return { eligible: decision.eligible, reasons: decision.reasons, marker, inventory: item };
};

/** Bounded discovery visits tuple parents, never legacy payload subtrees. V2
 * and tuple bytes remain migration inputs and are outside the V3 quota metric. */
export const inspectEmbeddingCacheProfiles = async (root, { signal = null } = {}) => {
  const started = Date.now(), profiles = [], stack = [{ directory: root, depth: 0 }];
  let visitedEntries = 0;
  const check = () => {
    throwIfAborted(signal);
    if (visitedEntries >= EMBEDDING_PROFILE_LIMITS.maxInventoryEntries || Date.now() - started >= EMBEDDING_PROFILE_LIMITS.maxInventoryMs) {
      throw Object.assign(new Error('Embedding profile inventory exceeded its bounded scan.'), { code: 'ERR_EMBEDDING_PROFILE_INVENTORY_BUDGET' });
    }
  };
  try {
    while (stack.length) {
      check();
      const { directory, depth } = stack.pop();
      await withStorageDirectory(directory, async handle => {
        for (;;) {
          check(); const entry = await handle.read(); if (!entry) break; visitedEntries++;
          if (!entry.isDirectory()) continue;
          const filename = path.join(directory, entry.name);
          if (depth === 0 && entry.name === '.profile-access') continue;
          assertNoSymlinkPath(root, filename);
          if (depth < 3) stack.push({ directory: filename, depth: depth + 1 });
          else if (entry.name === 'profiles-v3') await withStorageDirectory(filename, async children => {
            for (;;) {
              check(); const child = await children.read(); if (!child) break; visitedEntries++;
              if (!child.isDirectory() || !/^[a-f0-9]{40}$/.test(child.name)) throw new Error('Unrecognized managed embedding profile.');
              const descriptor = resolveEmbeddingProfileAccess(path.join(filename, child.name));
              const inventory = await inspectStorageInventory({ roots: [{ id: descriptor.key, path: descriptor.profile, retention: 'derived' }],
                includeFiles: true, maxEntries: Math.max(1, EMBEDDING_PROFILE_LIMITS.maxInventoryEntries - visitedEntries),
                maxDurationMs: Math.max(1, EMBEDDING_PROFILE_LIMITS.maxInventoryMs - (Date.now() - started)), signal });
              visitedEntries += inventory.visitedEntries;
              if (!inventory.complete) throw new Error('Managed embedding profile inventory is incomplete.');
              const marker = await readProfileMarker(descriptor);
              const pendingCheckpointBytes = inventory.items[0].files.filter(file => path.basename(file.relativePath) === 'cache.index.delta')
                .reduce((sum, file) => sum + file.identity.size * 2, 0);
              profiles.push({ key: descriptor.key, relativePath: path.relative(root, descriptor.profile), upperBytes: inventory.items[0].logicalBytes, pendingCheckpointBytes,
                lastUse: isProfileMarker(marker, descriptor) ? marker.lastUse : null });
              if (profiles.length > EMBEDDING_PROFILE_LIMITS.maxProfiles) throw new Error('Managed embedding profile history exceeds its catalog bound.');
            }
          });
        }
      });
    }
    return { complete: true, profiles, visitedEntries, bytes: profiles.reduce((sum, profile) => sum + profile.upperBytes, 0),
      accounting: 'managed-v3-ordinary-file-lengths; legacy-and-allocated-bytes-not-included' };
  } catch (error) {
    if (signal?.aborted || error.cacheOwnershipPending || error instanceof AggregateError) throw error;
    return { complete: false, profiles: [], visitedEntries, reason: error.code || 'inventory-unavailable' };
  }
};

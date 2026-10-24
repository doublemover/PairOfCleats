import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { inspectStorageInventory } from '../../src/shared/storage/inventory.js';
import { EMBEDDING_PROTECTED_METADATA } from '../../src/shared/storage/catalog.js';
import { resolveEmbeddingCacheProfile } from '../../src/shared/embeddings-cache/layout.js';
import { readCacheIndex } from '../build/embeddings/cache.js';
import { collectReferenceProtection } from '../build/embeddings/cache/file-references.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

export const EMBEDDING_STORAGE_METADATA = Object.freeze([...new Set([
  ...EMBEDDING_PROTECTED_METADATA, 'cache.index.bin', 'cache.lock'
])]);
const MODES = ['code', 'prose', 'extracted-prose', 'records'];
const stamp = stat => stat ? [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':') : null;
const fingerprint = async (directory, stopped) => {
  const result = {};
  for (const name of EMBEDDING_STORAGE_METADATA) {
    if (stopped()) return null;
    const file = name === 'cache.meta.json' && path.basename(directory) === 'files'
      ? path.join(path.dirname(directory), name) : path.join(directory, name);
    try {
      assertNoSymlinkPath(path.parse(file).root, file);
      if (stopped()) return null;
      const stat = await fs.lstat(file, { bigint: true });
      if (stopped()) return null;
      if (!stat.isFile()) throw new Error('Embedding metadata is not an ordinary file.');
      result[name] = stamp(stat);
    } catch (error) {
      const failure = describeStorageFailure(error, { phase: 'embedding-storage-metadata-stat' });
      if (stopped()) return null;
      if (failure.code === 'ENOENT') result[name] = null;
      else throw error;
    }
  }
  return result;
};

/** Read-only category adapter: strict canonical replay includes cache.index.delta.
 * A snapshot race or unreadable reference ownership blocks lifecycle admission.
 * No shard lock is acquired during explain/inventory because acquisition writes.
 */
export const inspectEmbeddingStorageProfile = async ({ cacheRoot, identity, repoId = null,
  maxEntries = 100000, maxDurationMs = 10000, signal = null } = {}) => {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) {
    throw new TypeError('Embedding storage inspection requires positive bounded limits.');
  }
  const profile = resolveEmbeddingCacheProfile({ cacheRoot, identity });
  const roots = [];
  const indexes = [];
  const failures = [];
  let entryCount = 0;
  let protectedKeys = 0;
  let referencesComplete = true;
  const started = Date.now();
  let stopReason = null;
  const stopped = () => {
    if (signal?.aborted) stopReason = 'cancelled';
    else if (Date.now() - started >= maxDurationMs) stopReason ||= 'time-budget';
    else if (entryCount >= maxEntries) stopReason ||= 'entry-budget';
    return Boolean(stopReason);
  };
  for (const [tier, root] of [['canonical', profile.canonical], ['legacy-read-only', profile.legacy]]) {
    if (stopped()) { failures.push({ tier, reason: stopReason }); break; }
    const directories = [path.join(root, 'global-chunks'), ...MODES.map(mode => path.join(root, mode, 'files'))];
    for (const mode of MODES) roots.push({ id: `embedding-${tier}-${mode}-metadata`, category: 'embedding-metadata',
      path: path.join(root, mode, 'cache.meta.json'), retention: 'referenced', repoId });
    const snapshots = new Map();
    for (const directory of directories) {
      if (stopped()) { failures.push({ tier, reason: stopReason }); break; }
      try {
        const before = await fingerprint(directory, stopped);
        if (stopped()) { failures.push({ tier, directory, reason: stopReason }); break; }
        snapshots.set(directory, before);
        roots.push({ id: `embedding-${tier}-${path.relative(root, directory)}`, category: 'embedding-profile',
          path: directory, retention: 'referenced', repoId });
        if (before['cache.lock']) throw new Error('Existing embedding shard/index lock is protected; inspect does not recover it.');
        if (!before['cache.index.json'] && !before['cache.index.bin'] && !before['cache.index.delta']) {
          let present = false;
          try { present = (await fs.lstat(directory)).isDirectory(); }
          catch (error) {
            const failure = describeStorageFailure(error, { phase: 'embedding-storage-directory-stat' });
            if (failure.code !== 'ENOENT') throw error;
          }
          if (present) referencesComplete = false;
          indexes.push({ tier, directory, status: present ? 'unindexed-report-only' : 'missing', entries: null, referencesComplete: !present });
          continue;
        }
        const index = await readCacheIndex(directory, profile.identityKey, { strict: true });
        if (stopped()) { failures.push({ tier, directory, reason: stopReason }); break; }
        if (index.version !== 1 || index.identityKey !== profile.identityKey) throw new Error('Embedding index profile identity mismatch.');
        const keys = Object.keys(index.entries || {});
        entryCount += keys.length;
        if (entryCount > maxEntries) throw new Error('Embedding logical inventory entry budget exhausted.');
        if (stopped()) { failures.push({ tier, directory, reason: stopReason }); break; }
        let payloadBytes = 0n;
        let bytesKnown = true;
        let newestAccess = null;
        for (const key of keys) {
          const entry = index.entries[key];
          if (!entry || !Number.isSafeInteger(entry.length) || entry.length < 0) bytesKnown = false;
          else payloadBytes += BigInt(entry.length);
          const access = Date.parse(entry?.lastAccessAt || '');
          if (Number.isFinite(access)) newestAccess = Math.max(newestAccess || 0, access);
        }
        let reference = { incomplete: false, protectedKeys: new Set() };
        if (path.basename(directory) === 'global-chunks') reference = await collectReferenceProtection(directory, index, { readIndex: readCacheIndex });
        if (stopped()) { failures.push({ tier, directory, reason: stopReason }); break; }
        if (reference.incomplete) referencesComplete = false;
        protectedKeys += reference.protectedKeys.size;
        indexes.push({ tier, directory, status: reference.incomplete ? 'incomplete-reference-authority' : 'strict-index-observed',
          identityKey: profile.identityKey, entries: keys.length, storageEpoch: index.storageEpoch || 0,
          journal: index.journal ? { generation: index.journal.generation, sequence: index.journal.sequence } : null,
          indexedPayloadBytes: bytesKnown && payloadBytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(payloadBytes) : null,
          newestObservedLastUse: newestAccess === null ? null : new Date(newestAccess).toISOString(),
          lastUseProvenance: newestAccess === null ? 'unknown' : 'partial-index-entry-lastAccessAt',
          protectedChunkKeys: reference.protectedKeys.size, referencesComplete: !reference.incomplete });
      } catch (error) { referencesComplete = false; failures.push({ tier, directory,
        reason: 'unreadable-or-active-embedding-owner', ...describeStorageFailure(error, { phase: 'embedding-storage-index-inventory',
          defaultCode: 'ERR_EMBEDDING_STORAGE_INVENTORY' }) }); }
    }
    for (const [directory, before] of snapshots) {
      if (stopped()) { failures.push({ tier, directory, reason: stopReason }); break; }
      try {
        const after = await fingerprint(directory, stopped);
        if (stopped()) { failures.push({ tier, directory, reason: stopReason }); break; }
        if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Embedding checkpoint/delta/lock changed during inventory.');
      } catch (error) { referencesComplete = false; failures.push({ tier, directory, reason: 'concurrent-embedding-publication',
        ...describeStorageFailure(error, { phase: 'embedding-storage-metadata-revalidation' }) }); }
    }
    // Only known mode roots are scanned. Scanning the legacy tuple parent would
    // accidentally include profiles-v2 and every unrelated complete identity.
  }
  const physical = stopped() ? null : await inspectStorageInventory({ roots, maxEntries: maxEntries - entryCount,
    maxDurationMs: Math.max(1, maxDurationMs - (Date.now() - started)), signal });
  stopped();
  stopReason ||= physical?.stopReason || null;
  return { schemaVersion: 1, category: 'embedding-profile', repoId, profile,
    indexes, physical, protectedMetadata: EMBEDDING_STORAGE_METADATA,
    complete: !stopReason && failures.length === 0 && referencesComplete && physical?.complete === true,
    stopReason, physicalInspection: physical ? 'observed-bounded-files' : 'not-performed-budget-or-cancellation',
    references: { complete: !stopReason && referencesComplete, retained: protectedKeys > 0, protectedChunkKeys: protectedKeys },
    failures, logicalEntryCount: entryCount, cleanupAuthority: false,
    genericMigration: 'unsupported-use-embedding-profile-owner',
    lifecycleOwner: 'tools/build/embeddings/cache.js:pruneCacheIndex',
    adoption: 'read-only strict-delta/reference inventory; destructive operations remain with the existing shard owner' };
};

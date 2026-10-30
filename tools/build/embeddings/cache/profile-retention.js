import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../../src/shared/contained-file.js';
import { withFileLock } from '../../../../src/shared/locks/file-lock.js';
import { atomicWriteText } from '../../../../src/shared/io/atomic-write.js';
import { isPathWithinRoot } from '../../../../src/shared/file-paths.js';
import { throwIfAborted } from '../../../../src/shared/abort.js';
import { withExclusiveStorageAccess } from '../../../../src/shared/storage/access.js';
import { inspectStorageAccess } from '../../../../src/shared/storage/access.js';
import { EMBEDDING_PROFILE_OWNER, resolveEmbeddingProfileAccess, withEmbeddingProfileAccess, withEmbeddingProfileRootAccess } from './profile-access.js';
import { EMBEDDING_PROFILE_LIMITS, inspectEmbeddingCacheProfiles, inspectProfileFiles, inspectProfileRetirement,
  isProfileMarker, readProfileMarker, sameProfileInventory } from './profile-inventory.js';
export { EMBEDDING_PROFILE_LIMITS, inspectEmbeddingCacheProfiles } from './profile-inventory.js';

const mutation = new AsyncLocalStorage(), observedRoots = new Map();
const CATALOG = 'profiles.state.json', OWNER = 'pairofcleats-embedding-profile-budget-v1';
const rootKey = root => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
const positiveBound = value => value == null || value === 0 ? EMBEDDING_PROFILE_LIMITS.maxBytes
  : Number.isFinite(value) && value >= 1 && Number.isSafeInteger(Math.floor(value)) ? Math.floor(value)
    : (() => { throw new TypeError('Invalid embedding profile byte bound.'); })();
const descriptorFor = (root, entry) => {
  if (typeof entry.relativePath !== 'string') return null;
  const selected = path.resolve(root, entry.relativePath), descriptor = resolveEmbeddingProfileAccess(selected);
  return descriptor?.layoutVersion === 3 && rootKey(descriptor.root) === rootKey(root) && descriptor.profile === selected
    && descriptor.key === entry.key && isPathWithinRoot(selected, root) ? descriptor : null;
};
const validCatalog = (catalog, root) => catalog?.version === 1 && catalog.owner === OWNER && catalog.layoutVersion === 3
  && typeof catalog.dirty === 'boolean' && Array.isArray(catalog.profiles) && catalog.profiles.length <= EMBEDDING_PROFILE_LIMITS.maxProfiles
  && new Set(catalog.profiles.map(entry => entry.relativePath)).size === catalog.profiles.length
  && catalog.profiles.every(entry => descriptorFor(root, entry) && Number.isSafeInteger(entry.upperBytes) && entry.upperBytes >= 0
    && (entry.lastUse === null || Number.isFinite(Date.parse(entry.lastUse))));
const saveCatalog = (root, catalog) => atomicWriteText(path.join(root, CATALOG), JSON.stringify({ ...catalog,
  profiles: catalog.profiles.map(({ key, relativePath, upperBytes, lastUse }) => ({ key, relativePath, upperBytes, lastUse })) }));
const remember = root => {
  observedRoots.delete(rootKey(root)); observedRoots.set(rootKey(root), true);
  while (observedRoots.size > 8) observedRoots.delete(observedRoots.keys().next().value);
};
const loadCatalog = async (root, { signal, reconcile = false } = {}) => {
  let catalog = null;
  try {
    catalog = JSON.parse((await readVerifiedContainedFile(root, path.join(root, CATALOG), { maxBytes: 64 * 1024 })).buffer.toString('utf8'));
    if (!validCatalog(catalog, root)) catalog = null;
  } catch (error) { if (error.cacheOwnershipPending || error instanceof AggregateError) throw error; }
  if (!catalog || catalog.dirty || reconcile || !observedRoots.has(rootKey(root))) {
    const inventory = await inspectEmbeddingCacheProfiles(root, { signal });
    if (!inventory.complete) return null;
    for (const entry of inventory.profiles) {
      const descriptor = descriptorFor(root, entry);
      const previous = catalog?.profiles.find(value => value.relativePath === entry.relativePath);
      // A live/failed journal still owes canonical and compatibility checkpoint
      // projections. Recovery must not erase those prepaid future bytes.
      entry.upperBytes += entry.pendingCheckpointBytes;
      if ((!reconcile || entry.pendingCheckpointBytes > 0) && previous) entry.upperBytes = Math.max(entry.upperBytes, previous.upperBytes);
      const lease = await inspectStorageAccess(descriptor.profile, { coordinationRoot: descriptor.coordinationRoot });
      if (lease.complete !== true || lease.protected !== false) {
        // Live native owners may still consume their prepaid capacity. An
        // absent/corrupt catalog cannot guess that outstanding reservation.
        if (!previous) return null;
        entry.upperBytes = Math.max(entry.upperBytes, previous.upperBytes);
      }
    }
    catalog = { version: 1, owner: OWNER, layoutVersion: 3, dirty: false, profiles: inventory.profiles };
    await saveCatalog(root, catalog); remember(root);
  }
  return catalog;
};

/** Catalog size is fixed at eight profiles. Reservations are conservative
 * ordinary-file lengths, including index projections, not Windows allocation. */
export const planEmbeddingProfileRetention = ({ inventory, currentKey, currentPath = null, incomingBytes = 0, maxBytes, maxAgeMs = 0, now = Date.now() }) => {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0) throw new TypeError('Embedding profile admission requires an exact byte reservation.');
  const byteLimit = positiveBound(maxBytes), countLimit = EMBEDDING_PROFILE_LIMITS.maxProfiles;
  if (!inventory?.complete) return { admitted: false, reason: 'inventory-incomplete', selected: [], byteLimit, countLimit };
  const isCurrent = entry => currentPath ? entry.relativePath === currentPath : entry.key === currentKey;
  let count = inventory.profiles.length + (inventory.profiles.some(isCurrent) ? 0 : 1);
  let bytes = inventory.profiles.reduce((sum, entry) => sum + entry.upperBytes, incomingBytes);
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Embedding profile reservation exceeds exact accounting.');
  const selected = [];
  for (const profile of inventory.profiles.filter(entry => !isCurrent(entry) && entry.eligible !== false && entry.lastUse)
    .sort((a, b) => Date.parse(a.lastUse) - Date.parse(b.lastUse) || a.relativePath.localeCompare(b.relativePath))) {
    if (!(maxAgeMs > 0 && now - Date.parse(profile.lastUse) > maxAgeMs) && count <= countLimit && bytes <= byteLimit) continue;
    selected.push(profile); count--; bytes -= profile.upperBytes;
  }
  return { admitted: count <= countLimit && bytes <= byteLimit, selected, byteLimit, countLimit, remainingBytes: bytes, remainingProfiles: count,
    reason: count > countLimit ? 'protected-profile-history' : bytes > byteLimit ? 'protected-profile-bytes' : null };
};

const retire = async (root, entry, signal, deadline) => {
  const descriptor = descriptorFor(root, entry);
  const preview = await inspectProfileFiles(descriptor, { signal, maxDurationMs: Math.max(1, deadline - Date.now()) });
  const decision = await inspectProfileRetirement(descriptor, preview, { signal, deadline });
  if (!decision.eligible || decision.marker.lastUse !== entry.lastUse) return false;
  const excluded = await withExclusiveStorageAccess(descriptor.profile, async () => {
    const fresh = await inspectProfileFiles(descriptor, { signal, maxDurationMs: Math.max(1, deadline - Date.now()) });
    if (!sameProfileInventory(preview.items[0], fresh.items[0])) return false;
    const qualified = await inspectProfileRetirement(descriptor, fresh, { exclusive: true, signal, deadline });
    if (!qualified.eligible || qualified.marker.lastUse !== entry.lastUse) return false;
    const target = path.resolve(descriptor.profile);
    if (!isPathWithinRoot(target, root) || target === path.resolve(root)) throw new Error('Profile retirement escaped its authorized cache root.');
    assertNoSymlinkPath(root, target);
    throwIfAborted(signal);
    await fs.rm(target, { recursive: true, force: false });
    return true;
  }, { coordinationRoot: descriptor.coordinationRoot });
  return !excluded.protected && excluded.result === true;
};
const ensureMarker = async descriptor => {
  const marker = await readProfileMarker(descriptor);
  if (isProfileMarker(marker, descriptor)) return true;
  const inventory = await inspectProfileFiles(descriptor);
  const item = inventory.items[0];
  // Only an absent/empty newly created namespace may gain producer authority.
  if (!item.complete || item.filesCount > 0) return false;
  await fs.mkdir(descriptor.profile, { recursive: true });
  assertNoSymlinkPath(descriptor.root, descriptor.profile);
  await atomicWriteText(descriptor.marker, JSON.stringify({ version: 1, owner: EMBEDDING_PROFILE_OWNER, layoutVersion: 3,
    identityKey: descriptor.key, lastUse: new Date().toISOString() }));
  return true;
};

/** The existing root lock serializes bounded quota reservations. Dirty recovery
 * scans once after a failed/crashed write; successful appends only rewrite a
 * fixed-size catalog, never walk all file indexes. Nested reference/file writes
 * share one reservation and the original immutable profile identity. */
export const withEmbeddingProfileMutation = async (directory, incomingBytes, action, { maxBytes, maxAgeMs = 0, signal = null } = {}) => {
  const descriptor = resolveEmbeddingProfileAccess(directory);
  if (!descriptor) return action();
  if (descriptor.layoutVersion !== 3) return null;
  const context = mutation.getStore();
  if (context) {
    if (context.root !== rootKey(descriptor.root) || context.profile !== descriptor.profile) throw new Error('Nested embedding cache mutation escaped its admitted profile.');
    return action();
  }
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0 || !Number.isSafeInteger(incomingBytes + 4096)) throw new TypeError('Invalid embedding profile reservation.');
  assertNoSymlinkPath(path.parse(descriptor.root).root, descriptor.root, { allowMissing: true });
  await fs.mkdir(descriptor.root, { recursive: true });
  return withEmbeddingProfileRootAccess(directory, () => withFileLock({ lockPath: path.join(descriptor.root, 'profiles.lock'), waitMs: 5000, pollMs: 25, signal,
    metadata: { scope: 'embedding-profile-retention' } }, async () => {
    let catalog = await loadCatalog(descriptor.root, { signal });
    if (!catalog) return null;
    const currentPath = path.relative(descriptor.root, descriptor.profile);
    const reservation = incomingBytes + (catalog.profiles.some(entry => entry.relativePath === currentPath) ? 0 : 4096);
    await saveCatalog(descriptor.root, { ...catalog, dirty: true });
    const retirementDeadline = Date.now() + EMBEDDING_PROFILE_LIMITS.maxInventoryMs;
    for (;;) {
      const plan = planEmbeddingProfileRetention({ inventory: { complete: true, profiles: catalog.profiles }, currentPath, incomingBytes: reservation, maxBytes, maxAgeMs });
      if (!plan.admitted) { await saveCatalog(descriptor.root, { ...catalog, dirty: false }); return null; }
      let blocked = false;
      for (const selected of plan.selected) {
        throwIfAborted(signal);
        if (Date.now() >= retirementDeadline) { await saveCatalog(descriptor.root, { ...catalog, dirty: false }); return null; }
        if (await retire(descriptor.root, selected, signal, retirementDeadline)) catalog.profiles = catalog.profiles.filter(entry => entry !== selected);
        else {
          selected.eligible = false; blocked = true;
          const marker = await readProfileMarker(descriptorFor(descriptor.root, selected));
          if (isProfileMarker(marker, descriptorFor(descriptor.root, selected))) selected.lastUse = marker.lastUse;
        }
      }
      if (!blocked) break;
    }
    if (!await ensureMarker(descriptor)) { await saveCatalog(descriptor.root, { ...catalog, dirty: false }); return null; }
    const entry = catalog.profiles.find(value => value.relativePath === currentPath);
    if (entry) entry.upperBytes += reservation;
    else catalog.profiles.push({ key: descriptor.key, relativePath: currentPath, upperBytes: reservation, lastUse: null });
    await saveCatalog(descriptor.root, { ...catalog, dirty: true });
    throwIfAborted(signal);
    const result = await withEmbeddingProfileAccess(directory, () => mutation.run({ root: rootKey(descriptor.root), profile: descriptor.profile }, action));
    const marker = await readProfileMarker(descriptor);
    for (const value of catalog.profiles) { delete value.eligible; if (value.relativePath === currentPath) value.lastUse = marker?.lastUse || null; }
    catalog = { ...catalog, dirty: false };
    await saveCatalog(descriptor.root, catalog);
    return result;
  }));
};

/** Restore observed file lengths once at a settled mode boundary, after
 * compaction/pruning. This never clears resource leases or relaxes admission. */
export const reconcileEmbeddingProfileBudget = async (directory, { signal = null } = {}) => {
  const descriptor = resolveEmbeddingProfileAccess(directory);
  if (!descriptor || descriptor.layoutVersion !== 3) return null;
  return withEmbeddingProfileRootAccess(directory, () => withFileLock({ lockPath: path.join(descriptor.root, 'profiles.lock'), waitMs: 5000, pollMs: 25, signal,
    metadata: { scope: 'embedding-profile-reconciliation' } }, () => loadCatalog(descriptor.root, { signal, reconcile: true })));
};

/** Existing-profile maintenance can reduce an over-budget cache. The same root
 * lock orders it with reservations; a failed mutation leaves dirty recovery. */
export const withEmbeddingProfileMaintenance = async (directory, action, { signal = null } = {}) => {
  const descriptor = resolveEmbeddingProfileAccess(directory);
  if (!descriptor) return action();
  if (descriptor.layoutVersion !== 3) return null;
  if (mutation.getStore()) return withEmbeddingProfileMutation(directory, 0, action, { signal });
  return withEmbeddingProfileRootAccess(directory, () => withFileLock({ lockPath: path.join(descriptor.root, 'profiles.lock'), waitMs: 5000, pollMs: 25, signal,
    metadata: { scope: 'embedding-profile-maintenance' } }, async () => {
    const catalog = await loadCatalog(descriptor.root, { signal });
    if (!catalog || !isProfileMarker(await readProfileMarker(descriptor), descriptor)) return null;
    await saveCatalog(descriptor.root, { ...catalog, dirty: true });
    const value = await withEmbeddingProfileAccess(directory, () => mutation.run({ root: rootKey(descriptor.root), profile: descriptor.profile }, action));
    // File/global indexes form one profile. Reconciliation belongs after both
    // checkpoint phases; this individual directory cannot discard their credits.
    await saveCatalog(descriptor.root, { ...catalog, dirty: false });
    return value;
  }));
};

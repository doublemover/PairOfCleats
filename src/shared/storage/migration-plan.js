import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertSafeCacheDeletion } from '../cache-deletion.js';
import { isPathWithinRoot } from '../file-paths.js';
import { STORAGE_CATEGORIES } from './layout.js';
import { inspectStorageInventory } from './inventory.js';
import { inspectStorageAccess } from './access.js';
import { readStorageLocator } from './locator.js';
import { verifyStorageFile } from './transfer.js';
import { captureStorageAuthority } from './authority.js';

export const storagePlanDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const storageMigrationOwnerProof = async (owner, input) => {
  if (!owner || typeof owner.id !== 'string' || !Number.isSafeInteger(owner.version)
    || typeof owner.inspect !== 'function' || typeof owner.verifyDestination !== 'function') {
    return { complete: false, reason: 'category-migration-owner-required' };
  }
  const receipt = await owner.inspect(input);
  if (receipt?.complete !== true || receipt.quiescent !== true || receipt.referencesPortable !== true
    || receipt.permissionsCompatible !== true || typeof receipt.identity !== 'string' || !receipt.identity) {
    return { complete: false, reason: 'category-owner-cannot-confirm-quiescence-portability-or-permissions' };
  }
  return { complete: true, id: owner.id, version: owner.version, identity: receipt.identity };
};

export const buildStorageMigrationManifest = async ({ root, maxEntries = 10000,
  maxBytes = 64 * 1024 * 1024 * 1024, maxDurationMs = 10000, signal = null,
  expectedManifest = null } = {}) => {
  const started = Date.now();
  const inventory = await inspectStorageInventory({ roots: [{ id: 'migration-source', path: root }],
    includeFiles: true, maxEntries, maxDurationMs, signal });
  if (!inventory.complete || inventory.items[0].status !== 'scanned'
    || !inventory.items[0].directories.length) throw new Error('Migration requires one completely readable source directory.');
  const item = inventory.items[0];
  if (item.logicalBytes > maxBytes) throw new Error('Migration source exceeds its admitted byte budget.');
  const files = [];
  for (const file of item.files) {
    const verified = await verifyStorageFile({ root, file: path.join(root, file.relativePath), identity: file.identity,
      maxBytes, signal, deadline: started + maxDurationMs });
    files.push({ relativePath: file.relativePath, identity: verified.identity, sha256: verified.sha256,
      logicalBytes: verified.bytes, allocatedBytes: file.allocatedBytes,
      hardlinkPolicy: file.identity.nlink > 1 ? 'independent-copy-retain-source-links' : 'copy' });
  }
  const manifest = { schemaVersion: 1, rootIdentity: item.identity, files,
    directories: item.directories.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    logicalBytes: item.logicalBytes, allocatedBytes: item.allocatedBytes };
  if (expectedManifest && storagePlanDigest(manifest) !== storagePlanDigest(expectedManifest)) throw new Error('Migration source changed since preview.');
  return manifest;
};

/** No writes, adoption, source deletion, lease reaping or whole-disk search. */
export const createStorageMigrationPlan = async ({ category, source, destination, home, recoveryRoot,
  authorityRoots = [], coordinationRoot = null, owner = null, signal = null,
  maxEntries = 10000, maxBytes = 64 * 1024 * 1024 * 1024, maxDurationMs = 10000 } = {}) => {
  if (!Object.hasOwn(STORAGE_CATEGORIES, category) || ['cache', 'repos', 'cas', 'state', 'config'].includes(category)) {
    throw new Error('This category requires its generation/registry/CAS-specific migration owner; generic tree migration is unavailable.');
  }
  const locations = Object.fromEntries(Object.entries({ source, destination, home, recoveryRoot })
    .map(([key, value]) => {
      if (typeof value !== 'string' || !path.isAbsolute(value)) throw new TypeError(`Migration ${key} must be absolute.`);
      return [key, path.resolve(value)];
    }));
  if (isPathWithinRoot(locations.source, locations.destination) || isPathWithinRoot(locations.destination, locations.source)) {
    throw new Error('Migration source and destination must not overlap.');
  }
  const blocked = [];
  let authoritySnapshots = [];
  try { authoritySnapshots = await captureStorageAuthority(authorityRoots); }
  catch (error) { blocked.push({ role: 'authority', reason: 'unproven-storage-authority', message: error.message }); }
  for (const [role, target] of Object.entries(locations)) {
    try { assertSafeCacheDeletion(target, authorityRoots); }
    catch (error) { blocked.push({ role, reason: 'unproven-storage-authority', code: error.code || 'ERR_STORAGE_AUTHORITY' }); }
  }
  const access = await inspectStorageAccess(locations.source, { coordinationRoot });
  if (access.protected) blocked.push({ role: 'source', reason: 'active-or-unknown-lease' });
  const ownerProof = await storageMigrationOwnerProof(owner, { category, ...locations, phase: 'plan', signal });
  if (!ownerProof.complete) blocked.push({ role: 'source', reason: ownerProof.reason });
  const locator = readStorageLocator(locations.home);
  if (locator.status === 'invalid') blocked.push({ role: 'locator', reason: 'invalid-current-locator' });
  let manifest = null;
  try { manifest = await buildStorageMigrationManifest({ root: locations.source, maxEntries, maxBytes, maxDurationMs, signal }); }
  catch (error) { blocked.push({ role: 'source', reason: 'incomplete-or-changed-manifest', message: error.message }); }
  const body = { schemaVersion: 1, kind: 'pairofcleats-storage-migration-plan', category, ...locations,
    coordinationRoot, owner: ownerProof, manifest, blocked, ready: blocked.length === 0,
    authoritySnapshots,
    locatorBeforeHash: locator.sha256, priorSelection: locator.value?.categories?.[category] || null,
    limits: { maxEntries, maxBytes, maxDurationMs },
    requiredFreeBytes: manifest?.logicalBytes ?? null,
    diskSpaceStatus: 'operator-or-category-owner-check-required-before-apply',
    sourceRetention: 'preserve-until-separate-explicit-cleanup; no automatic source deletion',
    rebasePolicy: 'declared-category-locator-only; opaque-evidence-and-content-unchanged',
    rollback: 'verify-source-and-destination-then-restore-category-selection; retain-both-copies' };
  return { ...body, planId: storagePlanDigest(body), dryRun: true };
};

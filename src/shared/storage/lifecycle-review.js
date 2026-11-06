import { STORAGE_CLASS_CATALOG } from './catalog.js';
import { decideStorageLifecycle } from './policy.js';
import { isPathWithinRoot } from '../file-paths.js';

/** Read-only projection of the existing inventory and existing owner diagnosis.
 * Root registration/intent is not category deletion or reachability authority.
 * No traversal, touch, lease acquisition, cleanup, free-space probe or second
 * per-hit inventory is performed here.
 */
export const reviewStorageLifecycle = ({ layout, inventory, leaseInventory = [], maxRoots = 128 } = {}) => {
  if (!layout?.descriptors || !Array.isArray(inventory?.items) || inventory.items.length > 1024
    || !Array.isArray(leaseInventory) || leaseInventory.length > 1024
    || !Number.isSafeInteger(maxRoots) || maxRoots < 1 || maxRoots > 1024) throw new TypeError('Bounded original storage observations required.');
  const ownersById = new Map();
  for (const lease of leaseInventory) for (const id of lease.registeredIds ?? []) {
    if (!ownersById.has(id)) ownersById.set(id, []); ownersById.get(id).push(lease);
  }
  const classesByCategory = new Map();
  for (const entry of STORAGE_CLASS_CATALOG) {
    if (!classesByCategory.has(entry.category)) classesByCategory.set(entry.category, []);
    classesByCategory.get(entry.category).push(entry.id);
  }
  const roots = inventory.items.slice(0, maxRoots).map((item, inventoryIndex) => {
    const descriptor = layout.descriptors[item.category], matches = ownersById.get(item.id) ?? [];
    const lease = { complete: matches.length > 0 && matches.every(row => row.complete === true),
      protected: !matches.length || matches.some(row => row.protected !== false) };
    const retention = item.retention ?? descriptor?.retention ?? 'unknown';
    const external = descriptor?.external === true || Boolean(item.path && layout.home?.path && !isPathWithinRoot(item.path, layout.home.path));
    const decision = decideStorageLifecycle({ complete: item.complete === true, ownerQualified: false, retention,
      external, lease, references: { complete: false, retained: true } });
    return { inventoryIndex, id: item.id, category: item.category ?? null, retention,
      classIntentIds: classesByCategory.get(item.category) ?? [],
      status: item.status, inventoryComplete: item.complete === true,
      logicalAttributedBytes: Number.isSafeInteger(item.logicalBytes) ? item.logicalBytes : null,
      allocatedAttributedBytes: Number.isSafeInteger(item.allocatedBytes) ? item.allocatedBytes : null,
      externalLocation: external, categoryOwnerQualified: false,
      sourceReferences: 'not-established-by-root-inventory',
      observedOwners: matches.length, ownerObservationComplete: lease.complete,
      activeOrUnknownOwner: lease.protected,
      cleanupEligible: decision.eligible, blockers: decision.reasons, impact: decision.impact };
  });
  return { schemaVersion: 1, kind: 'storage-lifecycle-observation', mutationPerformed: false,
    inventoryComplete: inventory.complete === true, registeredRoots: inventory.items.length, roots,
    omittedRegisteredRoots: inventory.items.length - roots.length, registeredRootCoverageComplete: roots.length === inventory.items.length,
    accounting: { source: 'same-original-inventory; no-rescan',
      logicalAttributedBytes: inventory.totals?.logicalAttributedBytes ?? null,
      uniqueLogicalBytes: inventory.totals?.uniqueLogicalBytes ?? null,
      uniqueAllocatedBytes: inventory.totals?.uniqueAllocatedBytes ?? null,
      reclaimableAllocatedBytes: null, plannedDeletions: 0 },
    quotaAdmission: 'not-established; selected-policy-and-category-owner-required',
    authority: 'registered-intent-and-existing-owner-observations-only',
    preservation: ['durable evidence and references', 'pinned/forensic assets', 'offline model/tool assets without explicit eviction',
      'mixed, unqualified and uninspected data', 'active/unknown original resources'],
    nextAction: 'Use the existing category inventory/cleanup-plan for producer, references and lease qualification; root registration alone cannot authorize cleanup.' };
};

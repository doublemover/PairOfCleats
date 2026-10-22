import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { STORAGE_CLASS_CATALOG } from './catalog.js';
import { inspectStorageOwnership, inspectStorageInventory } from './inventory.js';
import { inspectStorageAccess } from './access.js';
export { planStorageConfiguration, applyStorageConfiguration } from './configuration.js';

/** Root metadata only; scan bytes explicitly with exact=true. */
export const inspectStorageLayout = async (layout, { exact = false, extraRoots = [], maxEntries = 100000,
  maxDurationMs = 10000, signal = null } = {}) => {
  const roots = [...Object.values(layout.descriptors).map(descriptor => ({ ...descriptor, id: descriptor.category })), ...extraRoots];
  if (exact) return inspectStorageInventory({ roots, maxEntries, maxDurationMs, signal });
  const items = [];
  for (const root of roots) {
    if (signal?.aborted) break;
    try {
      assertNoSymlinkPath(path.parse(root.path).root, root.path);
      const stat = await fs.lstat(root.path, { bigint: true });
      items.push({ id: root.id, category: root.category, path: root.path, registered: true,
        status: stat.isDirectory() ? 'present-unscanned' : 'unexpected-file',
        physicalPath: await fs.realpath(root.path), ownership: stat.isDirectory() ? await inspectStorageOwnership(root.path) : null,
        retention: root.retention || 'unknown', logicalBytes: null, allocatedBytes: null, complete: false });
    } catch (error) { items.push({ id: root.id, category: root.category, path: root.path, registered: true,
      status: error.code === 'ENOENT' ? 'missing' : 'inaccessible', logicalBytes: null, allocatedBytes: null,
      complete: false, error: { code: error.code, message: error.message } }); }
  }
  return { schemaVersion: 1, scanMode: 'registered-roots-metadata-only', timestamp: new Date().toISOString(),
    complete: false, cancelled: Boolean(signal?.aborted), items,
    accounting: 'registered-locations-are-not-measured-disk-usage' };
};

export const explainStorageLayout = layout => ({ schemaVersion: 1, layout,
  classes: STORAGE_CLASS_CATALOG, mutationPerformed: false,
  adoption: 'Version 2 descriptors are available. Existing defaults remain at their legacy locations until a verified category cutover is selected.',
  externalExceptions: STORAGE_CLASS_CATALOG.filter(entry => entry.category === null) });

export const diagnoseStorageLayout = async (layout, options = {}) => {
  const inventory = await inspectStorageLayout(layout, { ...options, exact: false });
  const findings = [...layout.diagnostics];
  for (const item of inventory.items) {
    if (item.status === 'inaccessible') findings.push({ category: item.category, code: 'inaccessible-or-offline-root', path: item.path, error: item.error });
    if (item.ownership?.status && item.ownership.status !== 'marked') findings.push({ category: item.category,
      code: 'ownership-not-proven', path: item.path, operations: 'inspect-only-until-explicit-adoption' });
    if (path.basename(item.path).toLowerCase() === 'cache' && path.basename(path.dirname(item.path)).toLowerCase() === 'cache') {
      findings.push({ category: item.category, code: 'nested-cache-cache', path: item.path });
    }
  }
  const leases = await inspectStorageAccess(layout.descriptors.models.path, {
    coordinationRoot: path.join(layout.descriptors.state.path, 'storage-access') });
  if (leases.protected) findings.push({ category: 'models', code: 'active-or-unknown-storage-owner', owners: leases.owners });
  return { schemaVersion: 1, timestamp: new Date().toISOString(), findings, inventory,
    leaseCoverage: leases.coverage, mutationPerformed: false, installsPerformed: false, fullIndexScansPerformed: false };
};


import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { STORAGE_CLASS_CATALOG } from './catalog.js';
import { inspectStorageOwnership, inspectStorageInventory } from './inventory.js';
import { inspectStorageAccess } from './access.js';
import { readStorageProbePolicy } from './probe-policy-read.js';
import { inspectStorageRootFailure } from './root-availability.js';
export { planStorageConfiguration, applyStorageConfiguration } from './configuration.js';

/** Root metadata only; scan bytes explicitly with exact=true. */
export const inspectStorageLayout = async (layout, { exact = false, extraRoots = [], maxEntries = 100000,
  maxDurationMs = 10000, signal = null, category = null } = {}) => {
  if (!Array.isArray(extraRoots) || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) throw new TypeError('Invalid bounded storage inspection.');
  if (category !== null && !Object.hasOwn(layout.descriptors, category)) throw new TypeError('Unknown logical storage category filter.');
  const roots = [...Object.values(layout.descriptors).map(descriptor => ({ ...descriptor, id: descriptor.category })), ...extraRoots]
    .filter(root => category === null || root.category === category);
  if (exact) return inspectStorageInventory({ roots, maxEntries, maxDurationMs, signal });
  if (roots.length > 1024) throw new TypeError('Storage inspection requires at most 1024 registered roots.');
  const items = [];
  const started = Date.now();
  let visitedEntries = 0;
  let stopReason = null;
  for (const root of roots) {
    if (signal?.aborted) stopReason = 'cancelled';
    else if (visitedEntries >= maxEntries) stopReason ||= 'entry-budget';
    else if (Date.now() - started >= maxDurationMs) stopReason ||= 'time-budget';
    if (stopReason) {
      items.push({ id: root.id, category: root.category, path: root.path, registered: true,
        status: 'unscanned', reason: stopReason, logicalBytes: null, allocatedBytes: null, complete: false });
      continue;
    }
    visitedEntries++;
    try {
      assertNoSymlinkPath(path.parse(root.path).root, root.path);
      const stat = await fs.lstat(root.path, { bigint: true });
      items.push({ id: root.id, category: root.category, path: root.path, registered: true,
        status: stat.isDirectory() ? 'present-unscanned' : 'unexpected-file',
        physicalPath: await fs.realpath(root.path), ownership: stat.isDirectory() ? await inspectStorageOwnership(root.path) : null,
        retention: root.retention || 'unknown', logicalBytes: null, allocatedBytes: null, complete: false });
    } catch (error) { items.push({ id: root.id, category: root.category, path: root.path, registered: true,
      ...await inspectStorageRootFailure(root.path, error), logicalBytes: null, allocatedBytes: null,
      complete: false, error: { code: error.code, message: error.message } }); }
  }
  return { schemaVersion: 1, scanMode: 'registered-roots-metadata-only', timestamp: new Date().toISOString(),
    complete: false, cancelled: Boolean(signal?.aborted), items, stopReason, visitedEntries,
    limits: { maxEntries, maxDurationMs },
    accounting: 'registered-locations-are-not-measured-disk-usage' };
};

export const explainStorageLayout = layout => ({ schemaVersion: 1, layout,
  commandProbePolicy: readStorageProbePolicy(layout.home.path),
  classes: STORAGE_CLASS_CATALOG, mutationPerformed: false,
  adoption: 'Version 2 descriptors are available. Existing defaults remain at their legacy locations until a verified category cutover is selected.',
  externalExceptions: STORAGE_CLASS_CATALOG.filter(entry => entry.category === null) });

export const diagnoseStorageLayout = async (layout, options = {}) => {
  const started = Date.now();
  const maxDurationMs = options.maxDurationMs ?? 10000;
  const maxEntries = options.maxEntries ?? 100000;
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('Storage diagnosis requires positive bounded limits.');
  }
  const inventory = await inspectStorageLayout(layout, { ...options, exact: false });
  const findings = [...layout.diagnostics];
  const commandProbePolicy = readStorageProbePolicy(layout.home.path);
  if (commandProbePolicy.status === 'invalid') findings.push({ category: 'command-probes', code: 'invalid-machine-storage-policy',
    path: commandProbePolicy.target, error: commandProbePolicy.error, operations: 'cache-use-bypassed; existing-bytes-preserved' });
  for (const item of inventory.items) {
    if (['inaccessible', 'unavailable-or-offline'].includes(item.status)) findings.push({ category: item.category,
      code: 'inaccessible-or-offline-root', path: item.path, error: item.error, volume: item.volume });
    if (item.ownership?.status && item.ownership.status !== 'marked') findings.push({ category: item.category,
      code: 'ownership-not-proven', path: item.path, operations: 'inspect-only-until-explicit-adoption' });
    if (path.basename(item.path).toLowerCase() === 'cache' && path.basename(path.dirname(item.path)).toLowerCase() === 'cache') {
      findings.push({ category: item.category, code: 'nested-cache-cache', path: item.path });
    }
  }
  // The actual session owners use the fixed home/state coordinator. A future
  // state descriptor alone cannot move that protocol's persisted namespace.
  const coordinationRoot = path.join(layout.home.path, 'state', 'storage-access');
  const selected = [...Object.values(layout.descriptors).map(descriptor => ({ ...descriptor,
    id: descriptor.category, access: { root: descriptor.path, coordinationRoot } })), ...(options.extraRoots || [])];
  const roots = new Map();
  for (const selectedRoot of selected) {
    const access = selectedRoot.access || { root: selectedRoot.path, coordinationRoot };
    if (!path.isAbsolute(access.root || '') || (access.coordinationRoot !== null && !path.isAbsolute(access.coordinationRoot || ''))) {
      throw new TypeError('Storage diagnosis access scope must name exact absolute roots.');
    }
    const root = path.resolve(access.root);
    const coordinator = access.coordinationRoot === null ? null : path.resolve(access.coordinationRoot);
    const key = JSON.stringify([root, coordinator]);
    const existing = roots.get(key);
    if (existing) {
      existing.categories.add(selectedRoot.category);
      existing.registeredIds.add(selectedRoot.id || selectedRoot.category);
    } else roots.set(key, { path: root, coordinationRoot: coordinator,
      categories: new Set([selectedRoot.category]), registeredIds: new Set([selectedRoot.id || selectedRoot.category]) });
  }
  const leaseInventory = [];
  let leaseStopReason = null;
  for (const root of roots.values()) {
    if (options.signal?.aborted) { leaseStopReason = 'cancelled'; break; }
    if (Date.now() - started >= maxDurationMs) { leaseStopReason = 'time-budget'; break; }
    if (leaseInventory.length >= Math.min(1024, maxEntries)) { leaseStopReason = 'registered-root-budget'; break; }
    const leases = await inspectStorageAccess(root.path, root.coordinationRoot ? { coordinationRoot: root.coordinationRoot } : {});
    leaseInventory.push({ ...root, categories: [...root.categories], registeredIds: [...root.registeredIds], ...leases });
    if (leases.protected) findings.push({ category: [...root.categories].join(','), code: 'active-or-unknown-storage-owner',
      path: root.path, coordinationRoot: root.coordinationRoot, owners: leases.owners });
  }
  if (leaseStopReason) findings.push({ code: 'storage-owner-inspection-incomplete', reason: leaseStopReason,
    remainingRegisteredRoots: roots.size - leaseInventory.length, operations: 'uninspected-owners-remain-unknown' });
  return { schemaVersion: 1, timestamp: new Date().toISOString(), findings, inventory,
    commandProbePolicy, leaseInventory, leaseStopReason,
    leaseInspectionComplete: !leaseStopReason && leaseInventory.every(item => item.complete),
    leaseCoverage: 'existing-repo-access-protocol-only',
    leaseLimitation: 'Exact registered roots only; each existing owner scan has its own entry bound. Unadopted and CAS-specific protocols are not inferred.',
    mutationPerformed: false, installsPerformed: false, fullIndexScansPerformed: false };
};


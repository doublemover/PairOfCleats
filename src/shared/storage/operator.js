import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { STORAGE_CLASS_CATALOG } from './catalog.js';
import { inspectStorageOwnership, inspectStorageInventory } from './inventory.js';
import { inspectStorageAccess } from './access.js';
import { readStorageProbePolicy } from './probe-policy-read.js';
import { inspectStorageRootFailure } from './root-availability.js';
import { describeStorageFailure } from './failure-observation.js';
import { reviewStorageLifecycle } from './lifecycle-review.js';
import { createStorageInspectionAdmission } from './inspection-admission.js';
export { planStorageConfiguration, applyStorageConfiguration } from './configuration.js';

/** Root metadata only; scan bytes explicitly with exact=true. */
const inspectLayout = async (layout, { exact = false, extraRoots = [], maxEntries = 100000,
  maxDurationMs = 10000, signal = null, category = null } = {}, originalAdmission = null) => {
  if (!Array.isArray(extraRoots) || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) throw new TypeError('Invalid bounded storage inspection.');
  if (category !== null && !Object.hasOwn(layout.descriptors, category)) throw new TypeError('Unknown logical storage category filter.');
  const roots = [...Object.values(layout.descriptors).map(descriptor => ({ ...descriptor, id: descriptor.category })), ...extraRoots]
    .filter(root => category === null || root.category === category);
  if (exact) {
    const inventory = await inspectStorageInventory({ roots, maxEntries, maxDurationMs, signal });
    return { ...inventory, lifecycle: reviewStorageLifecycle({ layout, inventory }) };
  }
  if (roots.length > 1024) throw new TypeError('Storage inspection requires at most 1024 registered roots.');
  const admission = originalAdmission ?? createStorageInspectionAdmission(maxDurationMs, signal);
  const checks = { check: admission.check, signal, stop: admission.stop };
  const items = [];
  let visitedEntries = 0;
  for (const root of roots) {
    const unscanned = () => ({ id: root.id, category: root.category, path: root.path, registered: true,
      status: 'unscanned', reason: admission.reason, logicalBytes: null, allocatedBytes: null, complete: false });
    try {
      admission.check();
      if (visitedEntries >= maxEntries) admission.stopFor('entry-budget');
      visitedEntries++;
      assertNoSymlinkPath(path.parse(root.path).root, root.path);
      admission.check();
      const stat = await fs.lstat(root.path, { bigint: true });
      admission.check();
      const physicalPath = await fs.realpath(root.path);
      admission.check();
      const ownership = stat.isDirectory() ? await inspectStorageOwnership(root.path, checks) : null;
      admission.check();
      items.push({ id: root.id, category: root.category, path: root.path, registered: true,
        status: stat.isDirectory() ? 'present-unscanned' : 'unexpected-file',
        physicalPath, ownership,
        retention: root.retention || 'unknown', logicalBytes: null, allocatedBytes: null, complete: false });
    } catch (error) {
      if (admission.isStop(error)) { items.push(unscanned()); continue; }
      // Retain pending original resources before a stopped admission can turn
      // an ordinary root failure into an unscanned observation.
      const failure = describeStorageFailure(error, { phase: 'storage-layout-inspection', defaultCode: 'ERR_STORAGE_INSPECTION' });
      try {
        const availability = await inspectStorageRootFailure(root.path, error, checks);
        admission.check();
        items.push({ id: root.id, category: root.category, path: root.path, registered: true,
          ...availability, logicalBytes: null, allocatedBytes: null, complete: false, error: failure });
      } catch (inspection) {
        if (!admission.isStop(inspection)) throw inspection;
        items.push(unscanned());
      }
    }
  }
  const inventory = { schemaVersion: 1, scanMode: 'registered-roots-metadata-only', timestamp: new Date().toISOString(),
    complete: false, cancelled: admission.reason === 'cancelled', items, stopReason: admission.reason, visitedEntries,
    limits: { maxEntries, maxDurationMs },
    accounting: 'registered-locations-are-not-measured-disk-usage' };
  return { ...inventory, lifecycle: reviewStorageLifecycle({ layout, inventory }) };
};
export const inspectStorageLayout = (layout, options = {}) => inspectLayout(layout, options);

export const explainStorageLayout = layout => ({ schemaVersion: 1, layout,
  commandProbePolicy: readStorageProbePolicy(layout.home.path),
  classes: STORAGE_CLASS_CATALOG, mutationPerformed: false,
  adoption: 'Version 2 descriptors are available. Existing defaults remain at their legacy locations until a verified category cutover is selected.',
  externalExceptions: STORAGE_CLASS_CATALOG.filter(entry => entry.category === null) });

export const diagnoseStorageLayout = async (layout, options = {}) => {
  const maxDurationMs = options.maxDurationMs ?? 10000;
  const maxEntries = options.maxEntries ?? 100000;
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new TypeError('Storage diagnosis requires positive bounded limits.');
  }
  const admission = createStorageInspectionAdmission(maxDurationMs, options.signal);
  const inventory = await inspectLayout(layout, { ...options, exact: false }, admission);
  const findings = [...layout.diagnostics];
  let commandProbePolicy = null;
  try { admission.check(); commandProbePolicy = readStorageProbePolicy(layout.home.path, { check: admission.check }); admission.check(); }
  catch (error) { if (!admission.isStop(error)) throw error; }
  if (commandProbePolicy?.status === 'invalid') findings.push({ category: 'command-probes', code: 'invalid-machine-storage-policy',
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
    let leases;
    try {
      admission.check();
      if (leaseInventory.length >= Math.min(1024, maxEntries)) admission.stopFor('registered-root-budget');
      leases = await inspectStorageAccess(root.path, { ...(root.coordinationRoot ? { coordinationRoot: root.coordinationRoot } : {}),
        check: admission.check, signal: options.signal });
      admission.check();
    } catch (error) { if (!admission.isStop(error)) throw error; leaseStopReason = admission.reason; break; }
    leaseInventory.push({ ...root, categories: [...root.categories], registeredIds: [...root.registeredIds], ...leases });
    if (leases.protected) findings.push({ category: [...root.categories].join(','), code: 'active-or-unknown-storage-owner',
      path: root.path, coordinationRoot: root.coordinationRoot, owners: leases.owners });
  }
  if (leaseStopReason) findings.push({ code: 'storage-owner-inspection-incomplete', reason: leaseStopReason,
    remainingRegisteredRoots: roots.size - leaseInventory.length, operations: 'uninspected-owners-remain-unknown' });
  return { schemaVersion: 1, timestamp: new Date().toISOString(), findings,
    inventory: { ...inventory, lifecycle: reviewStorageLifecycle({ layout, inventory, leaseInventory }) },
    commandProbePolicy, commandProbePolicyInspected: commandProbePolicy !== null, leaseInventory, leaseStopReason,
    leaseInspectionComplete: !leaseStopReason && leaseInventory.every(item => item.complete),
    leaseCoverage: 'existing-repo-access-protocol-only',
    leaseLimitation: 'Exact registered roots only; each existing owner scan has its own entry bound. Unadopted and CAS-specific protocols are not inferred.',
    mutationPerformed: false, installsPerformed: false, fullIndexScansPerformed: false };
};


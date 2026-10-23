import path from 'node:path';
import { inspectStorageCategory, STORAGE_INVENTORY_ADAPTERS } from './category-inventory.js';

/** Scope only the diagnostic inputs of existing owners. This does not resolve
 * new storage, adopt a requested path or grant cleanup/migration authority.
 */
export const resolveStorageDiagnosticScope = ({ action, argv, layout, legacy, currentCache }) => {
  const category = argv.category || null;
  const adapter = STORAGE_INVENTORY_ADAPTERS.includes(category);
  if (category && !adapter && !Object.hasOwn(layout.descriptors, category)) throw new Error('Unknown logical storage category or inventory adapter.');
  if (adapter && ['list', 'explain'].includes(action)) throw new Error('Use storage inspect or doctor for a category inventory adapter.');
  if (argv.path && !adapter) throw new Error('Explicit diagnostic --path requires a category inventory adapter; logical category roots come from the selected layout.');
  if (argv.plan && category !== 'embedding-profiles') throw new Error('Diagnostic --plan is a read-only embedding-profiles request only.');
  const descriptors = category && !adapter ? { [category]: layout.descriptors[category] } : layout.descriptors;
  const diagnostics = category && !adapter ? layout.diagnostics.filter(entry => !entry.category || entry.category === category) : layout.diagnostics;
  const extraRoots = category && !adapter ? legacy.filter(entry => entry.category === category) : legacy;
  const root = adapter ? argv.path || (category === 'command-probes'
    ? path.join(currentCache || layout.descriptors.cache.path, 'tooling', 'command-probes')
    : legacy.find(entry => entry.id === (category === 'dictionaries' ? 'legacy-dictionaries' : 'legacy-tooling'))?.path) : null;
  if (category === 'embedding-profiles' && !argv.path) throw new Error('Embedding profile inspection requires an explicit --path and full-identity --plan request.');
  return { adapter, root, layout: { ...layout, descriptors, diagnostics }, extraRoots,
    inspectionScope: { category, kind: adapter ? 'registered-category-owner' : 'logical-layout-descriptors',
      path: root, mutationAuthority: false } };
};

export const diagnoseStorageCategory = async options => {
  const inventory = await inspectStorageCategory(options);
  const findings = [];
  if (inventory.policy?.status === 'invalid') findings.push({ category: options.category, code: 'invalid-machine-storage-policy',
    path: inventory.policy.target, error: inventory.policy.error, operations: 'cache-use-bypassed; existing-bytes-preserved' });
  if (inventory.lease?.protected || inventory.lease?.complete === false) findings.push({ category: options.category,
    code: 'active-or-unknown-storage-owner', path: inventory.path, owners: inventory.lease.owners });
  if (inventory.complete !== true) findings.push({ category: options.category, code: 'category-inventory-incomplete',
    path: inventory.path, status: inventory.status || inventory.stopReason || 'unqualified-or-incomplete-owner-evidence',
    operations: 'existing-bytes-retained; no-cleanup-or-migration-authority' });
  return { schemaVersion: 1, timestamp: new Date().toISOString(), category: options.category, path: inventory.path,
    findings, inventory, complete: inventory.complete === true, mutationPerformed: false,
    installsPerformed: false, fullIndexScansPerformed: false, cleanupAuthority: false,
    qualification: 'Read-only category evidence; failed, unknown and protected bytes remain retained. No owner is recovered or tool executed.' };
};

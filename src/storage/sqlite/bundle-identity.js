import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';

/** Source hashes cannot identify finalized cross-file metadata. Bind every
 * selected immutable shard and its producer dependencies in wire order. */
export const sqliteBundleIdentity = entry => {
  if (!Array.isArray(entry?.bundleInventory) || !entry.bundleInventory.length) return null;
  return createHash('sha256').update(stableStringify({ schemaVersion: 1,
    format: entry.bundleFormat || 'json', parts: entry.bundleInventory,
    dependencies: entry.dependencySignatures || null })).digest('hex');
};

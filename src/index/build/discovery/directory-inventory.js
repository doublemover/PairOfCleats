import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinRoot } from '../../../shared/file-paths.js';

const inventories = new WeakMap();
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIRECTORIES = 4096;
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const stamp = stat => ['dev', 'ino', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));
const sameStamp = (left, right) => left.every((value, index) => value === right[index]);
const knownDirectory = stat => stat.isDirectory() && !stat.isSymbolicLink() && stat.ino !== 0n;

/** Bounded, invocation-owned raw directory facts. Policy filtering occurs after
 * enumeration, so consumers never infer completeness from selected code files.
 * No persistent/root-global cache or serializable completeness authority. */
export const createDiscoveryDirectoryInventory = ({ root, canonicalRoot, metrics = {} }) => {
  const state = { root: pathKey(root), canonicalRoot: pathKey(canonicalRoot), directories: new Map(), bytes: 0, sealed: false };
  const updateMetrics = () => {
    metrics.directoryInventoryBytes = state.bytes;
    metrics.directoryInventoryDirectories = state.directories.size;
  };
  return Object.freeze({
    beginDirectory(directory, before, canonicalDirectory) {
      if (state.sealed || state.directories.size >= MAX_DIRECTORIES || !knownDirectory(before)) return null;
      const key = pathKey(directory);
      if (!isPathWithinRoot(path.resolve(directory), path.resolve(root))) return null;
      const beforeStamp = stamp(before), rows = [];
      let bytes = Buffer.byteLength(directory) + Buffer.byteLength(canonicalDirectory) + 192, active = true;
      const cancel = () => {
        if (!active) return;
        active = false; state.bytes -= bytes; rows.length = 0; updateMetrics();
      };
      if (state.bytes + bytes > MAX_BYTES) return null;
      state.bytes += bytes; updateMetrics();
      return Object.freeze({
        add(row) {
          if (!active) return;
          const size = Buffer.byteLength(row.name) + 48;
          if (state.bytes + size > MAX_BYTES) { cancel(); return; }
          rows.push(Object.freeze({ name: row.name, kind: row.kind }));
          bytes += size; state.bytes += size; updateMetrics();
        },
        complete(after) {
          if (!active) return;
          if (!knownDirectory(after) || !sameStamp(beforeStamp, stamp(after)) || state.directories.has(key)) { cancel(); return; }
          active = false;
          state.directories.set(key, Object.freeze({ directory, canonicalDirectory: pathKey(canonicalDirectory),
            stamp: Object.freeze(beforeStamp), rows: Object.freeze(rows) }));
          updateMetrics();
        },
        cancel
      });
    },
    seal(entries) {
      state.sealed = true;
      if (Array.isArray(entries) && state.directories.size) inventories.set(entries, state);
      updateMetrics();
    }
  });
};

/** Array transformations must deliberately forward the actual producer's facts.
 * Copies of record fields cannot reconstruct directory completeness. */
export const forwardDiscoveryDirectoryInventory = (source, target) => {
  const inventory = Array.isArray(source) ? inventories.get(source) : null;
  if (inventory && Array.isArray(target)) inventories.set(target, inventory);
  return target;
};

export const createDiscoveryDirectoryInventoryReader = async (entries, root) => {
  const inventory = Array.isArray(entries) ? inventories.get(entries) : null;
  if (!inventory?.sealed || inventory.root !== pathKey(root)) return null;
  let rootMatches = false;
  try { rootMatches = pathKey(await fs.realpath(root)) === inventory.canonicalRoot; }
  catch { /* Keep the original binding, but admit no rows from a changed root. */ }
  const current = async snapshot => {
    try {
      const stat = await fs.lstat(snapshot.directory, { bigint: true });
      return knownDirectory(stat) && sameStamp(snapshot.stamp, stamp(stat))
        && pathKey(await fs.realpath(snapshot.directory)) === snapshot.canonicalDirectory;
    } catch { return false; }
  };
  return Object.freeze({
    async read(directory) {
      if (!rootMatches) return null;
      const snapshot = inventory.directories.get(pathKey(directory));
      return snapshot && await current(snapshot) ? snapshot : null;
    },
    current
  });
};

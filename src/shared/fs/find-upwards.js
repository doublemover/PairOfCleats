import fsSync from 'node:fs';
import path from 'node:path';

const realpath = (value) => {
  try {
    if (typeof fsSync.realpathSync?.native === 'function') {
      return fsSync.realpathSync.native(value);
    }
    return fsSync.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
};

/**
 * Walk upward from a starting directory until a predicate matches.
 * The stop directory comparison is realpath-aware to avoid symlink drift.
 * @param {string} startDir
 * @param {(dir:string, canonicalDir:string) => boolean} predicate
 * @param {string|null} [stopDir]
 * @returns {string|null}
 */
export const findUpwards = (startDir, predicate, stopDir = null) => {
  if (typeof predicate !== 'function') return null;
  let current = path.resolve(startDir || process.cwd());
  const stopCanonical = stopDir ? realpath(path.resolve(stopDir)) : null;
  const visited = new Set();
  while (true) {
    const canonical = realpath(current);
    if (visited.has(canonical)) break;
    visited.add(canonical);
    if (predicate(current, canonical)) return current;
    if (stopCanonical && canonical === stopCanonical) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

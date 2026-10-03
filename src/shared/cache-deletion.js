import path from 'node:path';
import fs from 'node:fs';
import { isPathWithinRoot, isRootPath } from './file-paths.js';
import { assertNoSymlinkPath } from './contained-file.js';

/** Validate all targets before deleting any. Roots must be launch/user-owned. */
export const CACHE_OWNER_FILE = '.pairofcleats-cache-owner.json';

export const assertSafeCacheDeletion = (target, roots, { allowUnmarked = false } = {}) => {
  const resolved = path.resolve(target);
  if (isRootPath(resolved)) throw new Error('Refusing to delete a filesystem root.');
  const candidates = roots.filter(Boolean).map((entry) => path.resolve(entry))
    .filter((entry) => isPathWithinRoot(resolved, entry) && fs.existsSync(entry));
  const root = candidates.find((entry) => {
    if (allowUnmarked) return true;
    const marker = path.join(entry, CACHE_OWNER_FILE);
    try {
      assertNoSymlinkPath(path.parse(entry).root, marker);
      const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
      return record.owner === 'pairofcleats' && record.layoutVersion === 1;
    } catch { return false; }
  });
  if (!root) throw new Error('Cleanup target is outside user-authorized PairOfCleats storage.');
  // Approved lexical roots must not be reinterpreted through a parent link.
  assertNoSymlinkPath(path.parse(root).root, root);
  assertNoSymlinkPath(root, resolved, { allowMissing: true });
  return resolved;
};

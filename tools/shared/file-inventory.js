import fs from 'node:fs/promises';
import path from 'node:path';
import { listFilesRecursive } from './fs-utils.js';

const within = (file, root) => file === root || file.startsWith(root + '/');
const normalize = value => String(value).replaceAll('\\', '/').replace(/\/+$/, '');
/** One operation-owned inventory over nonoverlapping approved roots. */
export const createScopedFileInventory = async (root, roots, { include = null, files = [] } = {}) => {
  const requested = [...new Set(roots.map(normalize))];
  const admitted = requested.filter(candidate => !requested.some(other => other !== candidate && within(candidate, other)));
  const paths = new Set();
  for (const relative of admitted) {
    try {
      const entries = await listFilesRecursive(path.join(root, relative), { baseDir: root, include });
      for (const entry of entries) paths.add(normalize(entry.relPath));
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  // Explicit source files do not authorize walking their entire parent/root.
  for (const relative of files.map(normalize)) {
    if (admitted.some(scope => within(relative, scope))) continue;
    try { if ((await fs.lstat(path.join(root, relative))).isFile()) paths.add(relative); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  const ordered = [...paths].sort();
  const lowerBound = value => {
    let low = 0, high = ordered.length;
    while (low < high) { const middle = (low + high) >>> 1; if (ordered[middle] < value) low = middle + 1; else high = middle; }
    return low;
  };
  return Object.freeze({
    has: relative => paths.has(normalize(relative)),
    under(relative) {
      const normalized = normalize(relative), prefix = normalized + '/';
      const selected = paths.has(normalized) ? [normalized] : [];
      for (let index = lowerBound(prefix); index < ordered.length && ordered[index].startsWith(prefix); index += 1) selected.push(ordered[index]);
      return selected;
    }
  });
};

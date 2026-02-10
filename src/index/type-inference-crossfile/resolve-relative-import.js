import path from 'node:path';
import { toPosix } from '../../shared/files.js';
import { resolveRelativeImportCandidate } from '../shared/import-candidates.js';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export const resolveRelativeImport = (importerFile, spec, fileSet) => {
  if (!importerFile || !spec) return null;
  const rawSpec = String(spec);
  if (!rawSpec.startsWith('./') && !rawSpec.startsWith('../')) return null;
  const importer = toPosix(importerFile);
  const baseDir = path.posix.dirname(importer);
  const normalized = path.posix.normalize(path.posix.join(baseDir, rawSpec));
  if (!fileSet || !(fileSet instanceof Set)) return null;

  return resolveRelativeImportCandidate(normalized, {
    extensions: EXTENSIONS,
    resolve: (candidate) => (fileSet.has(candidate) ? candidate : null)
  });
};

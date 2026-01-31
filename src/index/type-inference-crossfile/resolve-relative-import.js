import path from 'node:path';
import { toPosix } from '../../shared/files.js';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export const resolveRelativeImport = (importerFile, spec, fileSet) => {
  if (!importerFile || !spec) return null;
  const rawSpec = String(spec);
  if (!rawSpec.startsWith('./') && !rawSpec.startsWith('../')) return null;
  const importer = toPosix(importerFile);
  const baseDir = path.posix.dirname(importer);
  const normalized = path.posix.normalize(path.posix.join(baseDir, rawSpec));
  if (!fileSet || !(fileSet instanceof Set)) return null;

  const ext = path.posix.extname(normalized);
  const candidates = [];
  if (ext) {
    candidates.push(normalized);
  } else {
    for (const candidateExt of EXTENSIONS) {
      candidates.push(`${normalized}${candidateExt}`);
      candidates.push(path.posix.join(normalized, `index${candidateExt}`));
    }
  }

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
};

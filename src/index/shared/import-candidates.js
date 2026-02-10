import path from 'node:path';

const normalizeExtensions = (extensions) => {
  if (!Array.isArray(extensions)) return [];
  const out = [];
  const seen = new Set();
  for (const ext of extensions) {
    const value = typeof ext === 'string' ? ext.trim() : '';
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

export const resolveRelativeImportCandidates = (normalizedPath, extensions = []) => {
  const rawPath = String(normalizedPath || '');
  const hasTrailingSlash = /\/+$/.test(rawPath);
  const trimmed = rawPath.replace(/\/+$/, '');
  if (!trimmed) return [];
  const ext = path.posix.extname(trimmed);
  if (ext) return [trimmed];

  const resolvedExtensions = normalizeExtensions(extensions);
  const candidates = [];
  for (const candidateExt of resolvedExtensions) {
    if (hasTrailingSlash) {
      candidates.push(path.posix.join(trimmed, `index${candidateExt}`));
      continue;
    }
    candidates.push(`${trimmed}${candidateExt}`);
    candidates.push(path.posix.join(trimmed, `index${candidateExt}`));
  }
  return candidates;
};

export const resolveRelativeImportCandidate = (
  normalizedPath,
  {
    extensions = [],
    resolve = null
  } = {}
) => {
  if (typeof resolve !== 'function') return null;
  const candidates = resolveRelativeImportCandidates(normalizedPath, extensions);
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (resolved) return resolved;
  }
  return null;
};

import path from 'node:path';

const RUNTIME_SOURCE_EXTENSIONS = Object.freeze({
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx', '.ts', '.d.ts'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts']
});

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
  if (ext) {
    // Preserve literal-file precedence. ESM imports in TypeScript source often
    // name the emitted runtime extension even when only the source is indexed.
    // Keep these alternatives bounded and within the caller's extension policy.
    const sourceExtensions = RUNTIME_SOURCE_EXTENSIONS[ext.toLowerCase()];
    if (!sourceExtensions || hasTrailingSlash) return [trimmed];
    const allowed = new Set(normalizeExtensions(extensions));
    const stem = trimmed.slice(0, -ext.length);
    return [trimmed, ...sourceExtensions.filter((value) => allowed.has(value)).map((value) => `${stem}${value}`)];
  }

  const resolvedExtensions = normalizeExtensions(extensions);
  const candidates = [];
  if (!hasTrailingSlash && trimmed !== '.') {
    candidates.push(trimmed);
  }
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

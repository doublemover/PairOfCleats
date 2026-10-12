import path from 'node:path';

/** One repository-relative identity for bundle grouping, manifests and replay. */
export const canonicalBundleSourceKey = value => {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw Object.assign(new TypeError('Invalid bundle source key.'), { code: 'ERR_BUNDLE_SOURCE_KEY' });
  }
  const slashed = value.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) {
    throw Object.assign(new TypeError('Bundle source key must be repository-relative.'), { code: 'ERR_BUNDLE_SOURCE_KEY' });
  }
  const normalized = path.posix.normalize(slashed);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw Object.assign(new TypeError('Bundle source key escapes its repository.'), { code: 'ERR_BUNDLE_SOURCE_KEY' });
  }
  return normalized;
};

/** Call after verifying persisted bytes; writing calls this before checksumming. */
export const normalizeBundleSourceKeys = bundle => ({
  ...bundle,
  ...(bundle.file == null ? {} : { file: canonicalBundleSourceKey(bundle.file) }),
  chunks: bundle.chunks.map(chunk => chunk && typeof chunk === 'object' && chunk.file != null
    ? { ...chunk, file: canonicalBundleSourceKey(chunk.file) } : chunk)
});

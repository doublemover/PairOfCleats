import path from 'node:path';
import { normalizeImportSpecifier, normalizeRelPath } from './path-utils.js';

const normalizePathToken = (value) => (
  typeof value === 'string'
    ? normalizeRelPath(value.trim().replace(/\\/g, '/'))
    : ''
);

const isRelativeOrRootSpecifier = (specifier) => (
  specifier.startsWith('.') || specifier.startsWith('/')
);

/**
 * Convert a raw import specifier into deterministic repository-relative candidates.
 */
export const toSpecifierCandidatePaths = ({ importer = '', specifier = '' } = {}) => {
  const normalizedSpecifier = normalizeImportSpecifier(specifier);
  if (!normalizedSpecifier || !isRelativeOrRootSpecifier(normalizedSpecifier)) return [];
  const importerRel = normalizePathToken(importer);
  const candidates = [];
  if (normalizedSpecifier.startsWith('/')) {
    const rooted = normalizePathToken(normalizedSpecifier.slice(1));
    if (rooted) candidates.push(rooted);
  } else if (importerRel) {
    const importerDir = path.posix.dirname(importerRel);
    const joined = normalizePathToken(path.posix.join(importerDir, normalizedSpecifier));
    if (joined) candidates.push(joined);
  } else {
    const fallback = normalizePathToken(normalizedSpecifier);
    if (fallback) candidates.push(fallback);
  }
  return Array.from(new Set(candidates));
};

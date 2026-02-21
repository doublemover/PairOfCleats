import path from 'node:path';
import { isAbsolutePathNative, toPosix } from '../../../shared/files.js';
import { DEFAULT_IMPORT_EXTS } from './constants.js';

export const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

export const stripSpecifier = (spec) => {
  if (typeof spec !== 'string') return '';
  const raw = spec.split(/[?#]/)[0];
  return raw.trim();
};

export const normalizeImportSpecifier = (spec) => {
  const stripped = stripSpecifier(spec);
  if (!stripped) return '';
  if (stripped.startsWith('//./') || stripped.startsWith('//../')) {
    return stripped.slice(2);
  }
  return stripped;
};

export const normalizeRelPath = (value) => {
  if (!value) return '';
  const normalized = path.posix.normalize(toPosix(String(value)));
  return normalized.replace(/^\.\/?/, '');
};

export const stripImportExtension = (value) => {
  if (!value) return '';
  if (value.endsWith('.d.ts')) {
    return value.slice(0, -'.d.ts'.length) || '';
  }
  for (const ext of DEFAULT_IMPORT_EXTS) {
    if (value.endsWith(ext)) {
      return value.slice(0, -ext.length) || '';
    }
  }
  return value;
};

export const resolveWithinRoot = (rootAbs, absPath) => {
  const rel = path.relative(rootAbs, absPath);
  if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) return null;
  return normalizeRelPath(toPosix(rel));
};

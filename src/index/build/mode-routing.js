import { EXTS_CODE, EXTS_PROSE } from '../constants.js';
import { toPosix } from '../../shared/files.js';

const DOCS_AMBIGUOUS_PROSE_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.adoc',
  '.asciidoc',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf'
]);

const normalizeExt = (ext) => String(ext || '').toLowerCase();

const normalizeRelPath = (relPath) => {
  if (!relPath) return '';
  return toPosix(String(relPath)).trim();
};

const isDocsPath = (relPath) => {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return false;
  return normalized.split('/').some((segment) => segment.toLowerCase() === 'docs');
};

export const shouldPreferDocsProse = ({ ext, relPath }) => {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) return false;
  return isDocsPath(relPath) && DOCS_AMBIGUOUS_PROSE_EXTS.has(normalizedExt);
};

export const isProseEntryForPath = ({ ext, relPath }) => {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) return false;
  return EXTS_PROSE.has(normalizedExt) || shouldPreferDocsProse({ ext: normalizedExt, relPath });
};

export const isCodeEntryForPath = ({ ext, relPath, isSpecial = false }) => {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt && !isSpecial) return false;
  if (shouldPreferDocsProse({ ext: normalizedExt, relPath })) return false;
  return EXTS_CODE.has(normalizedExt) || isSpecial;
};


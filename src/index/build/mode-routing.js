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
  '.conf',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.jsonc',
  '.map'
]);

const FIXTURE_AMBIGUOUS_PROSE_EXTS = new Set([
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.xml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.csv',
  '.tsv'
]);

const normalizeExt = (ext) => String(ext || '').toLowerCase();

const normalizeRelPath = (relPath) => {
  if (!relPath) return '';
  return toPosix(String(relPath)).trim();
};

const DOCS_PATH_SEGMENTS = new Set([
  'docs',
  'doc',
  'documentation'
]);
const BUILD_CONFIG_BASENAMES = new Set([
  'cmakelists.txt',
  'makefile',
  'makefile.in',
  'gnumakefile',
  'meson.build',
  'meson_options.txt'
]);
const BUILD_CONFIG_EXTS = new Set([
  '.cmake',
  '.mk',
  '.mak',
  '.make'
]);
const INFRA_PATH_PARTS = [
  '/.github/workflows/',
  '/.github/actions/',
  '/.circleci/',
  '/.gitlab/'
];

export const isDocsPath = (relPath) => {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return false;
  return normalized.split('/').some((segment) => DOCS_PATH_SEGMENTS.has(segment.toLowerCase()));
};

export const isInfraConfigPath = (relPath) => {
  const normalized = normalizeRelPath(relPath).toLowerCase();
  if (!normalized) return false;
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  for (const part of INFRA_PATH_PARTS) {
    if (bounded.includes(part)) return true;
  }
  const base = normalized.split('/').pop() || '';
  if (BUILD_CONFIG_BASENAMES.has(base)) return true;
  const dotIndex = base.lastIndexOf('.');
  const baseExt = dotIndex >= 0 ? base.slice(dotIndex) : '';
  return BUILD_CONFIG_EXTS.has(baseExt);
};

export const isFixturePath = (relPath) => {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return false;
  return normalized.split('/').some((segment) => {
    const lower = segment.toLowerCase();
    return lower === 'fixture' || lower === 'fixtures';
  });
};

export const shouldPreferDocsProse = ({ ext, relPath }) => {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) return false;
  return isDocsPath(relPath) && DOCS_AMBIGUOUS_PROSE_EXTS.has(normalizedExt);
};

export const shouldPreferInfraProse = ({ relPath }) => isInfraConfigPath(relPath);

export const shouldPreferFixtureProse = ({ ext, relPath }) => {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt) return false;
  return isFixturePath(relPath) && FIXTURE_AMBIGUOUS_PROSE_EXTS.has(normalizedExt);
};

export const isProseEntryForPath = ({ ext, relPath }) => {
  const normalizedExt = normalizeExt(ext);
  return EXTS_PROSE.has(normalizedExt)
    || shouldPreferDocsProse({ ext: normalizedExt, relPath })
    || shouldPreferInfraProse({ relPath })
    || shouldPreferFixtureProse({ ext: normalizedExt, relPath });
};

export const isCodeEntryForPath = ({ ext, relPath, isSpecial = false }) => {
  const normalizedExt = normalizeExt(ext);
  if (!normalizedExt && !isSpecial) return false;
  if (shouldPreferDocsProse({ ext: normalizedExt, relPath })) return false;
  if (!isSpecial && shouldPreferInfraProse({ relPath })) return false;
  if (shouldPreferFixtureProse({ ext: normalizedExt, relPath })) return false;
  return EXTS_CODE.has(normalizedExt) || isSpecial;
};

import { toPosix } from '../../../../../../shared/files.js';
import { isExtractedProseDocumentLikeExtension } from '../../../../../chunking/formats/document-common.js';
import { buildExtractedProseYieldProfileFamily } from '../../../../file-processor/skip.js';

export const EXTRACTED_PROSE_LOW_YIELD_SKIP_REASON = 'extracted-prose-low-yield-bailout';
export const EXTRACTED_PROSE_LOW_YIELD_COHORT_KEYS = Object.freeze([
  'docs-markdown',
  'tests-examples',
  'templates-config',
  'generated-machine',
  'code-comment-heavy'
]);

export const EXTRACTED_PROSE_LOW_YIELD_HIGH_VALUE_COHORTS = new Set([
  'docs-markdown',
  'tests-examples',
  'templates-config'
]);
export const EXTRACTED_PROSE_LOW_YIELD_MACHINE_COHORTS = new Set([
  'generated-machine'
]);
export const EXTRACTED_PROSE_LOW_YIELD_CODE_COHORTS = new Set([
  'code-comment-heavy'
]);

const EXTRACTED_PROSE_LOW_YIELD_GENERATED_PATH_FAMILIES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'git',
  'generated',
  'gen',
  'target',
  'out'
]);
const EXTRACTED_PROSE_LOW_YIELD_TEST_PATH_FAMILIES = new Set([
  'test',
  'tests',
  'spec',
  'specs',
  'example',
  'examples',
  'sample',
  'samples',
  'demo',
  'demos',
  'fixture',
  'fixtures',
  'benchmark',
  'benchmarks'
]);
const EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_PATH_FAMILIES = new Set([
  'config',
  'configs',
  '.github',
  '.gitlab',
  '.vscode',
  '.idea',
  'template',
  'templates'
]);
const EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_EXTENSIONS = new Set([
  '.conf',
  '.cfg',
  '.ini',
  '.toml',
  '.yaml',
  '.yml',
  '.json',
  '.jsonc',
  '.properties',
  '.xml',
  '.html',
  '.htm',
  '.mustache',
  '.hbs',
  '.handlebars',
  '.liquid',
  '.njk',
  '.jinja',
  '.jinja2',
  '.tpl',
  '.tmpl'
]);

export const resolveWarmupEntryKey = (entry) => String(entry?.rel || toPosix(entry?.abs || '') || '');
export const resolveWarmupEntryExtension = (entry) => String(entry?.ext || '').trim().toLowerCase();
export const normalizePathFamily = (value) => String(value || '(root)').trim().toLowerCase() || '(root)';
export const normalizeWarmupPath = (value) => {
  const normalized = toPosix(String(value || '')).trim().toLowerCase();
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};
export const resolveWarmupPathSegments = (value) => normalizeWarmupPath(value)
  .replace(/^\/+/, '')
  .split('/')
  .filter(Boolean);

export const resolveWarmupEntryFamily = (entry) => buildExtractedProseYieldProfileFamily({
  relPath: entry?.rel || null,
  absPath: entry?.abs || null,
  ext: resolveWarmupEntryExtension(entry)
});

export const resolveExtractedProseLowYieldCohortKey = ({
  relPath = null,
  absPath = null,
  ext = null,
  pathFamily = null
} = {}) => {
  const normalizedPath = normalizeWarmupPath(relPath || absPath || '');
  const normalizedExt = resolveWarmupEntryExtension({ ext });
  const normalizedFamily = normalizePathFamily(pathFamily);
  const segments = resolveWarmupPathSegments(normalizedPath);
  const fileName = segments.length > 0 ? segments[segments.length - 1] : '';
  const docLike = isExtractedProseDocumentLikeExtension(normalizedExt);
  if (
    EXTRACTED_PROSE_LOW_YIELD_GENERATED_PATH_FAMILIES.has(normalizedFamily)
    || segments.some((segment) => EXTRACTED_PROSE_LOW_YIELD_GENERATED_PATH_FAMILIES.has(segment))
    || fileName.includes('.min.')
    || fileName.endsWith('.map')
    || fileName.endsWith('.lock')
  ) {
    return 'generated-machine';
  }
  if (
    EXTRACTED_PROSE_LOW_YIELD_TEST_PATH_FAMILIES.has(normalizedFamily)
    || segments.some((segment) => EXTRACTED_PROSE_LOW_YIELD_TEST_PATH_FAMILIES.has(segment))
  ) {
    return 'tests-examples';
  }
  if (
    EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_PATH_FAMILIES.has(normalizedFamily)
    || segments.some((segment) => EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_PATH_FAMILIES.has(segment))
    || EXTRACTED_PROSE_LOW_YIELD_TEMPLATE_EXTENSIONS.has(normalizedExt)
  ) {
    return docLike && normalizedFamily === 'docs' ? 'docs-markdown' : 'templates-config';
  }
  if (docLike) return 'docs-markdown';
  return 'code-comment-heavy';
};

export const buildExtractedProseLowYieldCohort = ({
  relPath = null,
  absPath = null,
  ext = null,
  pathFamily = null
} = {}) => {
  const normalizedPath = normalizeWarmupPath(relPath || absPath || '');
  const normalizedExt = resolveWarmupEntryExtension({ ext });
  const normalizedFamily = normalizePathFamily(pathFamily);
  const key = resolveExtractedProseLowYieldCohortKey({
    relPath,
    absPath,
    ext,
    pathFamily: normalizedFamily
  });
  return {
    key,
    ext: normalizedExt || null,
    pathFamily: normalizedFamily,
    docLike: isExtractedProseDocumentLikeExtension(normalizedExt),
    pathHint: normalizedPath || null
  };
};

export const resolveWarmupEntryCohort = (entry) => {
  const family = resolveWarmupEntryFamily(entry);
  return buildExtractedProseLowYieldCohort({
    relPath: entry?.rel || null,
    absPath: entry?.abs || null,
    ext: resolveWarmupEntryExtension(entry),
    pathFamily: family?.pathFamily || null
  });
};

export const createEmptyCohortStats = (cohort = null) => ({
  key: cohort?.key || null,
  ext: cohort?.ext || null,
  pathFamily: cohort?.pathFamily || null,
  docLike: cohort?.docLike === true,
  warmupFiles: 0,
  sampledFiles: 0,
  observedFiles: 0,
  yieldedFiles: 0,
  chunkCount: 0
});

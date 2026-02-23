import { exceedsTreeSitterLimits as exceedsSharedTreeSitterLimits } from '../../../../shared/indexing/tree-sitter-limits.js';

const SCM_FAST_TIMEOUT_EXT_VALUES = [
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.lock',
  '.py',
  '.pyi',
  '.swift',
  '.html',
  '.htm'
];

export const SCM_ANNOTATE_FAST_TIMEOUT_EXTS = new Set(SCM_FAST_TIMEOUT_EXT_VALUES);
export const SCM_META_FAST_TIMEOUT_EXTS = new Set(SCM_FAST_TIMEOUT_EXT_VALUES);
export const SCM_PYTHON_EXTS = new Set(['.py', '.pyi']);
export const SCM_ANNOTATE_PYTHON_MAX_BYTES = 64 * 1024;
export const SCM_ANNOTATE_PYTHON_HEAVY_LINE_CUTOFF = 2500;
export const SCM_ANNOTATE_FAST_TIMEOUT_MS = 5000;
export const SCM_ANNOTATE_HEAVY_PATH_TIMEOUT_MS = 5000;
export const SCM_ANNOTATE_DEFAULT_TIMEOUT_CAP_MS = 5000;
const SCM_TASK_QUEUE_WAIT_SLACK_MS = 250;
const SCM_FAST_TIMEOUT_BASENAMES = new Set([
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  'podfile',
  'gemfile',
  'justfile'
]);
const SCM_FAST_TIMEOUT_PATH_PARTS = [
  '/.github/workflows/',
  '/.circleci/',
  '/.gitlab/'
];
const SCM_FORCE_TIMEOUT_CAP_PATH_PARTS = [
  '/test/',
  '/validation-test/',
  '/unittests/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/'
];
const SCM_JAVA_FAST_TIMEOUT_MIN_LINES = 400;
const SCM_FAST_TIMEOUT_MAX_LINES = 900;
export const SCM_CHURN_MAX_BYTES = 256 * 1024;
export const HEAVY_RELATIONS_MAX_BYTES = 512 * 1024;
export const HEAVY_RELATIONS_MAX_LINES = 6000;
const HEAVY_RELATIONS_PATH_MIN_BYTES = 64 * 1024;
const HEAVY_RELATIONS_PATH_MIN_LINES = 1200;
const HEAVY_RELATIONS_PATH_PARTS = [
  '/3rdparty/',
  '/third_party/',
  '/thirdparty/',
  '/vendor/',
  '/single_include/',
  '/include/fmt/',
  '/include/spdlog/fmt/',
  '/include/nlohmann/',
  '/modules/core/include/opencv2/core/hal/',
  '/modules/core/src/',
  '/modules/dnn/',
  '/modules/js/perf/',
  '/sources/cniollhttp/',
  '/sources/nio/',
  '/sources/niocore/',
  '/sources/nioposix/',
  '/tests/nio/',
  '/test/api-digester/inputs/',
  '/test/remote-run/',
  '/test/stdlib/inputs/',
  '/tests/abi/',
  '/test/gtest/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/',
  '/samples/',
  '/docs/mkdocs/',
  '/.github/workflows/'
];

/**
 * Normalize an SCM-relative path for deterministic guardrail matching.
 *
 * @param {string} relPath
 * @returns {string}
 */
export const normalizeScmPath = (relPath) => String(relPath || '').replace(/\\/g, '/').toLowerCase();

/**
 * Wrap a normalized path in sentinels so substring checks avoid partial-token collisions.
 *
 * @param {string} relPath
 * @returns {string}
 */
export const toBoundedScmPath = (relPath) => {
  const normalized = normalizeScmPath(relPath);
  return `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
};

/**
 * Coerce an input to a finite non-negative integer.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export const toFiniteNonNegativeInt = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
};

/**
 * Detect known generated Python lexer tables that are expensive for SCM annotation.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export const isPythonGeneratedDataPath = (relPath) => {
  const normalizedPath = normalizeScmPath(relPath);
  if (!normalizedPath.endsWith('.py') && !normalizedPath.endsWith('.pyi')) return false;
  if (!normalizedPath.includes('pygments/lexers/')) return false;
  return normalizedPath.endsWith('_builtins.py') || normalizedPath.endsWith('/_mapping.py');
};

/**
 * Check whether a file lives under known vendor/fixture zones that need heavy-relation guardrails.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export const isHeavyRelationsPath = (relPath) => {
  const boundedPath = toBoundedScmPath(relPath);
  for (const part of HEAVY_RELATIONS_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  return false;
};

/**
 * Decide if relation extraction should be skipped due to heavy path heuristics.
 *
 * @param {{relPath:string,fileBytes:number,fileLines:number}} input
 * @returns {boolean}
 */
export const shouldSkipHeavyRelationsByPath = ({ relPath, fileBytes, fileLines }) => (
  isHeavyRelationsPath(relPath)
  && (
    fileBytes >= HEAVY_RELATIONS_PATH_MIN_BYTES
    || fileLines >= HEAVY_RELATIONS_PATH_MIN_LINES
  )
);

export const shouldSkipHeavyRelations = ({
  mode,
  relationsEnabled,
  relPath,
  fileBytes,
  fileLines
}) => (
  mode === 'code'
  && Boolean(relationsEnabled)
  && (
    fileBytes >= HEAVY_RELATIONS_MAX_BYTES
    || fileLines >= HEAVY_RELATIONS_MAX_LINES
    || shouldSkipHeavyRelationsByPath({
      relPath,
      fileBytes,
      fileLines
    })
  )
);

/**
 * Flag SCM workloads that should use aggressive timeout caps.
 *
 * @param {{relPath:string,ext:string,lines:number}} input
 * @returns {boolean}
 */
export const isScmFastPath = ({ relPath, ext, lines }) => {
  const normalizedPath = normalizeScmPath(relPath);
  const boundedPath = toBoundedScmPath(relPath);
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  const lineCount = toFiniteNonNegativeInt(lines);
  if (SCM_META_FAST_TIMEOUT_EXTS.has(normalizedExt) || SCM_ANNOTATE_FAST_TIMEOUT_EXTS.has(normalizedExt)) {
    return true;
  }
  if (normalizedExt === '.java' && lineCount != null && lineCount >= SCM_JAVA_FAST_TIMEOUT_MIN_LINES) {
    return true;
  }
  if (lineCount != null && lineCount >= SCM_FAST_TIMEOUT_MAX_LINES) {
    return true;
  }
  const base = normalizedPath.split('/').pop() || '';
  if (SCM_FAST_TIMEOUT_BASENAMES.has(base)) return true;
  for (const part of SCM_FAST_TIMEOUT_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  if (isHeavyRelationsPath(normalizedPath)) return true;
  return false;
};

/**
 * Force strict SCM timeout caps for deterministic high-risk subtrees.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export const shouldForceScmTimeoutCaps = (relPath) => {
  const boundedPath = toBoundedScmPath(relPath);
  for (const part of SCM_FORCE_TIMEOUT_CAP_PATH_PARTS) {
    if (boundedPath.includes(part)) return true;
  }
  return false;
};

/**
 * Compute task deadline including queue-wait slack to avoid false timeout reports.
 *
 * @param {number} taskTimeoutMs
 * @returns {number}
 */
export const resolveScmTaskDeadlineMs = (taskTimeoutMs) => {
  const baseTimeout = Number(taskTimeoutMs);
  if (!Number.isFinite(baseTimeout) || baseTimeout <= 0) return 0;
  const boundedBase = Math.max(1, Math.floor(baseTimeout));
  return boundedBase + SCM_TASK_QUEUE_WAIT_SLACK_MS;
};

/**
 * Check whether a caught error corresponds to SCM task timeout classification.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isScmTaskTimeoutError = (error) => (
  error?.code === 'SCM_TASK_TIMEOUT'
);

/**
 * Apply shared tree-sitter byte/line caps to raw segment text.
 *
 * @param {{text:string,languageId:string|null,treeSitterConfig:object}} input
 * @returns {boolean}
 */
export const exceedsTreeSitterLimits = ({ text, languageId, treeSitterConfig }) => (
  exceedsSharedTreeSitterLimits({ text, languageId, treeSitterConfig })
);

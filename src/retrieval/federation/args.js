import { parseSearchArgs } from '../cli-args.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { buildSearchRequestArgs } from '../../../tools/shared/search-request.js';

const WORKSPACE_VALUE_FLAGS = new Set([
  'workspace',
  'select',
  'tag',
  'repo-filter',
  'merge',
  'top-per-repo',
  'concurrency',
  'cohort',
  'rrf-k'
]);

const WORKSPACE_BOOLEAN_FLAGS = new Set([
  'include-disabled',
  'allow-unsafe-mix',
  'federated-strict',
  'debug-include-paths'
]);

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
};

/**
 * Normalize CLI `--mode` input to a single non-empty token.
 *
 * Yargs may surface repeated flags as arrays; for federated requests we keep
 * the first provided non-empty mode value and let downstream mode resolution
 * validate/normalize it.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
const normalizeMode = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
};

const splitAtEndOfOptions = (rawArgs) => {
  const markerIndex = rawArgs.findIndex((token) => String(token || '') === '--');
  if (markerIndex < 0) {
    return {
      options: rawArgs.slice(),
      positional: []
    };
  }
  return {
    options: rawArgs.slice(0, markerIndex),
    positional: rawArgs.slice(markerIndex)
  };
};

const removeFlagPair = (rawArgs, name) => {
  const { options, positional } = splitAtEndOfOptions(rawArgs);
  const output = [];
  for (let i = 0; i < options.length; i += 1) {
    const token = String(options[i] || '');
    if (token === `--${name}`) {
      if (WORKSPACE_VALUE_FLAGS.has(name) && i + 1 < options.length) {
        i += 1;
      }
      continue;
    }
    if (token.startsWith(`--${name}=`)) continue;
    output.push(token);
  }
  return [...output, ...positional];
};

/**
 * Normalize an integer input to a strictly positive value.
 *
 * @param {unknown} value
 * @param {number} [fallback=10]
 * @returns {number}
 */
const normalizePositiveInt = (value, fallback = 10) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Normalize an integer input to a non-negative value.
 *
 * Used for top limits where explicit `0` must be preserved (for example
 * federated `--top 0`), instead of silently coercing to a default.
 *
 * @param {unknown} value
 * @param {number} [fallback=10]
 * @returns {number}
 */
const normalizeNonNegativeInt = (value, fallback = 10) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.floor(parsed));
};

/**
 * Detect compact short-form top flags (for example `-n10`).
 *
 * @param {string} token
 * @returns {boolean}
 */
const isCompactTopFlag = (token) => /^-n\d+$/.test(token);

const detectTopFlagCount = (rawArgs) => {
  const { options } = splitAtEndOfOptions(rawArgs);
  return options.reduce((count, token) => {
    const current = String(token || '');
    if (
      current === '--top'
      || current === '-n'
      || current.startsWith('--top=')
      || current.startsWith('-n=')
      || isCompactTopFlag(current)
    ) {
      return count + 1;
    }
    return count;
  }, 0);
};

const removeTopFlags = (rawArgs) => {
  const { options, positional } = splitAtEndOfOptions(rawArgs);
  const out = [];
  for (let i = 0; i < options.length; i += 1) {
    const token = String(options[i] || '');
    if (token === '--top' || token === '-n') {
      i += 1;
      continue;
    }
    if (token.startsWith('--top=') || token.startsWith('-n=') || isCompactTopFlag(token)) continue;
    out.push(token);
  }
  return [...out, ...positional];
};

const ensureJsonFlag = (rawArgs) => {
  const { options, positional } = splitAtEndOfOptions(rawArgs);
  if (options.some((token) => token === '--json' || token.startsWith('--json='))) return rawArgs.slice();
  return [...options, '--json', ...positional];
};

const appendTopFlag = (rawArgs, perRepoTop) => {
  const { options, positional } = splitAtEndOfOptions(rawArgs);
  return [...options, '--top', String(perRepoTop), ...positional];
};

export const buildPerRepoArgsFromCli = ({
  rawArgs,
  perRepoTop
}) => {
  const topCount = detectTopFlagCount(rawArgs);
  if (topCount > 1) {
    const error = createError(ERROR_CODES.INVALID_REQUEST, 'Multiple --top values are not supported in federated mode.');
    error.code = 'ERR_FEDERATED_DUPLICATE_TOP_FLAG';
    throw error;
  }
  const workspaceFlags = [...WORKSPACE_VALUE_FLAGS, ...WORKSPACE_BOOLEAN_FLAGS];
  let args = rawArgs.slice();
  for (const flag of workspaceFlags) {
    args = removeFlagPair(args, flag);
  }
  args = removeTopFlags(args);
  args = ensureJsonFlag(args);
  return appendTopFlag(args, perRepoTop);
};

export const buildPerRepoArgsFromRequest = ({
  query,
  search = {},
  perRepoTop
}) => {
  const searchPayload = {
    ...search,
    query
  };
  const built = buildSearchRequestArgs(searchPayload, {
    defaultOutput: 'compact',
    allowedOutputs: ['compact', 'full', 'json'],
    includeRepo: false,
    topFlag: '--top',
    topMin: 1,
    omitModeBoth: false
  });
  if (!built.ok) {
    throw createError(ERROR_CODES.INVALID_REQUEST, built.message || 'Invalid federated search payload.');
  }
  const args = removeTopFlags(built.args);
  args.push('--top', String(perRepoTop));
  return args;
};

export const parseFederatedCliRequest = (rawArgs = []) => {
  const argv = parseSearchArgs(rawArgs);
  const workspacePath = typeof argv.workspace === 'string' ? argv.workspace.trim() : '';
  const query = Array.isArray(argv._)
    ? argv._
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join(' ')
    : '';
  if (!workspacePath) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'Federated search requires --workspace <path>.');
  }
  if (!query) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'Federated search requires a query string.');
  }
  if (argv.repo) {
    const error = createError(ERROR_CODES.INVALID_REQUEST, '--repo is not allowed when --workspace is set.');
    error.code = 'ERR_FEDERATED_REPO_FLAG_NOT_ALLOWED';
    throw error;
  }

  const top = normalizeNonNegativeInt(argv.top ?? argv.n, 10);
  const perRepoTop = normalizeNonNegativeInt(argv['top-per-repo'], Math.min(Math.max(top * 2, top), 50));
  const concurrency = normalizePositiveInt(argv.concurrency, 4);
  const mode = normalizeMode(argv.mode);

  return {
    workspacePath,
    query,
    rawArgs: rawArgs.slice(),
    mode,
    top,
    perRepoTop,
    concurrency,
    merge: {
      strategy: typeof argv.merge === 'string' ? argv.merge.trim().toLowerCase() : 'rrf',
      rrfK: normalizePositiveInt(argv['rrf-k'], 60)
    },
    select: {
      repos: normalizeList(argv.select),
      tags: normalizeList(argv.tag),
      repoFilter: normalizeList(argv['repo-filter']),
      includeDisabled: argv['include-disabled'] === true
    },
    cohort: normalizeList(argv.cohort),
    allowUnsafeMix: argv['allow-unsafe-mix'] === true,
    strict: argv['federated-strict'] === true,
    debug: {
      includePaths: argv['debug-include-paths'] === true
    }
  };
};

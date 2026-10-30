import { validateConfig } from '../config/validate.js';
import { BENCH_OPTIONS, INDEX_BUILD_OPTIONS } from './cli-option-sets.js';
import { normalizeIndexBuildStage } from './indexing/stages.js';
import { createCli } from './cli.js';

const CLI_META_KEYS = new Set(['_', '$0', 'help', 'h']);

const resolveOptionKeys = (options) => {
  const keys = new Set(Object.keys(options || {}));
  const aliases = new Set();
  for (const value of Object.values(options || {})) {
    if (!value || typeof value !== 'object') continue;
    const alias = value.alias;
    if (Array.isArray(alias)) {
      alias.forEach((entry) => aliases.add(String(entry)));
    } else if (alias) {
      aliases.add(String(alias));
    }
  }
  return { keys, aliases };
};

const buildSchemaFromOptions = (options) => ({
  type: 'object',
  properties: Object.fromEntries(
    Object.entries(options || {}).map(([key, value]) => [
      key,
      { type: value?.type || 'string' }
    ])
  ),
  additionalProperties: false
});

const extractKnownArgs = (argv, keys) => {
  const filtered = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(argv, key)) {
      filtered[key] = argv[key];
    }
  }
  return filtered;
};

const findUnknownArgs = (argv, keys, aliases) => {
  const unknown = [];
  for (const key of Object.keys(argv || {})) {
    if (CLI_META_KEYS.has(key)) continue;
    if (keys.has(key) || aliases.has(key)) continue;
    unknown.push(key);
  }
  return unknown;
};

export const INDEX_BUILD_SCHEMA = buildSchemaFromOptions(INDEX_BUILD_OPTIONS);
export const BENCH_SCHEMA = buildSchemaFromOptions(BENCH_OPTIONS);

const createCliValidationError = (code, message, details = []) => {
  const error = new Error(message);
  error.code = code;
  error.details = Array.isArray(details) ? [...details] : [];
  return error;
};

const throwOnErrors = (label, errors, code) => {
  if (!errors.length) return;
  const message = errors.join('; ');
  throw createCliValidationError(code, `${label} validation failed: ${message}`, errors);
};

export function validateBuildArgs(argv) {
  const { keys, aliases } = resolveOptionKeys(INDEX_BUILD_OPTIONS);
  const unknown = findUnknownArgs(argv, keys, aliases);
  if (unknown.length) {
    throw createCliValidationError(
      'ERR_BUILD_ARG_VALIDATION',
      `build-index args include unknown options: ${unknown.join(', ')}`,
      unknown.map((entry) => `unknown option: ${entry}`)
    );
  }
  const result = validateConfig(INDEX_BUILD_SCHEMA, extractKnownArgs(argv, keys));
  if (!result.ok) throwOnErrors('build-index args', result.errors, 'ERR_BUILD_ARG_VALIDATION');
  validateBuildIntent(argv);
}

/** Admission shared by CLI parsing and direct core calls, before any build work. */
export function validateBuildIntent(argv = {}) {
  const errors = [];
  if (Array.isArray(argv._) && argv._.length) errors.push(`unexpected positional arguments: ${argv._.join(', ')}`);
  if (argv.stage !== undefined && (typeof argv.stage !== 'string' || !normalizeIndexBuildStage(argv.stage))) {
    errors.push('stage must be 1|2|3|4, stage1|stage2|stage3|stage4, sparse|enrich|full|embeddings|embed|sqlite|ann');
  }
  const modes = ['code', 'prose', 'extracted-prose', 'records', 'all', 'both'];
  if (argv.mode !== undefined && (typeof argv.mode !== 'string' || !modes.includes(argv.mode.trim().toLowerCase()))) errors.push('mode must be code|prose|extracted-prose|records|all|both');
  if (Array.isArray(argv.modes) && argv.modes.some(mode => !['code', 'prose', 'extracted-prose', 'records'].includes(mode))) errors.push('modes contains an unsupported index mode');
  if (argv.quality !== undefined && (typeof argv.quality !== 'string' || !['fast', 'balanced', 'max'].includes(argv.quality.trim().toLowerCase()))) errors.push('quality must be fast|balanced|max');
  throwOnErrors('build-index intent', errors, 'ERR_BUILD_ARG_VALIDATION');
}

/** Admit raw intent before defaults can turn a missing value into all-mode
 * work, and before a wrapper resolves configuration or launches children. */
export function validateBuildRawIntent(rawArgs = [], { parse = true } = {}) {
  const end = rawArgs.indexOf('--');
  const options = end < 0 ? rawArgs : rawArgs.slice(0, end);
  if (options.some(value => ['--help', '-h', '--version', '-v'].includes(value))) return;
  for (let index = 0; index < options.length; index++) {
    const flag = options[index];
    if (!['--stage', '--mode', '--quality'].includes(flag)) continue;
    const value = options[index + 1];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) {
      throw createCliValidationError('ERR_BUILD_ARG_VALIDATION', flag + ' requires an explicit value.');
    }
  }
  if (!parse) return;
  const argv = createCli({ argv: ['node', 'build-index', ...rawArgs], options: INDEX_BUILD_OPTIONS })
    .help(false).version(false).exitProcess(false).fail(message => {
      throw createCliValidationError('ERR_BUILD_ARG_VALIDATION', message);
    }).parseSync();
  validateBuildArgs(argv);
}

export function validateBenchArgs(argv, { allowedOptions } = {}) {
  const allowed = allowedOptions || BENCH_OPTIONS;
  const { keys, aliases } = resolveOptionKeys(allowed);
  const unknown = findUnknownArgs(argv, keys, aliases);
  if (unknown.length) {
    throw createCliValidationError(
      'ERR_BENCH_ARG_VALIDATION',
      `bench args include unknown options: ${unknown.join(', ')}`,
      unknown.map((entry) => `unknown option: ${entry}`)
    );
  }
  const { keys: benchKeys } = resolveOptionKeys(BENCH_OPTIONS);
  const result = validateConfig(BENCH_SCHEMA, extractKnownArgs(argv, benchKeys));
  if (!result.ok) throwOnErrors('bench args', result.errors, 'ERR_BENCH_ARG_VALIDATION');
  const conflicts = [];
  if (argv.ann && argv['no-ann']) {
    conflicts.push('ann and no-ann cannot both be set');
  }
  if (argv['stub-embeddings'] && argv['real-embeddings']) {
    conflicts.push('stub-embeddings and real-embeddings cannot both be set');
  }
  throwOnErrors('bench args', conflicts, 'ERR_BENCH_ARG_VALIDATION');
}

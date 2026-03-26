import { validateConfig } from '../config/validate.js';
import { BENCH_OPTIONS, INDEX_BUILD_OPTIONS } from './cli-option-sets.js';

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

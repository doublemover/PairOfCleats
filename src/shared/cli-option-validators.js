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

const throwOnErrors = (label, errors) => {
  if (!errors.length) return;
  const message = errors.join('; ');
  throw new Error(`${label} validation failed: ${message}`);
};

export function validateBuildArgs(argv) {
  const { keys, aliases } = resolveOptionKeys(INDEX_BUILD_OPTIONS);
  const unknown = findUnknownArgs(argv, keys, aliases);
  if (unknown.length) {
    throw new Error(`build-index args include unknown options: ${unknown.join(', ')}`);
  }
  const result = validateConfig(INDEX_BUILD_SCHEMA, extractKnownArgs(argv, keys));
  if (!result.ok) throwOnErrors('build-index args', result.errors);
}

export function validateBenchArgs(argv, { allowedOptions } = {}) {
  const allowed = allowedOptions || BENCH_OPTIONS;
  const { keys, aliases } = resolveOptionKeys(allowed);
  const unknown = findUnknownArgs(argv, keys, aliases);
  if (unknown.length) {
    throw new Error(`bench args include unknown options: ${unknown.join(', ')}`);
  }
  const { keys: benchKeys } = resolveOptionKeys(BENCH_OPTIONS);
  const result = validateConfig(BENCH_SCHEMA, extractKnownArgs(argv, benchKeys));
  if (!result.ok) throwOnErrors('bench args', result.errors);
  const conflicts = [];
  if (argv.ann && argv['no-ann']) {
    conflicts.push('ann and no-ann cannot both be set');
  }
  if (argv['stub-embeddings'] && argv['real-embeddings']) {
    conflicts.push('stub-embeddings and real-embeddings cannot both be set');
  }
  throwOnErrors('bench args', conflicts);
}

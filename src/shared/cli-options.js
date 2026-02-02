import { validateConfig } from '../config/validate.js';
import { DEFAULT_STUB_DIMS } from './embedding.js';

export const INDEX_BUILD_OPTIONS = {
  mode: { type: 'string', default: 'all', describe: 'code|prose|extracted-prose|records|all' },
  quality: { type: 'string' },
  stage: { type: 'string', describe: 'start at a specific stage (e.g. 1,2,3,4)' },
  dims: { type: 'number', default: DEFAULT_STUB_DIMS },
  threads: { type: 'number' },
  incremental: { type: 'boolean', default: false, alias: 'i' },
  'stub-embeddings': { type: 'boolean', default: false, describe: 'use stub embeddings for faster builds' },
  watch: { type: 'boolean', default: false },
  'watch-poll': { type: 'number', default: 2000 },
  'watch-debounce': { type: 'number', default: 500 },
  sqlite: { type: 'boolean', describe: 'enable sqlite index build' },
  'debug-crash': { type: 'boolean', default: false },
  model: { type: 'string' },
  repo: { type: 'string', describe: 'repo root (defaults to cwd or repo root)' },
  'scm-provider': { type: 'string', describe: 'auto|git|jj|none' },
  'scm-annotate': { type: 'boolean', default: false },
  'no-scm-annotate': { type: 'boolean', default: false },
  progress: { type: 'string', default: 'auto', describe: 'auto|tty|log|json|jsonl|off' },
  'config-dump': { type: 'boolean', default: false },
  'log-file': { type: 'string', describe: 'write structured logs to a file (implies --log-format json unless set)' },
  'log-format': { type: 'string', describe: 'text|json|pretty (overrides logging.format)' },
  json: { type: 'boolean', default: false },
  verbose: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false }
};

export const BENCH_OPTIONS = {
  ann: { type: 'boolean' },
  'no-ann': { type: 'boolean' },
  json: { type: 'boolean', default: false },
  'write-report': { type: 'boolean', default: false },
  build: { type: 'boolean', default: false },
  'build-index': { type: 'boolean', default: false },
  'build-sqlite': { type: 'boolean', default: false },
  incremental: { type: 'boolean', default: false },
  'keep-cache': { type: 'boolean', default: false },
  'stub-embeddings': { type: 'boolean', default: false },
  'real-embeddings': { type: 'boolean', default: false },
  queries: { type: 'string', alias: 'q' },
  backend: { type: 'string' },
  out: { type: 'string' },
  repo: { type: 'string' },
  top: { type: 'number', default: 5, alias: 'n' },
  limit: { type: 'number', default: 0 },
  'heap-mb': { type: 'number' },
  'query-concurrency': { type: 'number' },
  threads: { type: 'number' },
  progress: { type: 'string', default: 'auto' },
  verbose: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false }
};

export function mergeCliOptions(...sets) {
  const merged = {};
  for (const set of sets) {
    if (!set || typeof set !== 'object') continue;
    for (const [key, value] of Object.entries(set)) {
      merged[key] = value;
    }
  }
  return merged;
}

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

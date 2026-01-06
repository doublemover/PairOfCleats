import { validateConfig } from '../config/validate.js';

export const INDEX_BUILD_OPTIONS = {
  mode: { type: 'string', default: 'all' },
  stage: { type: 'string' },
  dims: { type: 'number', default: 384 },
  threads: { type: 'number' },
  incremental: { type: 'boolean', default: false, alias: 'i' },
  'stub-embeddings': { type: 'boolean', default: false },
  watch: { type: 'boolean', default: false },
  'watch-poll': { type: 'number', default: 2000 },
  'watch-debounce': { type: 'number', default: 500 },
  sqlite: { type: 'boolean' },
  'debug-crash': { type: 'boolean', default: false },
  model: { type: 'string' },
  repo: { type: 'string' }
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
  'stub-embeddings': { type: 'boolean', default: false },
  'index-profile': { type: 'string' },
  'no-index-profile': { type: 'boolean', default: false },
  'real-embeddings': { type: 'boolean', default: false },
  queries: { type: 'string' },
  backend: { type: 'string' },
  out: { type: 'string' },
  'bm25-k1': { type: 'number' },
  'bm25-b': { type: 'number' },
  'fts-profile': { type: 'string' },
  'fts-weights': { type: 'string' },
  repo: { type: 'string' },
  top: { type: 'number', default: 5 },
  limit: { type: 'number', default: 0 },
  'heap-mb': { type: 'number' },
  threads: { type: 'number' }
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

const INDEX_BUILD_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string' },
    stage: { type: 'string' },
    dims: { type: 'number' },
    threads: { type: 'number' },
    incremental: { type: 'boolean' },
    watch: { type: 'boolean' },
    sqlite: { type: 'boolean' },
    model: { type: 'string' },
    repo: { type: 'string' }
  }
};

const BENCH_SCHEMA = {
  type: 'object',
  properties: {
    ann: { type: 'boolean' },
    'no-ann': { type: 'boolean' },
    build: { type: 'boolean' },
    'build-index': { type: 'boolean' },
    'build-sqlite': { type: 'boolean' },
    incremental: { type: 'boolean' },
    'stub-embeddings': { type: 'boolean' },
    'index-profile': { type: 'string' },
    'real-embeddings': { type: 'boolean' },
    backend: { type: 'string' },
    top: { type: 'number' },
    limit: { type: 'number' },
    'bm25-k1': { type: 'number' },
    'bm25-b': { type: 'number' },
    'fts-profile': { type: 'string' },
    'fts-weights': { type: 'string' },
    threads: { type: 'number' },
    'heap-mb': { type: 'number' }
  }
};

const throwOnErrors = (label, errors) => {
  if (!errors.length) return;
  const message = errors.join('; ');
  throw new Error(`${label} validation failed: ${message}`);
};

export function validateBuildArgs(argv) {
  const result = validateConfig(INDEX_BUILD_SCHEMA, argv);
  if (!result.ok) throwOnErrors('build-index args', result.errors);
}

export function validateBenchArgs(argv) {
  const result = validateConfig(BENCH_SCHEMA, argv);
  if (!result.ok) throwOnErrors('bench args', result.errors);
  const conflicts = [];
  if (argv.ann && argv['no-ann']) {
    conflicts.push('ann and no-ann cannot both be set');
  }
  if (argv['stub-embeddings'] && argv['real-embeddings']) {
    conflicts.push('stub-embeddings and real-embeddings cannot both be set');
  }
  if (argv['index-profile'] && argv['no-index-profile']) {
    conflicts.push('index-profile and no-index-profile cannot both be set');
  }
  throwOnErrors('bench args', conflicts);
}

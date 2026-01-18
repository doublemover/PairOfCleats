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
  progress: { type: 'string', default: 'auto', describe: 'auto|tty|json|jsonl|off' },
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
  queries: { type: 'string' },
  backend: { type: 'string' },
  out: { type: 'string' },
  repo: { type: 'string' },
  top: { type: 'number', default: 5 },
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

const INDEX_BUILD_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string' },
    quality: { type: 'string' },
    stage: { type: 'string' },
    dims: { type: 'number' },
    threads: { type: 'number' },
    incremental: { type: 'boolean' },
    watch: { type: 'boolean' },
    sqlite: { type: 'boolean' },
    model: { type: 'string' },
    repo: { type: 'string' },
    progress: { type: 'string' },
    verbose: { type: 'boolean' },
    quiet: { type: 'boolean' }
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
    'keep-cache': { type: 'boolean' },
    'stub-embeddings': { type: 'boolean' },
      'real-embeddings': { type: 'boolean' },
    backend: { type: 'string' },
    top: { type: 'number' },
    limit: { type: 'number' },
            'query-concurrency': { type: 'number' },
    threads: { type: 'number' },
    'heap-mb': { type: 'number' },
    progress: { type: 'string' },
    verbose: { type: 'boolean' },
    quiet: { type: 'boolean' }
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
  throwOnErrors('bench args', conflicts);
}

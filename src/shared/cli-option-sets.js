import { DEFAULT_STUB_DIMS } from './embedding.js';

export const INDEX_BUILD_OPTIONS = {
  mode: { type: 'string', default: 'all', describe: 'code|prose|extracted-prose|records|all' },
  quality: { type: 'string' },
  stage: { type: 'string', describe: 'start at a specific stage (e.g. 1,2,3,4)' },
  dims: { type: 'number', default: DEFAULT_STUB_DIMS },
  threads: { type: 'number' },
  scheduler: { type: 'boolean', describe: 'enable build scheduler' },
  'scheduler-cpu': { type: 'number', describe: 'scheduler CPU tokens' },
  'scheduler-io': { type: 'number', describe: 'scheduler IO tokens' },
  'scheduler-mem': { type: 'number', describe: 'scheduler memory tokens' },
  'scheduler-starvation': { type: 'number', describe: 'scheduler starvation threshold (ms)' },
  'scheduler-low-resource': { type: 'boolean', describe: 'force scheduler low-resource mode' },
  incremental: { type: 'boolean', default: false, alias: 'i' },
  'cache-rebuild': { type: 'boolean', default: false, describe: 'purge caches before build' },
  'stub-embeddings': { type: 'boolean', default: false, describe: 'use stub embeddings for faster builds' },
  watch: { type: 'boolean', default: false },
  'watch-poll': { type: 'number', default: 2000 },
  'watch-debounce': { type: 'number', default: 500 },
  sqlite: { type: 'boolean', describe: 'enable sqlite index build' },
  'sqlite-batch-size': { type: 'number', describe: 'override sqlite batch size for stage4 builds' },
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
  'validate-ordering': { type: 'boolean', default: false, describe: 'fail validation if ordering ledger mismatches' },
  json: { type: 'boolean', default: false },
  verbose: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false }
};

export const SERVICE_INDEXER_OPTIONS = {
  config: { type: 'string' },
  repo: { type: 'string' },
  job: { type: 'string' },
  mode: { type: 'string', default: 'all' },
  reason: { type: 'string' },
  stage: { type: 'string' },
  command: { type: 'string' },
  all: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  watch: { type: 'boolean', default: false },
  interval: { type: 'number' },
  concurrency: { type: 'number' },
  queue: { type: 'string', default: 'index' },
  lock: { type: 'string' },
  'shutdown-mode': { type: 'string' },
  'timeout-ms': { type: 'number' },
  json: { type: 'boolean', default: false }
};

export const SERVICE_API_OPTIONS = {
  host: { type: 'string', default: '127.0.0.1' },
  port: { type: 'string', default: '7345' },
  output: { type: 'string', default: 'compact' },
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  repo: { type: 'string' },
  'auth-token': { type: 'string' },
  'allow-unauthenticated': { type: 'boolean', default: false },
  'cors-allowed-origins': { type: 'string' },
  'cors-allow-any': { type: 'boolean', default: false },
  'allowed-repo-roots': { type: 'string' },
  'max-body-bytes': { type: 'number' }
};

export const TOOLING_DETECT_OPTIONS = {
  json: { type: 'boolean', default: false },
  root: { type: 'string' },
  repo: { type: 'string' },
  languages: { type: 'string' }
};

export const TOOLING_INSTALL_OPTIONS = {
  json: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  'no-fallback': { type: 'boolean', default: false },
  root: { type: 'string' },
  repo: { type: 'string' },
  scope: { type: 'string' },
  languages: { type: 'string' },
  tools: { type: 'string' }
};

export const CONTEXT_PACK_OPTIONS = {
  repo: { type: 'string' },
  seed: { type: 'string' },
  hops: { type: 'number' },
  maxTokens: { type: 'number' },
  maxBytes: { type: 'number' },
  includeGraph: { type: 'boolean', default: true },
  includeTypes: { type: 'boolean', default: false },
  includeRisk: { type: 'boolean', default: false },
  includeRiskPartialFlows: { type: 'boolean', default: false },
  strictRisk: { type: 'boolean', default: false },
  strictEvidence: { type: 'boolean', default: false },
  rule: { type: 'string' },
  category: { type: 'string' },
  severity: { type: 'string' },
  tag: { type: 'string' },
  source: { type: 'string' },
  sink: { type: 'string' },
  'flow-id': { type: 'string' },
  'source-rule': { type: 'string' },
  'sink-rule': { type: 'string' },
  includeImports: { type: 'boolean', default: true },
  includeUsages: { type: 'boolean', default: true },
  includeCallersCallees: { type: 'boolean', default: true },
  includePaths: { type: 'boolean', default: false },
  maxTypeEntries: { type: 'number' },
  format: { type: 'string' },
  json: { type: 'boolean', default: false },
  maxDepth: { type: 'number' },
  maxFanoutPerNode: { type: 'number' },
  maxNodes: { type: 'number' },
  maxEdges: { type: 'number' },
  maxPaths: { type: 'number' },
  maxCandidates: { type: 'number' },
  maxWorkUnits: { type: 'number' },
  maxWallClockMs: { type: 'number' },
  workspace: { type: 'string' },
  workspaceId: { type: 'string' },
  select: { type: 'string' },
  'repo-filter': { type: 'string' },
  includeDisabled: { type: 'boolean', default: false },
  maxFederatedRepos: { type: 'number' }
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

export const CACHE_GC_OPTIONS = {
  apply: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  'cache-root': { type: 'string' },
  'grace-days': { type: 'number', default: 0 },
  'max-deletes': { type: 'number', default: 0 },
  concurrency: { type: 'number', default: 4 },
  'max-bytes': { type: 'number' },
  'max-gb': { type: 'number' },
  'max-age-days': { type: 'number' },
  repo: { type: 'string' }
};

export const COMPARE_MODELS_OPTIONS = {
  json: { type: 'boolean', default: false },
  build: { type: 'boolean', default: false },
  'build-index': { type: 'boolean', default: false },
  'build-sqlite': { type: 'boolean', default: false },
  incremental: { type: 'boolean', default: false },
  'stub-embeddings': { type: 'boolean', default: false },
  ann: { type: 'boolean' },
  'no-ann': { type: 'boolean' },
  models: { type: 'string' },
  baseline: { type: 'string' },
  queries: { type: 'string' },
  backend: { type: 'string' },
  out: { type: 'string' },
  mode: { type: 'string' },
  'cache-root': { type: 'string' },
  repo: { type: 'string' },
  top: { type: 'number', default: 5, alias: 'n' },
  limit: { type: 'number', default: 0 }
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

export function resolveCliOptionFlagSets(options = {}) {
  const optionNames = Object.keys(options);
  const valueOptionNames = optionNames.filter((name) => options?.[name]?.type !== 'boolean');
  return { optionNames, valueOptionNames };
}

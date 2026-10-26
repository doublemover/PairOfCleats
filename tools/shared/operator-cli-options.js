// Canonical CLI option definitions shared with native supervised forms.
// Keep execution in the owning command; importing options has no side effects.
import { RISK_PARTIAL_FLOW_OPTIONS, RISK_FILTER_OPTIONS, REPORT_FORMAT_OPTIONS } from '../../src/shared/cli-option-sets.js';
import { MAP_BENCH_BUILD_OPTIONS } from './map-build-options.js';

export const TOOLING_DOCTOR_OPTIONS = {
  json: { type: 'boolean', default: false },
  repo: { type: 'string' },
  strict: { type: 'boolean', describe: 'Require strict checks (enabled unless --non-strict).' },
  'non-strict': { type: 'boolean', default: false }
};

export const SETUP_OPTIONS = {
  plan: { type: 'boolean', default: false },
  'apply-plan': { type: 'string' },
  profile: { type: 'string', choices: ['sparse', 'semantic'], default: 'sparse' },
  model: { type: 'string' },
  backend: { type: 'string', choices: ['memory', 'sqlite', 'lmdb'], default: 'memory' },
  tools: { type: 'string' },
  json: { type: 'boolean', default: false },
  'non-interactive': { type: 'boolean', default: false },
  'validate-config': { type: 'boolean', default: false },
  'skip-validate': { type: 'boolean', default: false },
  'skip-install': { type: 'boolean', default: false },
  'skip-dicts': { type: 'boolean', default: false },
  'skip-models': { type: 'boolean', default: false },
  'skip-extensions': { type: 'boolean', default: false },
  'skip-tooling': { type: 'boolean', default: false },
  'skip-index': { type: 'boolean', default: false },
  'skip-sqlite': { type: 'boolean', default: false },
  'skip-artifacts': { type: 'boolean', default: false },
  'with-sqlite': { type: 'boolean', default: false },
  incremental: { type: 'boolean', default: false },
  root: { type: 'string' },
  repo: { type: 'string' },
  'tooling-scope': { type: 'string' },
  'require-steps': { type: 'string' }
};

export const BOOTSTRAP_OPTIONS = {
  'skip-install': { type: 'boolean', default: false },
  'skip-dicts': { type: 'boolean', default: false },
  'skip-index': { type: 'boolean', default: false },
  'with-sqlite': { type: 'boolean', default: false },
  incremental: { type: 'boolean', default: false },
  'skip-artifacts': { type: 'boolean', default: false },
  'skip-tooling': { type: 'boolean', default: false },
  'validate-config': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  repo: { type: 'string' }
};

export const CACHE_MAINTENANCE_OPTIONS = {
  apply: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  'allow-unmarked-cache': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  'cache-root': { type: 'string' },
  'grace-days': { type: 'number' },
  'max-deletes': { type: 'number' },
  concurrency: { type: 'number' },
  'max-bytes': { type: 'number' },
  'max-gb': { type: 'number' },
  'max-age-days': { type: 'number' },
  repo: { type: 'string' }
};

export const SQLITE_COMPACT_OPTIONS = {
  mode: { type: 'string', default: 'all' },
  repo: { type: 'string' },
  'index-root': { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  'keep-backup': { type: 'boolean', default: false },
  progress: { type: 'string', default: 'auto' },
  verbose: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false }
};

export const LMDB_BUILD_OPTIONS = {
  mode: { type: 'string', default: 'all' },
  repo: { type: 'string' },
  'index-root': { type: 'string' },
  'as-of': { type: 'string' },
  snapshot: { type: 'string' },
  validate: { type: 'boolean', default: false },
  progress: { type: 'string', default: 'auto' },
  verbose: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false }
};

export { ARCHITECTURE_CHECK_OPTIONS, SUGGEST_TESTS_OPTIONS } from '../../src/integrations/tooling/analysis-cli-options.js';

export const MAP_REPORT_OPTIONS = {
  'graph-capability': { type: 'string', description: 'Exact validated graph capability; requires an explicit retained --index-root and code mode.' },
  serve: { type: 'boolean', default: false },
  input: { type: 'string' },
  port: { type: 'number' },
  'no-open': { type: 'boolean', default: false },
  'tls-key': { type: 'string' },
  'tls-cert': { type: 'string' },
  ...MAP_BENCH_BUILD_OPTIONS,
  format: { type: 'string', default: 'json' },
  out: { type: 'string' },
  'model-out': { type: 'string' },
  'node-list-out': { type: 'string' },
  json: { type: 'boolean', default: false },
  pretty: { type: 'boolean', default: false },
  'open-uri-template': { type: 'string' },
  'three-url': { type: 'string' },
  'wasd-sensitivity': { type: 'number' },
  'wasd-acceleration': { type: 'number' },
  'wasd-max-speed': { type: 'number' },
  'wasd-drag': { type: 'number' },
  'zoom-sensitivity': { type: 'number' },
  'cache-dir': { type: 'string' },
  refresh: { type: 'boolean', default: false }
};

export const EVAL_OPTIONS = {
  repo: { type: 'string' },
  dataset: { type: 'string' },
  backend: { type: 'string', default: 'auto' },
  top: { type: 'number', default: 10 },
  limit: { type: 'number', default: 0 },
  ann: { type: 'boolean' },
  out: { type: 'string' },
  pretty: { type: 'boolean', default: false },
  'match-mode': { type: 'string' },
  progress: { type: 'string', default: 'auto' },
  verbose: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false }
};

export const SEMANTIC_DETAIL_OPTIONS = {
  request: { type: 'string', demandOption: true, description: 'Semantic detail request JSON file (at most 1 MiB).' },
  all: { type: 'boolean', default: false, description: 'Stream every bounded page as JSONL in this process.' }
};

export const GRAPH_EVIDENCE_OPTIONS = {
  request: { type: 'string', demandOption: true, description: 'Pinned graph evidence request JSON file (at most 64 KiB).' },
  all: { type: 'boolean', default: false, description: 'Stream bounded retained-family pages as JSONL.' }
};

export const SEMANTIC_TRACE_OPTIONS = {
  request: { type: 'string', demandOption: true, description: 'Semantic trace request JSON file (at most 1 MiB).' },
  all: { type: 'boolean', default: false, description: 'Stream every bounded page as JSONL in this process.' }
};

export const SEMANTIC_FIND_OPTIONS = {
  request: { type: 'string', demandOption: true, description: 'Semantic find request JSON file (at most 1 MiB).' },
  all: { type: 'boolean', default: false, description: 'Stream every bounded page as JSONL in this process.' }
};

export const SEMANTIC_EXPLAIN_OPTIONS = {
  request: { type: 'string', demandOption: true, description: 'Semantic explanation request JSON file (at most 1 MiB).' },
  all: { type: 'boolean', default: false, description: 'Stream every bounded page as JSONL in this process.' }
};

export const RUNTIME_EVIDENCE_OPTIONS = {
  operation: { type: 'string', choices: ['lookup', 'families', 'compare', 'claims'], demandOption: true },
  request: { type: 'string', demandOption: true, description: 'Strict saved runtime request JSON file (at most 1 MiB).' },
  all: { type: 'boolean', default: false, description: 'Stream bounded saved-evidence pages as JSONL.' }
};

export const RISK_EXPLAIN_OPTIONS = {
  index: { type: 'string' },
  chunk: { type: 'string' },
  max: { type: 'number', default: 20 },
  maxPartialFlows: { type: 'number', default: 20 }
  , ...RISK_PARTIAL_FLOW_OPTIONS, ...RISK_FILTER_OPTIONS, ...REPORT_FORMAT_OPTIONS };

export const RISK_DELTA_OPTIONS = {
  repo: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  seed: { type: 'string' }
  , ...RISK_PARTIAL_FLOW_OPTIONS, ...RISK_FILTER_OPTIONS, ...REPORT_FORMAT_OPTIONS };

export const createMicrobenchOptions = defaultRepo => ({
  'work-mode': { type: 'string', choices: ['retrieval', 'result-cache'], default: 'retrieval',
    describe: 'Measure actual retrieval or observed repeated result-cache hits' },
  queries: { type: 'string', describe: 'Frozen ordered query file for search microbenchmarks' },
  quality: { type: 'string', choices: ['auto', 'fast', 'balanced', 'max'], describe: 'Explicit search quality held fixed across cache work modes' },
  repo: {
    type: 'string',
    describe: 'Repo root to benchmark',
    default: defaultRepo
  },
  'repo-current': {
    type: 'boolean',
    describe: 'Use current working repo root instead of the fixture default',
    default: false
  },
  mode: {
    type: 'string',
    describe: 'Index/search mode (code|prose)',
    default: 'code'
  },
  query: {
    type: 'string',
    describe: 'Search query for microbench runs',
    default: 'function'
  },
  backend: {
    type: 'string',
    describe: 'Search backend (memory|sqlite|sqlite-fts)',
    default: 'memory'
  },
  'ann-backends': {
    type: 'string',
    describe: 'Comma-separated ANN backends for ann-backends component (sqlite-vector,lancedb,hnsw,js)',
    default: 'sqlite-vector,lancedb'
  },
  runs: {
    type: 'number',
    describe: 'Warm run count per component',
    default: 5
  },
  warmup: {
    type: 'number',
    describe: 'Warmup runs discarded before measuring warm stats',
    default: 1
  },
  threads: {
    type: 'number',
    describe: 'Index build worker threads',
    default: 0
  },
  build: {
    type: 'boolean',
    describe: 'Build indexes before search benchmarks',
    default: true
  },
  clean: {
    type: 'boolean',
    describe: 'Clean repo cache before cold index build',
    default: true
  },
  sqlite: {
    type: 'boolean',
    describe: 'Enable SQLite builds during index benchmark',
    default: false
  },
  'stub-embeddings': {
    type: 'boolean',
    describe: 'Use stub embeddings for index build',
    default: true
  },
  components: {
    type: 'string',
    describe: 'Comma-separated component list: index-build,sparse,dense,hybrid,ann-backends',
    default: 'index-build,sparse,dense,hybrid'
  },
  json: {
    type: 'boolean',
    describe: 'Emit JSON output only',
    default: false
  },
  out: {
    type: 'string',
    describe: 'Write JSON results to a file'
  }
});

export const REMOVED_FLAGS = [
  { flag: '--human', replacement: '--json' },
  { flag: '--headline', replacement: '--filter' },
  { flag: '--context', replacement: 'search.contextExpansion.* (no CLI flag)' }
];

export const SEARCH_OPTIONS = {
  repo: { type: 'string', describe: 'repository root (default: current directory)' },
  workspace: { type: 'string' },
  select: { type: 'string', array: true },
  tag: { type: 'string', array: true },
  'repo-filter': { type: 'string', array: true },
  'include-disabled': { type: 'boolean', default: false },
  merge: { type: 'string' },
  'top-per-repo': { type: 'number' },
  concurrency: { type: 'number' },
  cohort: { type: 'string', array: true },
  'allow-unsafe-mix': { type: 'boolean', default: false },
  'federated-strict': { type: 'boolean', default: false },
  'debug-include-paths': { type: 'boolean', default: false },
  'rrf-k': { type: 'number' },
  'as-of': { type: 'string' },
  snapshot: { type: 'string' },
  mode: { type: 'string', describe: 'code|prose|extracted-prose|records|both|all (default: code, prose and comments)' },
  preset: { type: 'string' },
  match: { type: 'string' },
  candidates: { type: 'number' },
  'deadline-ms': { type: 'number' },
  'output-bytes': { type: 'number' },
  top: { type: 'number', default: 5, describe: 'results per mode; page size when enumerating filters without query text' },
  json: { type: 'boolean', default: false, describe: 'emit JSON output (no stats unless --stats/--explain)' },
  cursor: { type: 'string', describe: 'continue a filter-only enumeration with the same filters and indexed generation' },
  plain: { type: 'boolean', default: false, describe: 'plain readable output without colors or hyperlinks' },
  compact: { type: 'boolean', default: false, describe: 'smaller hit projection with --json' },
  stats: { type: 'boolean', default: false, describe: 'include timing, index counts and cache diagnostics' },
  explain: { type: 'boolean', default: false, describe: 'show available ranking signals and score breakdowns' },
  why: { type: 'boolean', default: false, describe: 'show deeper explanation, including recorded analysis metadata' },
  filter: { type: 'string', describe: 'ANDed file/path, lang, ext and type filters; bare tokens mean file/path' },
  backend: { type: 'string' },
  model: { type: 'string' },
  n: { type: 'number' },
  matched: { type: 'boolean', describe: 'list query tokens found in indexed headlines (source markers are separate)' },
  ann: { type: 'boolean' },
  'allow-sparse-fallback': { type: 'boolean', default: false },
  'ann-backend': { type: 'string' },
  comments: { type: 'boolean', default: true },
  case: { type: 'boolean' },
  'case-file': { type: 'boolean' },
  'case-tokens': { type: 'boolean' },
  type: { type: 'string' },
  author: { type: 'string' },
  import: { type: 'string' },
  lang: { type: 'string' },
  ext: { type: 'string' },
  path: { type: 'string' },
  file: { type: 'string' },
  branch: { type: 'string' },
  branches: { type: 'number' },
  loops: { type: 'number' },
  breaks: { type: 'number' },
  continues: { type: 'number' },
  churn: { type: 'string' },
  meta: { type: 'string' },
  'meta-json': { type: 'string' },
  'bm25-k1': { type: 'number' },
  'bm25-b': { type: 'number' },
  'fts-profile': { type: 'string' },
  'fts-weights': { type: 'string' },
  'fts-trigram': { type: 'boolean', default: false },
  'fts-stemming': { type: 'boolean', default: false },
  'ann-candidates': { type: 'string' },
  'dense-vector-mode': { type: 'string' },
  calls: { type: 'string' },
  uses: { type: 'string' },
  signature: { type: 'string' },
  param: { type: 'string' },
  decorator: { type: 'string' },
  'inferred-type': { type: 'string' },
  'return-type': { type: 'string' },
  throws: { type: 'string' },
  reads: { type: 'string' },
  writes: { type: 'string' },
  mutates: { type: 'string' },
  alias: { type: 'string' },
  lint: { type: 'boolean' },
  awaits: { type: 'string' },
  visibility: { type: 'string' },
  extends: { type: 'string' },
  async: { type: 'boolean' },
  generator: { type: 'boolean' },
  returns: { type: 'boolean' },
  'chunk-author': { type: 'string' },
  'modified-after': { type: 'string' },
  'modified-since': { type: 'string' },
  risk: { type: 'string' },
  'risk-tag': { type: 'string' },
  'risk-source': { type: 'string' },
  'risk-sink': { type: 'string' },
  'risk-category': { type: 'string' },
  'risk-flow': { type: 'string' },
  'struct-pack': { type: 'string' },
  'struct-rule': { type: 'string' },
  'struct-tag': { type: 'string' },
  'graph-ranking-max-work': { type: 'number' },
  'graph-ranking-max-ms': { type: 'number' },
  'graph-ranking-seeds': { type: 'string' },
  'graph-ranking-seed-k': { type: 'number' },
  'stub-embeddings': { type: 'boolean' },
  'non-strict': { type: 'boolean', default: false }
};

export const SEARCH_ALIASES = Object.freeze({ n: 'top', h: 'help' });
export const SEARCH_OPTION_NAMES = Object.freeze(Object.keys(SEARCH_OPTIONS));

export const SEARCH_VALUE_FLAG_NAMES = Object.freeze(
  Object.entries(SEARCH_OPTIONS)
    .filter(([, option]) => option?.type === 'string' || option?.type === 'number')
    .map(([name]) => name)
);

export const SEARCH_BOOLEAN_FLAG_NAMES = Object.freeze(
  Object.entries(SEARCH_OPTIONS)
    .filter(([, option]) => option?.type === 'boolean')
    .map(([name]) => name)
);

export const SEARCH_SHORT_VALUE_FLAG_NAMES = Object.freeze(['n']);

export const SEARCH_VALUE_FLAGS = new Set(
  SEARCH_VALUE_FLAG_NAMES.map((name) => `--${name}`)
);

export const SEARCH_DISPATCH_METADATA = Object.freeze({
  strictDispatch: Object.freeze({
    env: 'PAIROFCLEATS_DISPATCH_STRICT',
    flag: '--strict-dispatch'
  }),
  optionMetadata: Object.freeze({
    source: 'src/retrieval/cli-options.js',
    allowedFlags: SEARCH_OPTION_NAMES,
    valueFlags: SEARCH_VALUE_FLAG_NAMES,
    booleanFlags: SEARCH_BOOLEAN_FLAG_NAMES,
    shortValueFlags: SEARCH_SHORT_VALUE_FLAG_NAMES,
    removedFlags: Object.freeze(REMOVED_FLAGS.map((entry) => entry.flag))
  })
});

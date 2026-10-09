import yargs from 'yargs/yargs';

const REMOVED_FLAGS = [
  { flag: '--human', replacement: '--json' },
  { flag: '--headline', replacement: '--filter' },
  { flag: '--context', replacement: 'search.contextExpansion.* (no CLI flag)' }
];

const SEARCH_OPTIONS = {
  repo: { type: 'string' },
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
  mode: { type: 'string' },
  preset: { type: 'string' },
  match: { type: 'string' },
  candidates: { type: 'number' },
  'deadline-ms': { type: 'number' },
  'output-bytes': { type: 'number' },
  top: { type: 'number', default: 5 },
  json: { type: 'boolean', default: false, describe: 'emit JSON output (no stats unless --stats/--explain)' },
  compact: { type: 'boolean', default: false, describe: 'compact JSON output' },
  stats: { type: 'boolean', default: false, describe: 'include stats payload' },
  explain: { type: 'boolean', default: false, describe: 'include score breakdowns' },
  why: { type: 'boolean', default: false },
  filter: { type: 'string' },
  backend: { type: 'string' },
  model: { type: 'string' },
  n: { type: 'number' },
  matched: { type: 'boolean' },
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

export function getSearchHelp({ full = false } = {}) {
  const help = {
    version: 'search-help.v1', command: 'pairofcleats search', usage: 'pairofcleats search "query" [options]',
    defaults: { top: 5, mode: 'default (code, prose and extracted-prose)', output: 'readable; --json for agents' },
    aliases: { '-n': '--top', '--n': '--top', '-h': '--help' },
    semantics: {
      query: 'Sparse search uses implicit AND. ANN free text expresses intent; use explicit AND/OR/parentheses for hard Boolean constraints.',
      constraints: 'Quoted phrases, NOT/- exclusions and structured filters remain hard constraints with ANN.',
      filters: 'Filters are ANDed. --filter bare tokens mean file/path filters; unknown keys are rejected.',
      time: '--modified-after accepts an ISO date; --modified-since accepts a number of days. These are code modification filters, not archive-message dates.',
      pagination: 'Code search supports top-k, not offset pagination. Increase --top with the same query/filters and compare stable result IDs; do not invent --offset.',
      context: 'Use context-pack with a returned file/symbol seed for related code. Archive context/role/date fields belong to the separate history reader.',
      output: '--json emits machine-readable results; --compact reduces whitespace. --stats/--explain add metadata; --why adds deeper explanation.',
      recovery: 'Missing index: build the explicitly authorized repository first. Empty hits: inspect filters and query constraints; no automatic index build or query broadening.'
    },
    examples: [
      'pairofcleats search "parseSearchArgs" --repo . --mode code --json',
      'pairofcleats search "cache AND refresh" --repo . --top 5 --json',
      'pairofcleats search "cache" --repo . --path src/retrieval --lang javascript --no-ann --json',
      'pairofcleats search "Search Pipeline" --repo . --mode prose --json',
      'pairofcleats context-pack --repo . --seed file:src/index.js --hops 1'
    ],
    more: 'pairofcleats search --help --all --json'
  };
  if (full) help.options = Object.fromEntries(Object.entries(SEARCH_OPTIONS).map(([name, field]) => [
    name, { ...field, ...(field.type === 'boolean' ? { negativeFlag: '--no-' + name } : {}) }
  ]));
  return help;
}

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
    source: 'src/retrieval/cli-args.js',
    allowedFlags: SEARCH_OPTION_NAMES,
    valueFlags: SEARCH_VALUE_FLAG_NAMES,
    booleanFlags: SEARCH_BOOLEAN_FLAG_NAMES,
    shortValueFlags: SEARCH_SHORT_VALUE_FLAG_NAMES,
    removedFlags: Object.freeze(REMOVED_FLAGS.map((entry) => entry.flag))
  })
});

/**
 * Parse CLI arguments for search.
 * @param {string[]} rawArgs
 * @returns {object}
 */
export function parseSearchArgs(rawArgs) {
  const removed = REMOVED_FLAGS.filter((entry) =>
    rawArgs.some((arg) => arg === entry.flag || arg.startsWith(`${entry.flag}=`))
  );
  if (removed.length) {
    const details = removed
      .map((entry) => `${entry.flag} was removed (use ${entry.replacement}).`)
      .join(' ');
    const error = new Error(details);
    error.code = 'REMOVED_FLAG';
    throw error;
  }

  return yargs(rawArgs)
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .options(SEARCH_OPTIONS)
    .alias({ n: 'top' })
    .help()
    .alias('h', 'help')
    .strict(false)
    .parse();
}

/**
 * Build a usage string for search CLI.
 * @returns {string}
 */
export function getSearchUsage() {
  return [
    'usage: search "query" [options]',
    '',
    'Options:',
    '  --repo <path>',
    '  --workspace <path>',
    '  --select <repoId|alias|path> (repeatable)',
    '  --tag <tag> (repeatable)',
    '  --repo-filter <glob> (repeatable)',
    '  --include-disabled',
    '  --merge rrf',
    '  --top-per-repo <N>',
    '  --concurrency <N>',
    '  --cohort <key|mode:key> (repeatable)',
    '  --allow-unsafe-mix',
    '  --federated-strict',
    '  --as-of <IndexRef>',
    '  --snapshot <snapshotId> (compatibility alias for --as-of snap:<id>)',
    '  --mode code|prose|extracted-prose|records|both|all',
    '  --top N',
    '  --json (compact JSON; stats only with --stats or --explain)',
    '  --compact',
    '  --stats',
    '  --explain',
    '  --calls',
    '  --uses',
    '  --author "<name>"',
    '  --chunk-author "<name>"',
    '  --import "<path>"',
    '  --lang <language-id>',
    '  --ext <extension>',
    '  --dense-vector-mode merged|code|doc|auto',
    '  --modified-after <iso-date>',
    '  --modified-since <days>',
    '  --filter "<expr>"',
    '  --graph-ranking-max-work <N>',
    '  --graph-ranking-max-ms <N>',
    '  --graph-ranking-seeds top1|topK|none',
    '  --graph-ranking-seed-k <N>',
    '  --bm25-k1 <N>',
    '  --bm25-b <N>',
    '  --fts-profile <profile>',
    '  --fts-weights <json|list>',
    '  --fts-trigram',
    '  --fts-stemming',
    '  --ann-candidates independent|lexical-rerank',
    '  --preset fast|hybrid|investigate --match all|any|auto',
    '  --candidates N --top N --deadline-ms N --output-bytes N',
    '  --ann-backend auto|lancedb|sqlite|hnsw|js',
    '  --allow-sparse-fallback',
    '  --non-strict'
  ].join('\n');
}

/**
 * Resolve the requested search mode and derived flags.
 * @param {string|undefined} modeRaw
 * @returns {{searchMode:string,runCode:boolean,runProse:boolean,runRecords:boolean,runExtractedProse:boolean}}
 */
export function resolveSearchMode(modeRaw) {
  const normalized = modeRaw == null ? '' : String(modeRaw).trim().toLowerCase();
  if (!normalized) {
    return {
      searchMode: 'default',
      runCode: true,
      runProse: true,
      runRecords: false,
      runExtractedProse: true
    };
  }
  const allowedModes = new Set(['code', 'prose', 'both', 'extracted-prose', 'records', 'all']);
  if (!allowedModes.has(normalized)) {
    const error = new Error(`Invalid --mode ${normalized}. Use code|prose|both|extracted-prose|records|all.`);
    error.code = 'INVALID_MODE';
    throw error;
  }
  const runCode = normalized === 'code' || normalized === 'both' || normalized === 'all';
  const runProse = normalized === 'prose' || normalized === 'both' || normalized === 'all';
  const runRecords = normalized === 'records' || normalized === 'all';
  const runExtractedProse = normalized === 'extracted-prose' || runProse;
  return {
    searchMode: normalized,
    runCode,
    runProse,
    runRecords,
    runExtractedProse
  };
}

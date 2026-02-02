import yargs from 'yargs/yargs';

const REMOVED_FLAGS = [
  { flag: '--human', replacement: '--json' },
  { flag: '--headline', replacement: '--filter' },
  { flag: '--context', replacement: 'search.contextExpansion.* (no CLI flag)' }
];

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

  const options = {
    repo: { type: 'string' },
    mode: { type: 'string' },
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

  return yargs(rawArgs)
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .options(options)
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
    '  --ann-backend auto|lancedb|sqlite|hnsw|js',
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

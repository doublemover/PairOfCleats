import yargs from 'yargs/yargs';
import { optionPrefix } from '../shared/cli/option-prefix.js';
export { SEARCH_FILTER_OPTION_NAMES, hasSearchFilterArgs } from '../shared/search-request.js';

import { REMOVED_FLAGS, SEARCH_OPTIONS, SEARCH_ALIASES } from './cli-options.js';
export { SEARCH_OPTION_NAMES, SEARCH_VALUE_FLAG_NAMES, SEARCH_BOOLEAN_FLAG_NAMES, SEARCH_SHORT_VALUE_FLAG_NAMES, SEARCH_VALUE_FLAGS, SEARCH_DISPATCH_METADATA } from './cli-options.js';

export function getSearchHelp({ full = false } = {}) {
  const help = {
    version: 'search-help.v1', command: 'pairofcleats search', usage: 'pairofcleats search ["query"] [options]',
    defaults: { top: 5, mode: 'default (code, prose and extracted-prose)', output: 'readable; --json for agents' },
    aliases: { '-n': '--top', '--n': '--top', '-h': '--help' },
    semantics: {
      query: 'Sparse search uses implicit AND. ANN free text expresses intent; use explicit AND/OR/parentheses for hard Boolean constraints.',
      constraints: 'Quoted phrases, NOT/- exclusions and structured filters remain hard constraints with ANN.',
      filters: 'Filters are ANDed. --filter bare tokens mean file/path filters; unknown keys are rejected. --return-type matches a complete, case-sensitive type expression, not a substring or an assignability test.',
      time: '--modified-after accepts an ISO date; --modified-since accepts a number of days. These are code modification filters, not archive-message dates.',
      pagination: 'Omit query and supply filters to enumerate indexed matches. --top sets page size per mode; pass nextCursor with --cursor and the same filters. A changed generation rejects the cursor. Ranked text queries remain top-k.',
      context: 'Use context-pack with a returned file/symbol seed for related code. Archive context/role/date fields belong to the separate history reader.',
      output: 'Readable output is the default; --plain disables colors and links. Source excerpts use current files at indexed offsets and may differ after edits; > marks literal query text, not ranking evidence. --json emits machine-readable results; --compact selects a smaller hit projection. --stats/--explain add metadata; --why adds deeper explanation.',
      recovery: 'Missing index: build the explicitly authorized repository first. Empty hits: inspect filters and query constraints; no automatic index build or query broadening.'
    },
    examples: [
      'pairofcleats search "parseSearchArgs" --repo . --mode code',
      'pairofcleats search "cache AND refresh" --repo . --explain',
      'pairofcleats search --return-type boolean --mode code --top 20 --json',
      'pairofcleats search --type ClassDeclaration --mode code --json',
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

/**
 * Parse CLI arguments for search.
 * @param {string[]} rawArgs
 * @returns {object}
 */
export function parseSearchArgs(rawArgs) {
  const removed = REMOVED_FLAGS.filter((entry) =>
    optionPrefix(rawArgs).some((arg) => arg === entry.flag || arg.startsWith(`${entry.flag}=`))
  );
  if (removed.length) {
    const details = removed
      .map((entry) => `${entry.flag} was removed. ${entry.remedy} See pairofcleats search --help --all --json.`)
      .join(' ');
    const error = new Error(details);
    error.code = 'REMOVED_FLAG';
    error.remedies = removed.map(({ flag, kind, remedy, configPath }) => ({ flag, kind, remedy,
      ...(configPath ? { configPath } : {}) }));
    throw error;
  }

  return yargs(rawArgs)
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .options(SEARCH_OPTIONS)
    .help()
    .alias(SEARCH_ALIASES)
    .strict(false)
    .parse();
}

/**
 * Build a usage string for search CLI.
 * @returns {string}
 */
export function getSearchUsage() {
  return [
    'usage: search ["query"] [options]',
    '',
    'Start here:',
    '  pairofcleats search "parseSearchArgs" --repo . --mode code',
    '  pairofcleats search "cache AND refresh" --explain',
    '  pairofcleats search --return-type boolean --mode code --top 20',
    '',
    'Readable results are the default. --plain disables colors and links.',
    'Source excerpts use current files at indexed offsets; edits may differ.',
    '> marks literal query text in an excerpt, not a relevance explanation.',
    'Use --explain for scores, --why for details, or --json for machine output.',
    'Sparse search uses implicit AND; filters narrow results without broadening them.',
    '',
    'Options:',
    '  --cursor <nextCursor> (filter-only pagination; reuse the same filters)',
    '  --plain (disable terminal styling and hyperlinks)',
    '  Omit query with filters to enumerate every indexed match, page by page.',
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
    '  --top N (default: 5 per mode; filter-only page size)',
    '  --json (machine-readable output; stats only with --stats or --explain)',
    '  --compact (smaller hit projection with --json)',
    '  --stats',
    '  --explain',
    '  --why (deeper explanation and recorded analysis metadata)',
    '  --matched (query tokens found in indexed headlines)',
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

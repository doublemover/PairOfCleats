import yargs from 'yargs/yargs';

const BOOLEAN_FLAGS = [
  'json',
  'json-compact',
  'human',
  'stats',
  'ann',
  'headline',
  'lint',
  'matched',
  'async',
  'generator',
  'returns',
  'explain',
  'why',
  'case',
  'case-file',
  'case-tokens'
];

const STRING_FLAGS = [
  'calls',
  'uses',
  'signature',
  'param',
  'decorator',
  'inferred-type',
  'return-type',
  'throws',
  'reads',
  'writes',
  'mutates',
  'churn',
  'alias',
  'awaits',
  'branches',
  'loops',
  'breaks',
  'continues',
  'risk',
  'risk-tag',
  'risk-source',
  'risk-sink',
  'risk-category',
  'risk-flow',
  'meta',
  'meta-json',
  'file',
  'ext',
  'lang',
  'chunk-author',
  'modified-after',
  'modified-since',
  'visibility',
  'extends',
  'mode',
  'backend',
  'path',
  'model',
  'repo',
  'branch',
  'fts-profile',
  'fts-weights',
  'bm25-k1',
  'bm25-b'
];

const ALIASES = { n: 'top', c: 'context', t: 'type', why: 'explain' };
const DEFAULTS = { n: 5, context: 3 };

/**
 * Parse CLI arguments for search.
 * @param {string[]} rawArgs
 * @returns {object}
 */
export function parseSearchArgs(rawArgs) {
  const options = {
    n: { type: 'number', default: DEFAULTS.n },
    context: { type: 'number', default: DEFAULTS.context }
  };
  for (const flag of BOOLEAN_FLAGS) {
    options[flag] = { type: 'boolean' };
  }
  for (const flag of STRING_FLAGS) {
    options[flag] = { type: 'string' };
  }
  return yargs(rawArgs)
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .options(options)
    .alias(ALIASES)
    .help()
    .alias('h', 'help')
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
    '  --mode code|prose|both|records|all',
    '  --backend memory|sqlite|sqlite-fts',
    '  --top N, --context N',
    '  --json | --json-compact | --human | --stats',
    '  --ann | --no-ann',
    '  --model <id>',
    '  --fts-profile <name> | --fts-weights <json|csv>',
    '  --bm25-k1 <num> | --bm25-b <num>',
    '  --headline | --matched | --explain | --why',
    '  Filters:',
    '    --type <kind> --author <name> --import <module> --calls <name> --uses <name>',
    '    --signature <text> --param <name> --decorator <name> --inferred-type <type> --return-type <type>',
    '    --throws <name> --reads <name> --writes <name> --mutates <name> --alias <name> --awaits <name>',
    '    --branches <min> --loops <min> --breaks <min> --continues <min>',
    '    --risk <tag> --risk-tag <tag> --risk-source <name> --risk-sink <name> --risk-category <name> --risk-flow <name>',
    '    --visibility <name> --extends <name> --async --generator --returns --lint',
    '    --churn [min] --modified-after <date> --modified-since <days> --chunk-author <name>',
    '    --path <pattern> --file <pattern> --ext <.ext> --lang <language> --branch <name>',
    '    --case --case-file --case-tokens',
    '    --meta <k=v> --meta-json <json>'
  ].join('\n');
}

/**
 * Resolve the requested search mode and derived flags.
 * @param {string|undefined} modeRaw
 * @returns {{searchMode:string,runCode:boolean,runProse:boolean,runRecords:boolean}}
 */
export function resolveSearchMode(modeRaw) {
  const searchMode = String(modeRaw || 'both').toLowerCase();
  const allowedModes = new Set(['code', 'prose', 'both', 'records', 'all']);
  if (!allowedModes.has(searchMode)) {
    const error = new Error(`Invalid --mode ${searchMode}. Use code|prose|both|records|all.`);
    error.code = 'INVALID_MODE';
    throw error;
  }
  const runCode = searchMode === 'code' || searchMode === 'both' || searchMode === 'all';
  const runProse = searchMode === 'prose' || searchMode === 'both' || searchMode === 'all';
  const runRecords = searchMode === 'records' || searchMode === 'all';
  return { searchMode, runCode, runProse, runRecords };
}

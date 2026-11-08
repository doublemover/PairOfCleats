import { getToolVersion } from '../../../tools/dict-utils/tool.js';
import { ANSI } from '../../shared/cli/ansi-utils.js';
import { ERROR_CODES } from '../../shared/error-codes.js';
import { getSearchHelp, getSearchUsage, hasSearchFilterArgs, parseSearchArgs, resolveSearchMode, SEARCH_VALUE_FLAGS } from '../cli-args.js';
import { formatHumanError, inferJsonOutputFromArgs } from './runner.js';
import { wrapTerminalText } from '../output/format/shared.js';
import { optionPrefix } from '../../shared/cli/option-prefix.js';

const resolveHelpWidth = (stdout = process.stdout) => {
  const envColumns = Number.parseInt(String(process.env.COLUMNS || ''), 10);
  if (Number.isFinite(envColumns) && envColumns >= 20) return Math.min(envColumns, 500);
  const streamColumns = Number.parseInt(String(stdout?.columns ?? ''), 10);
  if (Number.isFinite(streamColumns) && streamColumns >= 20) return Math.min(streamColumns, 500);
  return 100;
};

const wrapParagraph = (text, width, indent = '') => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [indent.trimEnd()];
  const lines = [];
  let line = indent;
  for (const word of words) {
    const candidate = line.trim().length ? `${line} ${word}` : `${indent}${word}`;
    if (candidate.length > width && line.trim().length) {
      lines.push(line);
      line = `${indent}${word}`;
    } else {
      line = candidate;
    }
  }
  if (line.trim().length) lines.push(line);
  return lines;
};

const isColorAllowed = (stream = process.stdout) => Boolean(stream?.isTTY) && !Object.hasOwn(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb';
const heading = (text, color = true) => color ? `${ANSI.bold}${text}${ANSI.reset}` : text;
const dim = (text, color = true) => color ? `${ANSI.fgDarkGray}${text}${ANSI.reset}` : text;
const cyan = (text, color = true) => color ? `${ANSI.fgCyan}${text}${ANSI.reset}` : text;

const formatFlagList = (items, width) => items.flatMap((item) => wrapParagraph(item, width, '  '));

const emitCliError = ({ stdout, message, jsonOutput }) => {
  if (jsonOutput) {
    stdout.write(`${JSON.stringify({ ok: false, code: ERROR_CODES.INVALID_REQUEST, message })}\n`);
    return;
  }
  process.stderr.write(formatHumanError(message, ERROR_CODES.INVALID_REQUEST));
};

const findMissingValueFlag = (args) => {
  args = optionPrefix(args);
  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] || '');
    if (!SEARCH_VALUE_FLAGS.has(current)) continue;
    const next = index + 1 < args.length ? String(args[index + 1] || '') : '';
    if (!next || next === '--' || next.startsWith('--')) {
      return current;
    }
  }
  return null;
};

export async function runCli({
  rawArgs = process.argv.slice(2),
  stdout = process.stdout
} = {}) {
  const args = rawArgs.slice();
  if (hasHelpArg(args)) {
    printHelp(stdout, { full: optionPrefix(args).includes('--all'), json: optionPrefix(args).includes('--json') });
    return 0;
  }
  if (hasVersionArg(args)) {
    printVersion(stdout);
    return 0;
  }

  const { jsonOutput } = inferJsonOutputFromArgs(args);
  const missingValueFlag = findMissingValueFlag(args);
  if (missingValueFlag) {
    emitCliError({
      stdout,
      jsonOutput,
      message: `Missing value for ${missingValueFlag}.`
    });
    return 1;
  }

  let argv;
  try {
    argv = parseSearchArgs(args);
  } catch (error) {
    emitCliError({
      stdout,
      jsonOutput,
      message: error?.message || 'Invalid arguments.'
    });
    return 1;
  }

  const query = Array.isArray(argv?._)
    ? argv._.map((value) => String(value || '').trim()).filter(Boolean).join(' ').trim()
    : '';
  if (!query && !hasSearchFilterArgs(argv)) {
    emitCliError({
      stdout,
      jsonOutput,
      message: getSearchUsage()
    });
    return 1;
  }

  try {
    resolveSearchMode(argv.mode);
  } catch (error) {
    emitCliError({
      stdout,
      jsonOutput,
      message: error?.message || 'Invalid --mode.'
    });
    return 1;
  }

  const { search } = await import('../../integrations/core/search.js');
  await search(null, { args, argsMode: 'complete', emitOutput: true, exitOnError: true });
  return 0;
}

export function hasHelpArg(values) {
  return optionPrefix(values).some((value) => (
    value === '--help' || value === '-h'
  ));
}

export function hasVersionArg(values) {
  return optionPrefix(values).some((value) => (
    value === '--version' || value === '-v'
  ));
}

export function printHelp(stdout = process.stdout, { full = false, json = false } = {}) {
  const guide = getSearchHelp({ full });
  if (json) { stdout.write(JSON.stringify(guide) + '\n'); return; }
  const width = resolveHelpWidth(stdout);
  const writeHelp = (text) => stdout.write(stdout.isTTY ? wrapTerminalText(text, width) : text);
  if (full) {
    writeHelp('PairOfCleats Search: all options\n' + Object.entries(guide.options).map(([name, field]) =>
      '--' + name + (field.type === 'boolean' ? ' / --no-' + name : ' <' + field.type + '>')
      + (Object.hasOwn(field, 'default') ? ' (default ' + JSON.stringify(field.default) + ')' : '')
      + (field.describe ? ' ' + field.describe : '')).join('\n') + '\n');
    return;
  }
  const color = isColorAllowed(stdout);
  const lines = [
    heading('PairOfCleats Search', color),
    dim('Search code, prose, extracted comments, and records from a built PairOfCleats index.', color),
    '',
    heading('Usage', color),
    '  Usage: search [query] [options]',
    '  pairofcleats search [query] [options]',
    '  search [query] [options]',
    '',
    heading('Modes', color),
    ...formatFlagList([
      '--mode <code|prose|records|extracted-prose|both|all>  Select the search surface.',
      '--repo <path>  Search a specific repo root.',
      '--as-of <IndexRef> / --snapshot <snapshotId>  Query a stable index view.'
    ], width),
    '',
    heading('Filters', color),
    ...formatFlagList([
      '--path <glob> / --file <path> / --ext <ext> / --lang <lang>',
      '--author <name> / --modified-after <ISO-date> / --modified-since <days> / --type <symbol-kind>',
      '--calls <symbol> / --uses <symbol> / --import <path-or-symbol> / --risk <filter>'
    ], width),
    '',
    heading('Output', color),
    ...formatFlagList([
      '--top <N>  Request N ranked hits per mode (default 5); filter-only page size.',
      '--json  Emit machine-readable payloads; add --compact for a smaller hit projection.',
      '--cursor <nextCursor>  Continue filter-only enumeration with the same filters.',
      '--plain  Disable styling and hyperlinks.',
      '--stats / --explain  Show retrieval metadata or summary ranking explanation.',
      '--why  Show full explain detail, including deeper relation and dataflow sections.',
      '--ann / --no-ann / --backend <auto|sqlite|sqlite-fts|fts|lmdb|tantivy|memory>'
    ], width),
    '',
    heading('Starter Recipes', color),
    '  pairofcleats search parseSearchArgs --mode code',
    '  pairofcleats search "cache AND refresh" --repo . --explain',
    '  pairofcleats search --return-type boolean --mode code --top 20',
    '  pairofcleats search "Search Pipeline" --mode prose',
    '  pairofcleats search withLspSession --calls startProvider',
    '  pairofcleats search risk --risk severity=high --explain',
    '  pairofcleats search scoreBreakdown --path src/retrieval/output --why',
    '',
    heading('Query and Continuation', color),
    ...Object.values(guide.semantics).flatMap(text => wrapParagraph(text, width, '  ')),
    '',
    '  Defaults: --top 5; omitted mode searches code, prose and extracted comments.',
    '  Full option reference: pairofcleats search --help --all',
    '  Agent schema: pairofcleats search --help --all --json',
    '',
    heading('Notes', color),
    ...wrapParagraph(
      'If no index is present, run `pairofcleats index build` first. Use `search --version` to print the tool version.',
      width,
      '  '
    ),
    ''
  ];
  writeHelp(`${lines.join('\n')}\n`);
}

export function printVersion(stdout = process.stdout) {
  const version = getToolVersion() || '0.0.0';
  stdout.write(`${version}\n`);
}

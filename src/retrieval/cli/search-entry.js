import { getToolVersion } from '../../../tools/dict-utils/tool.js';
import { ANSI } from '../../shared/cli/ansi-utils.js';

const resolveHelpWidth = (stdout = process.stdout) => {
  const envColumns = Number.parseInt(String(process.env.COLUMNS || ''), 10);
  if (Number.isFinite(envColumns) && envColumns >= 48) return envColumns;
  const streamColumns = Number.parseInt(String(stdout?.columns ?? ''), 10);
  if (Number.isFinite(streamColumns) && streamColumns >= 48) return streamColumns;
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

const isColorAllowed = (stream = process.stdout) => Boolean(stream?.isTTY);
const heading = (text, color = true) => color ? `${ANSI.bold}${text}${ANSI.reset}` : text;
const dim = (text, color = true) => color ? `${ANSI.fgDarkGray}${text}${ANSI.reset}` : text;
const cyan = (text, color = true) => color ? `${ANSI.fgCyan}${text}${ANSI.reset}` : text;

const formatFlagList = (items, width) => items.flatMap((item) => wrapParagraph(item, width, '  '));

export async function runCli({
  rawArgs = process.argv.slice(2),
  stdout = process.stdout
} = {}) {
  const args = rawArgs.slice();
  if (hasHelpArg(args)) {
    printHelp(stdout);
    return 0;
  }
  if (hasVersionArg(args)) {
    printVersion(stdout);
    return 0;
  }

  const { search } = await import('../../integrations/core/index.js');
  await search(null, { args, emitOutput: true, exitOnError: true });
  return 0;
}

export function hasHelpArg(values) {
  return Array.isArray(values) && values.some((value) => (
    value === '--help' || value === '-h'
  ));
}

export function hasVersionArg(values) {
  return Array.isArray(values) && values.some((value) => (
    value === '--version' || value === '-v'
  ));
}

export function printHelp(stdout = process.stdout) {
  const width = resolveHelpWidth(stdout);
  const color = isColorAllowed(stdout);
  const lines = [
    heading('PairOfCleats Search', color),
    dim('Search code, prose, extracted comments, and records from a built PairOfCleats index.', color),
    '',
    heading('Usage', color),
    '  Usage: search <query> [options]',
    '  pairofcleats search <query> [options]',
    '  search <query> [options]',
    '',
    heading('Modes', color),
    ...formatFlagList([
      '--mode <code|prose|records|extracted-prose|default>  Select the search surface.',
      '--repo <path>  Search a specific repo root.',
      '--as-of <IndexRef> / --snapshot <snapshotId>  Query a stable index view.'
    ], width),
    '',
    heading('Filters', color),
    ...formatFlagList([
      '--path <glob> / --file <path> / --ext <ext> / --lang <lang>',
      '--author <name> / --modified-since <date> / --type <symbol-kind>',
      '--calls <symbol> / --uses <symbol> / --import <path-or-symbol> / --risk <filter>'
    ], width),
    '',
    heading('Output', color),
    ...formatFlagList([
      '--json / --compact  Emit machine-readable payloads.',
      '--stats / --explain  Show retrieval metadata or summary ranking explanation.',
      '--why  Show full explain detail, including deeper relation and dataflow sections.',
      '--ann / --no-ann / --backend <auto|sqlite|sqlite-fts|lmdb>'
    ], width),
    '',
    heading('Starter Recipes', color),
    '  pairofcleats search parseSearchArgs --mode code',
    '  pairofcleats search "Search Pipeline" --mode prose',
    '  pairofcleats search withLspSession --calls startProvider',
    '  pairofcleats search risk --risk severity=high --explain',
    '  pairofcleats search scoreBreakdown --path src/retrieval/output --why',
    '',
    heading('Notes', color),
    ...wrapParagraph(
      'If no index is present, run `pairofcleats index build` first. Use `search --version` to print the tool version.',
      width,
      '  '
    ),
    ''
  ];
  stdout.write(`${lines.join('\n')}\n`);
}

export function printVersion(stdout = process.stdout) {
  const version = getToolVersion() || '0.0.0';
  stdout.write(`${version}\n`);
}

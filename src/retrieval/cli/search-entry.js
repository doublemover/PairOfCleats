import { getToolVersion } from '../../../tools/dict-utils/tool.js';

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
  stdout.write(`Usage: search "<query>" [options]

Common options:
  --mode <code|prose|records|extracted-prose|default>
  --repo <path>
  --as-of <IndexRef>
  --snapshot <snapshotId>
  --backend <auto|sqlite|sqlite-fts|lmdb>
  --json
  --compact
  --stats
  --ann / --no-ann

Examples:
  search "needle"
  search --mode code "symbol"
  search --help
  search --version
`);
}

export function printVersion(stdout = process.stdout) {
  stdout.write(`${getToolVersion() || '0.0.0'}\n`);
}

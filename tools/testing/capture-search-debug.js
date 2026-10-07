#!/usr/bin/env node
import path from 'node:path';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { captureSearchDebugRun } from './search-debug-capture.js';

const USAGE = `Usage:
  node tools/testing/capture-search-debug.js [options] -- <search args...>
  node tools/testing/capture-search-debug.js <search args...>

Options:
  --label <name>         Friendly label for the output folder
  --logs-root <path>     Override output root (default: .testLogs/search-debug or .testLogs/search-terminal-review with --pty)
  --cwd <path>           Working directory for the search process
  --search-entry <path>  Override search entrypoint (default: ./search.js)
  --pty                  Capture through a real PTY/ConPTY terminal
  --no-force-color       Do not inject FORCE_COLOR/TERM overrides
  --json-summary         Print the resulting metadata JSON to stdout
  --help                 Show this help
`;

const parseArgs = (argv) => {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {
    label: null,
    logsRoot: null,
    cwd: process.cwd(),
    searchEntrypoint: path.join(process.cwd(), 'search.js'),
    pty: false,
    forceColor: true,
    jsonSummary: false
  };
  const separatorIndex = args.indexOf('--');
  const searchArgs = [];
  const limit = separatorIndex >= 0 ? separatorIndex : args.length;

  for (let index = 0; index < limit; index += 1) {
    const arg = String(args[index] || '');
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--no-force-color') {
      options.forceColor = false;
      continue;
    }
    if (arg === '--pty') {
      options.pty = true;
      continue;
    }
    if (arg === '--json-summary') {
      options.jsonSummary = true;
      continue;
    }
    if (arg === '--label' || arg === '--logs-root' || arg === '--cwd' || arg === '--search-entry') {
      const next = args[index + 1];
      if (next == null) {
        throw new Error(`Missing value for ${arg}`);
      }
      if (arg === '--label') options.label = String(next);
      if (arg === '--logs-root') options.logsRoot = path.resolve(String(next));
      if (arg === '--cwd') options.cwd = path.resolve(String(next));
      if (arg === '--search-entry') options.searchEntrypoint = path.resolve(String(next));
      index += 1;
      continue;
    }
    searchArgs.push(arg);
  }

  if (separatorIndex >= 0) {
    searchArgs.push(...args.slice(separatorIndex + 1).map((entry) => String(entry)));
  }

  return {
    options,
    searchArgs
  };
};

export const runCaptureSearchDebugCli = async (argv = process.argv.slice(2)) => {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error?.message || error);
    console.error(USAGE);
    return 1;
  }
  if (parsed.options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!parsed.searchArgs.length) {
    console.error('No search arguments provided.');
    console.error(USAGE);
    return 1;
  }

  const meta = await captureSearchDebugRun({
    rootDir: process.cwd(),
    searchArgs: parsed.searchArgs,
    logsRoot: parsed.options.logsRoot,
    label: parsed.options.label,
    cwd: parsed.options.cwd,
    pty: parsed.options.pty,
    forceColor: parsed.options.forceColor,
    searchEntrypoint: parsed.options.searchEntrypoint
  });

  if (parsed.options.jsonSummary) {
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(`search debug captured: ${meta.outputDir}`);
    console.log(`mode=${meta.mode || 'pipe'}`);
    console.log(`status=${meta.status} exitCode=${meta.exitCode == null ? 'null' : meta.exitCode}`);
    if (meta.files.terminalRaw) {
      console.log(`terminal=${meta.files.terminalRaw}`);
      console.log(`plain=${meta.files.terminalPlain}`);
    } else {
      console.log(`stdout=${meta.files.stdoutRaw}`);
      console.log(`stderr=${meta.files.stderrRaw}`);
      console.log(`combined=${meta.files.combinedRaw}`);
    }
    console.log(`meta=${meta.files.metaJson}`);
  }
  return Number.isInteger(meta.exitCode) ? meta.exitCode : 1;
};

if (isDirectExecution(import.meta.url)) {
  const exitCode = await runCaptureSearchDebugCli();
  process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 1;
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import {
  emitIngestSummaryJson,
  withStagedIngestOutput,
  ingestTextLineStream,
  normalizeRepoRelativePath,
  normalizeTimeoutMs,
  splitCliArgs,
  writeIngestSummaryReport,
  writeJsonLine
} from './shared.js';
import { runLineStreamingCommand } from './shared-runner.js';

const argv = createCli({
  scriptName: 'gtags-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    global: { type: 'string', default: 'global' },
    args: { type: 'string' },
    'timeout-ms': { type: 'number' }
  }
}).strictOptions().parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outputPath = argv.out
  ? path.resolve(argv.out)
  : path.join(cacheRoot, 'gtags', 'gtags.jsonl');
const metaPath = `${outputPath}.meta.json`;
const inputPath = argv.input ? String(argv.input) : null;
const runGlobal = argv.run === true;
const globalCmd = argv.global || 'global';
const commandTimeoutMs = normalizeTimeoutMs(argv['timeout-ms']);
const suppliedArgs = argv.args ? splitCliArgs(argv.args) : [];
const marker = suppliedArgs.indexOf('--');
const optionArgs = marker < 0 ? suppliedArgs : suppliedArgs.slice(0, marker);
const shortFlags = token => /^-[acdfgIPpuVdEFGilMnNqrstTvx]+$/.test(token) ? token.slice(1) : '';
const referenceQuery = optionArgs.some(token => token === '--reference' || token === '--symbol' || /[rs]/.test(shortFlags(token)));
const recordRole = runGlobal && referenceQuery ? 'reference' : 'definition';

const normalizePath = (value) => {
  return normalizeRepoRelativePath(repoRoot, value);
};

const stats = {
  entries: 0,
  errors: 0
};

let writeStream = null;

const parseGlobalLine = (line) => {
  // cxref is name, line, encoded path, then an optional arbitrary source image.
  const fields = /^[ \t]*([^ \t\r\n]+)[ \t]+([0-9]+)[ \t]+([^ \t\r\n]+)(?:[ \t]+.*)?$/.exec(line);
  if (!fields) return null;
  const name = fields[1], lineNo = Number(fields[2]);
  let decoded;
  try { decoded = decodeURIComponent(fields[3]); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const file = normalizePath(decoded);
  if (!file || !Number.isSafeInteger(lineNo) || lineNo < 1) return null;
  return { file, name, line: lineNo };
};

const handleGlobalLine = async (line) => {
  const parsed = parseGlobalLine(line);
  if (!parsed) {
    if (line.trim()) stats.errors += 1;
    return;
  }
  stats.entries += 1;
  await writeJsonLine(writeStream, {
    file: parsed.file,
    ext: path.extname(parsed.file).toLowerCase(),
    name: parsed.name,
    startLine: parsed.line,
    endLine: parsed.line,
    role: recordRole,
    source: 'gtags'
  });
};

const ingestTextLines = async (stream) => {
  await ingestTextLineStream(stream, handleGlobalLine);
};

const runGlobalCommand = async () => {
  if (optionArgs.some(token => /^--(?:completion|grep|idutils|path|print(?:-dbpath)?|update|single-update|help|version|directory)(?:=|$)/.test(token)
    || /[cgIPpuV]/.test(shortFlags(token)) || /^-C/.test(token))) {
    throw new Error('GTAGS ingest supports symbol/file tag queries within --repo; other commands and directory overrides do not produce scoped symbol occurrences.');
  }
  if (optionArgs.some(token => /^--(?:result|encode-path|color)(?:=|$)/.test(token) || shortFlags(token).includes('t'))) {
    throw new Error('GTAGS ingest owns the cxref format, path encoding and color options. Pass search selection arguments only.');
  }
  if (optionArgs.some(token => /^--from-here(?:=|$)/.test(token))) {
    throw new Error('GTAGS ingest requires an explicit definition or reference query; --from-here has context-dependent roles.');
  }
  const args = ['-x', '--result=ctags-x', '--encode-path= \t%', '--color=never',
    ...(suppliedArgs.length ? suppliedArgs : ['.'])];
  await runLineStreamingCommand({
    command: globalCmd,
    args,
    cwd: repoRoot,
    timeoutMs: commandTimeoutMs,
    onStdoutLine: async (line) => {
      await handleGlobalLine(line);
    },
    onStderrChunk: (chunk) => process.stderr.write(chunk)
  });
};

await withStagedIngestOutput(outputPath, async (stream) => {
  writeStream = stream;
  if (runGlobal) {
    await runGlobalCommand();
  } else if (inputPath && inputPath !== '-') {
    const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    await ingestTextLines(inputStream);
  } else {
    await ingestTextLines(process.stdin);
  }
});

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || (runGlobal ? 'global' : 'stdin'),
  output: path.resolve(outputPath),
  stats
};
await writeIngestSummaryReport(metaPath, summary);

if (argv.json) {
  emitIngestSummaryJson(summary);
} else {
  console.error(`GTAGS ingest: ${stats.entries} entries (${stats.errors} parse errors)`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}

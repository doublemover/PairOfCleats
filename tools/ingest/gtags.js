#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import {
  emitIngestSummaryJson,
  ensureParentDir,
  finishWriteStream,
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
}).parse();

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

const normalizePath = (value) => {
  return normalizeRepoRelativePath(repoRoot, value);
};

const stats = {
  entries: 0,
  errors: 0
};

let writeStream = null;

const parseGlobalLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;
  const name = parts[0];
  const lineNo = Number.parseInt(parts[1], 10);
  const file = normalizePath(parts.slice(2).join(' '));
  if (!name || !file || !Number.isFinite(lineNo)) return null;
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
    role: 'definition',
    source: 'gtags'
  });
};

const ingestTextLines = async (stream) => {
  await ingestTextLineStream(stream, handleGlobalLine);
};

const runGlobalCommand = async () => {
  const args = ['-x'];
  if (argv.args) {
    args.push(...splitCliArgs(argv.args));
  }
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

await ensureParentDir(outputPath);
writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
if (runGlobal) {
  await runGlobalCommand();
} else if (inputPath && inputPath !== '-') {
  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
  await ingestTextLines(inputStream);
} else {
  await ingestTextLines(process.stdin);
}

writeStream.end();
await finishWriteStream(writeStream);

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

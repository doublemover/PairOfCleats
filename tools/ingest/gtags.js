#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createCli } from '../../src/shared/cli.js';
import { isAbsolutePathNative, isRelativePathEscape, toPosix } from '../../src/shared/files.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
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
const commandTimeoutMs = Number.isFinite(Number(argv['timeout-ms']))
  ? Math.max(1000, Math.floor(Number(argv['timeout-ms'])))
  : null;

const normalizePath = (value) => {
  if (!value) return null;
  const raw = String(value);
  const resolved = isAbsolutePathNative(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, resolved);
  const normalized = toPosix(rel || raw);
  if (!normalized || normalized === '.') return null;
  if (isAbsolutePathNative(normalized) || isRelativePathEscape(normalized)) return null;
  return normalized;
};

const stats = {
  entries: 0,
  errors: 0
};

const ensureOutputDir = async () => {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
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

const ingestTextLines = async (stream) => {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let streamError = null;
  const onStreamError = (error) => {
    streamError = error || new Error('Input stream failed.');
    rl.close();
  };
  stream.once('error', onStreamError);
  try {
    for await (const line of rl) {
      const parsed = parseGlobalLine(line);
      if (!parsed) {
        if (line.trim()) stats.errors += 1;
        continue;
      }
      stats.entries += 1;
      const payload = {
        file: parsed.file,
        ext: path.extname(parsed.file).toLowerCase(),
        name: parsed.name,
        startLine: parsed.line,
        endLine: parsed.line,
        role: 'definition',
        source: 'gtags'
      };
      writeStream.write(`${JSON.stringify(payload)}\n`);
    }
  } finally {
    stream.off('error', onStreamError);
    rl.close();
  }
  if (streamError) throw streamError;
};

const runGlobalCommand = async () => {
  const args = ['-x'];
  if (argv.args) {
    const extra = String(argv.args)
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    args.push(...extra);
  }
  await runLineStreamingCommand({
    command: globalCmd,
    args,
    cwd: repoRoot,
    timeoutMs: commandTimeoutMs,
    onStdoutLine: async (line) => {
      const parsed = parseGlobalLine(line);
      if (!parsed) {
        if (line.trim()) stats.errors += 1;
        return;
      }
      stats.entries += 1;
      const payload = {
        file: parsed.file,
        ext: path.extname(parsed.file).toLowerCase(),
        name: parsed.name,
        startLine: parsed.line,
        endLine: parsed.line,
        role: 'definition',
        source: 'gtags'
      };
      writeStream.write(`${JSON.stringify(payload)}\n`);
    },
    onStderrChunk: (chunk) => process.stderr.write(chunk)
  });
};

await ensureOutputDir();
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
await new Promise((resolve) => writeStream.once('finish', resolve));

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || (runGlobal ? 'global' : 'stdin'),
  output: path.resolve(outputPath),
  stats
};
await fsPromises.writeFile(metaPath, JSON.stringify(summary, null, 2));

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error(`GTAGS ingest: ${stats.entries} entries (${stats.errors} parse errors)`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}

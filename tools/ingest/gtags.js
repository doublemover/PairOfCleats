#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createCli } from '../../src/shared/cli.js';
import { isAbsolutePathNative, toPosix } from '../../src/shared/files.js';
import { registerChildProcessForCleanup } from '../../src/shared/subprocess.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'gtags-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    global: { type: 'string', default: 'global' },
    args: { type: 'string' }
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

const normalizePath = (value) => {
  if (!value) return null;
  const raw = String(value);
  const resolved = isAbsolutePathNative(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, resolved);
  return toPosix(rel || raw);
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
  const child = spawn(globalCmd, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const unregisterChild = registerChildProcessForCleanup(child, {
    killTree: true,
    detached: false
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  try {
    await ingestTextLines(child.stdout);
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 0));
    });
    if (exitCode !== 0) {
      throw new Error(`global exited with code ${exitCode}`);
    }
  } finally {
    unregisterChild();
  }
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

#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';
import { isAbsolutePathNative, toPosix } from '../src/shared/files.js';
import { getRepoCacheRoot, loadUserConfig, resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'ctags-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    interactive: { type: 'boolean', default: false },
    ctags: { type: 'string', default: 'ctags' },
    fields: { type: 'string' },
    args: { type: 'string' }
  }
}).parse();

const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outputPath = argv.out
  ? path.resolve(argv.out)
  : path.join(cacheRoot, 'ctags', 'ctags.jsonl');
const metaPath = `${outputPath}.meta.json`;
const inputPath = argv.input ? String(argv.input) : null;
const runCtags = argv.run === true;
const interactive = argv.interactive === true;
const ctagsCmd = argv.ctags || 'ctags';

const normalizePath = (value) => {
  if (!value) return null;
  const raw = String(value);
  const resolved = isAbsolutePathNative(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, resolved);
  return toPosix(rel || raw);
};

const mapEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (entry._type && entry._type !== 'tag') return null;
  const name = entry.name || null;
  const file = normalizePath(entry.path || entry.file || entry.input || '');
  if (!name || !file) return null;
  const ext = path.extname(file).toLowerCase();
  const kind = entry.kind || null;
  const kindName = entry.kindName || null;
  const signature = entry.signature || entry.pattern || null;
  const line = Number.isFinite(Number(entry.line)) ? Number(entry.line) : null;
  const startLine = line;
  const endLine = line;
  return {
    file,
    ext,
    name,
    kind,
    kindName,
    signature,
    startLine,
    endLine,
    scope: entry.scope || null,
    scopeKind: entry.scopeKind || null,
    access: entry.access || null,
    implementation: entry.implementation || null,
    language: entry.language || null,
    typeref: entry.typeref || null
  };
};

const stats = {
  entries: 0,
  ignored: 0,
  errors: 0,
  kinds: {},
  languages: {}
};

const bump = (bucket, key) => {
  if (!key) return;
  const k = String(key);
  bucket[k] = (bucket[k] || 0) + 1;
};

const ensureOutputDir = async () => {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
};

let writeStream = null;
const writeLine = async (line) => {
  if (!writeStream.write(line)) {
    await new Promise((resolve) => writeStream.once('drain', resolve));
  }
};

const ingestStream = async (stream) => {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      stats.errors += 1;
      continue;
    }
    const mapped = mapEntry(parsed);
    if (!mapped) {
      stats.ignored += 1;
      continue;
    }
    stats.entries += 1;
    bump(stats.kinds, mapped.kind || mapped.kindName || 'unknown');
    bump(stats.languages, mapped.language || 'unknown');
    await writeLine(`${JSON.stringify(mapped)}\n`);
  }
};

const runCtagsCommand = async () => {
  const args = ['--output-format=json', '--tag-relative=yes', '--recurse=yes'];
  if (argv.fields) args.push(`--fields=${argv.fields}`);
  if (argv.args) {
    const extra = String(argv.args)
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    args.push(...extra);
  }
  args.push(repoRoot);
  const child = spawn(ctagsCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await ingestStream(child.stdout);
  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });
  if (exitCode !== 0) {
    throw new Error(`ctags exited with code ${exitCode}`);
  }
};

await ensureOutputDir();
writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
if (interactive) {
  await ingestStream(process.stdin);
} else if (inputPath && inputPath !== '-') {
  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
  await ingestStream(inputStream);
} else if (inputPath === '-' || runCtags) {
  if (runCtags) {
    await runCtagsCommand();
  } else {
    await ingestStream(process.stdin);
  }
} else {
  await runCtagsCommand();
}

writeStream.end();

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || (runCtags ? 'ctags' : 'stdin'),
  output: path.resolve(outputPath),
  stats
};
await fsPromises.writeFile(metaPath, JSON.stringify(summary, null, 2));

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error(`Ctags ingest: ${stats.entries} entries (${stats.errors} parse errors)`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}

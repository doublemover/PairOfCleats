#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createCli } from '../../src/shared/cli.js';
import { isAbsolutePathNative, toPosix } from '../../src/shared/files.js';
import { getRepoCacheRoot, loadUserConfig, resolveRepoRoot } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'scip-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    scip: { type: 'string', default: 'scip' },
    args: { type: 'string' }
  }
}).parse();

const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outputPath = argv.out
  ? path.resolve(argv.out)
  : path.join(cacheRoot, 'scip', 'scip.jsonl');
const metaPath = `${outputPath}.meta.json`;
const inputPath = argv.input ? String(argv.input) : null;
const runScip = argv.run === true;
const scipCmd = argv.scip || 'scip';

const normalizePath = (value) => {
  if (!value) return null;
  const raw = String(value);
  const resolved = isAbsolutePathNative(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, resolved);
  return toPosix(rel || raw);
};

const stats = {
  documents: 0,
  occurrences: 0,
  definitions: 0,
  references: 0,
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

const roleInfo = (roles) => {
  const value = Number(roles) || 0;
  const isDefinition = (value & 1) === 1;
  const isReference = (value & 2) === 2;
  return { isDefinition, isReference };
};

const normalizeRange = (range) => {
  if (!Array.isArray(range) || !range.length) return null;
  const startLine = Number.isFinite(Number(range[0])) ? Number(range[0]) : 0;
  const startChar = Number.isFinite(Number(range[1])) ? Number(range[1]) : 0;
  let endLine = startLine;
  let endChar = startChar;
  if (range.length === 3) {
    endChar = Number.isFinite(Number(range[2])) ? Number(range[2]) : endChar;
  } else if (range.length >= 4) {
    endLine = Number.isFinite(Number(range[2])) ? Number(range[2]) : endLine;
    endChar = Number.isFinite(Number(range[3])) ? Number(range[3]) : endChar;
  }
  return {
    startLine: startLine + 1,
    startChar,
    endLine: endLine + 1,
    endChar
  };
};

const extractSymbolInfo = (doc) => {
  const entries = doc?.symbols || doc?.symbolInformation || doc?.symbolInformations || [];
  if (!Array.isArray(entries) || !entries.length) return new Map();
  const map = new Map();
  for (const entry of entries) {
    if (!entry || !entry.symbol) continue;
    map.set(entry.symbol, entry);
  }
  return map;
};

const writeOccurrence = (doc, occurrence, symbolInfo) => {
  if (!occurrence || !occurrence.symbol) return;
  const file = normalizePath(doc.relativePath || doc.path || doc.file || '');
  if (!file) return;
  const range = normalizeRange(occurrence.range || occurrence.enclosingRange);
  const info = symbolInfo.get(occurrence.symbol) || {};
  const role = roleInfo(occurrence.symbolRoles);
  const entry = {
    file,
    ext: path.extname(file).toLowerCase(),
    name: info.displayName || info.symbol || occurrence.symbol,
    symbol: occurrence.symbol,
    kind: info.kind || info.symbolKind || null,
    signature: info.signature || info.signatureDocumentation || null,
    startLine: range ? range.startLine : null,
    endLine: range ? range.endLine : null,
    startChar: range ? range.startChar : null,
    endChar: range ? range.endChar : null,
    role: role.isDefinition ? 'definition' : (role.isReference ? 'reference' : 'other'),
    language: info.language || doc.language || null,
    scope: info.scope || null,
    scopeKind: info.scopeKind || null
  };
  stats.occurrences += 1;
  if (role.isDefinition) stats.definitions += 1;
  if (role.isReference) stats.references += 1;
  bump(stats.kinds, entry.kind || 'unknown');
  bump(stats.languages, entry.language || 'unknown');
  writeStream.write(`${JSON.stringify(entry)}\n`);
};

const handleDocument = (doc) => {
  if (!doc || typeof doc !== 'object') return;
  const file = doc.relativePath || doc.path || doc.file || null;
  if (!file) return;
  stats.documents += 1;
  const symbolInfo = extractSymbolInfo(doc);
  const occurrences = Array.isArray(doc.occurrences) ? doc.occurrences : [];
  for (const occ of occurrences) {
    writeOccurrence(doc, occ, symbolInfo);
  }
};

const handlePayload = (payload) => {
  if (!payload) return;
  if (Array.isArray(payload)) {
    payload.forEach(handlePayload);
    return;
  }
  if (Array.isArray(payload.documents)) {
    payload.documents.forEach(handleDocument);
    return;
  }
  if (payload.relativePath || payload.path || payload.file) {
    handleDocument(payload);
  }
};

const ingestJsonLines = async (stream) => {
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
    handlePayload(parsed);
  }
};

const ingestJsonFile = async (filePath) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    handlePayload(parsed);
    return true;
  } catch {
    return false;
  }
};

const runScipCommand = async () => {
  const args = ['print', '--format=json'];
  if (inputPath) args.push('--input', inputPath);
  if (argv.args) {
    const extra = String(argv.args)
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    args.push(...extra);
  }
  const child = spawn(scipCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await ingestJsonLines(child.stdout);
  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });
  if (exitCode !== 0) {
    throw new Error(`scip exited with code ${exitCode}`);
  }
};

await ensureOutputDir();
writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
if (runScip) {
  await runScipCommand();
} else if (inputPath && inputPath !== '-') {
  const parsed = await ingestJsonFile(inputPath);
  if (!parsed) {
    const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    await ingestJsonLines(inputStream);
  }
} else {
  await ingestJsonLines(process.stdin);
}

writeStream.end();

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || (runScip ? 'scip' : 'stdin'),
  output: path.resolve(outputPath),
  stats
};
await fsPromises.writeFile(metaPath, JSON.stringify(summary, null, 2));

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error(`SCIP ingest: ${stats.occurrences} occurrences (${stats.errors} parse errors)`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}

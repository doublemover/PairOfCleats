#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createCli } from '../../src/shared/cli.js';
import { isAbsolutePathNative, toPosix } from '../../src/shared/files.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'lsif-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false }
  }
}).parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const inputPath = argv.input ? String(argv.input) : null;
const outputPath = argv.out
  ? path.resolve(argv.out)
  : path.join(cacheRoot, 'lsif', 'lsif.jsonl');
const metaPath = `${outputPath}.meta.json`;

const normalizePath = (value) => {
  if (!value) return null;
  let raw = String(value);
  const posixRaw = toPosix(raw);
  if (posixRaw === '/repo') return '';
  if (posixRaw.startsWith('/repo/')) {
    return posixRaw.slice('/repo/'.length);
  }
  if (posixRaw.startsWith('/') && /^[A-Za-z]:\//.test(posixRaw.slice(1))) {
    raw = posixRaw.slice(1);
  }
  const resolved = isAbsolutePathNative(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, resolved);
  return toPosix(rel || raw);
};

const stats = {
  vertices: 0,
  edges: 0,
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

const vertexById = new Map();
const docById = new Map();
const rangeById = new Map();
const rangeToDoc = new Map();

const normalizeRange = (range) => {
  if (!range || typeof range !== 'object') return null;
  const start = range.start || {};
  const end = range.end || {};
  const startLine = Number.isFinite(Number(start.line)) ? Number(start.line) + 1 : null;
  const endLine = Number.isFinite(Number(end.line)) ? Number(end.line) + 1 : startLine;
  return {
    startLine,
    endLine,
    startChar: Number.isFinite(Number(start.character)) ? Number(start.character) : null,
    endChar: Number.isFinite(Number(end.character)) ? Number(end.character) : null
  };
};

const recordEntry = (payload) => {
  writeStream.write(`${JSON.stringify(payload)}\n`);
};

const handleVertex = (vertex) => {
  vertexById.set(vertex.id, vertex);
  const label = vertex.label || vertex.type || null;
  bump(stats.kinds, label || 'unknown');
  if (label === 'document' && vertex.uri) {
    docById.set(vertex.id, vertex);
  }
  if (label === 'range') {
    rangeById.set(vertex.id, vertex);
  }
  stats.vertices += 1;
};

const handleEdge = (edge) => {
  stats.edges += 1;
  const label = edge.label || edge.type || null;
  if (label === 'contains' && edge.outV != null && Array.isArray(edge.inVs)) {
    const outVertex = vertexById.get(edge.outV);
    if (outVertex && (outVertex.label === 'document' || outVertex.type === 'document')) {
      for (const id of edge.inVs) {
        rangeToDoc.set(id, outVertex);
      }
    }
  }
  if (label === 'item' && edge.outV != null && Array.isArray(edge.inVs)) {
    const doc = rangeToDoc.get(edge.outV) || null;
    const docUri = doc?.uri || null;
    const file = docUri ? normalizePath(new URL(docUri).pathname) : null;
    if (!file) return;
    const range = rangeById.get(edge.outV);
    const normalized = normalizeRange(range);
    for (const inV of edge.inVs) {
      const inVertex = vertexById.get(inV);
      const inLabel = inVertex?.label || inVertex?.type || null;
      const role = inLabel === 'definitionResult' ? 'definition'
        : inLabel === 'referenceResult' ? 'reference'
          : 'other';
      if (role === 'definition') stats.definitions += 1;
      if (role === 'reference') stats.references += 1;
      bump(stats.languages, doc?.languageId || 'unknown');
      recordEntry({
        file,
        ext: path.extname(file).toLowerCase(),
        name: range?.tag || range?.text || null,
        kind: range?.kind || null,
        startLine: normalized?.startLine ?? null,
        endLine: normalized?.endLine ?? null,
        startChar: normalized?.startChar ?? null,
        endChar: normalized?.endChar ?? null,
        role,
        language: doc?.languageId || null
      });
    }
  }
};

const ingestJsonLines = async (stream) => {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let streamError = null;
  const onStreamError = (error) => {
    streamError = error || new Error('Input stream failed.');
    rl.close();
  };
  stream.once('error', onStreamError);
  try {
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
      if (parsed && parsed.type === 'vertex') handleVertex(parsed);
      else if (parsed && parsed.type === 'edge') handleEdge(parsed);
    }
  } finally {
    stream.off('error', onStreamError);
    rl.close();
  }
  if (streamError) throw streamError;
};

await ensureOutputDir();
writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
if (inputPath && inputPath !== '-') {
  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
  await ingestJsonLines(inputStream);
} else {
  await ingestJsonLines(process.stdin);
}

writeStream.end();

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || 'stdin',
  output: path.resolve(outputPath),
  stats
};
await fsPromises.writeFile(metaPath, JSON.stringify(summary, null, 2));

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error(`LSIF ingest: ${stats.vertices} vertices, ${stats.edges} edges`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}

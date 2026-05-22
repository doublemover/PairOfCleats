#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import {
  bumpStat,
  emitIngestSummaryJson,
  ensureParentDir,
  finishWriteStream,
  ingestJsonLineStream,
  normalizeRepoRelativePath,
  writeIngestSummaryReport,
  writeJsonLine
} from './shared.js';

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
  return normalizeRepoRelativePath(repoRoot, value, { stripVirtualRepoRoot: true });
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

const uriPathFromDocumentUri = (uri) => {
  if (!uri || typeof uri !== 'string') return null;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') return null;
    return parsed.pathname || null;
  } catch {
    return null;
  }
};

const recordEntry = async (payload) => {
  await writeJsonLine(writeStream, payload);
};

const handleVertex = (vertex) => {
  vertexById.set(vertex.id, vertex);
  const label = vertex.label || vertex.type || null;
  bumpStat(stats.kinds, label || 'unknown');
  if (label === 'document' && vertex.uri) {
    docById.set(vertex.id, vertex);
  }
  if (label === 'range') {
    rangeById.set(vertex.id, vertex);
  }
  stats.vertices += 1;
};

const handleEdge = async (edge) => {
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
    const file = normalizePath(uriPathFromDocumentUri(doc?.uri || null));
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
      bumpStat(stats.languages, doc?.languageId || 'unknown');
      await recordEntry({
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
  await ingestJsonLineStream(stream, {
    onParseError: () => {
      stats.errors += 1;
    },
    onPayload: async (parsed) => {
      if (parsed && parsed.type === 'vertex') handleVertex(parsed);
      else if (parsed && parsed.type === 'edge') await handleEdge(parsed);
    }
  });
};

await ensureParentDir(outputPath);
writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
if (inputPath && inputPath !== '-') {
  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
  await ingestJsonLines(inputStream);
} else {
  await ingestJsonLines(process.stdin);
}

writeStream.end();
await finishWriteStream(writeStream);

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || 'stdin',
  output: path.resolve(outputPath),
  stats
};
await writeIngestSummaryReport(metaPath, summary);

if (argv.json) {
  emitIngestSummaryJson(summary);
} else {
  console.error(`LSIF ingest: ${stats.vertices} vertices, ${stats.edges} edges`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}

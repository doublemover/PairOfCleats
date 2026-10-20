#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import {
  bumpStat,
  emitIngestSummaryJson,
  withStagedIngestOutput,
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
}).strictOptions().parse();

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
const conflictingRanges = new Set();
// Flat occurrences need one role/document witness per range, not a copy of all edges.
const occurrences = new Map();

const normalizeRange = (range) => {
  if (!range || typeof range !== 'object') return null;
  const start = range.start || {};
  const end = range.end || {};
  if (![start.line, start.character, end.line, end.character].every(value => Number.isSafeInteger(value) && value >= 0)
    || start.line >= Number.MAX_SAFE_INTEGER || end.line >= Number.MAX_SAFE_INTEGER
    || end.line < start.line || (end.line === start.line && end.character < start.character)) return null;
  return {
    startLine: start.line + 1,
    endLine: end.line + 1,
    startChar: start.character,
    endChar: end.character
  };
};

const uriPathFromDocumentUri = (uri) => {
  if (!uri || typeof uri !== 'string') return null;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') return null;
    // /repo is the documented virtual root; real URIs keep native drive/UNC handling.
    const virtual = !parsed.hostname && /^\/repo(?:\/|$)/.test(parsed.pathname);
    return fileURLToPath(parsed, virtual ? { windows: false } : undefined);
  } catch {
    return null;
  }
};

const recordEntry = async (payload) => {
  await writeJsonLine(writeStream, payload);
};

const handleVertex = (vertex) => {
  if (vertexById.has(vertex.id)) { stats.errors += 1; return; }
  vertexById.set(vertex.id, vertex);
  const label = vertex.label || vertex.type || null;
  bumpStat(stats.kinds, label || 'unknown');
  if (label === 'document' && vertex.uri) {
    docById.set(vertex.id, vertex);
  }
  if (label === 'range' || label === 'resultRange') {
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
        if (rangeById.get(id)?.label === 'resultRange') { conflictingRanges.add(id); stats.errors += 1; continue; }
        if (rangeToDoc.has(id) && rangeToDoc.get(id) !== outVertex) {
          conflictingRanges.add(id);
          stats.errors += 1;
        }
        rangeToDoc.set(id, outVertex);
      }
    }
  }
  if (label === 'item' && edge.outV != null && Array.isArray(edge.inVs)) {
    const result = vertexById.get(edge.outV);
    const resultLabel = result?.label;
    if (!['definitionResult', 'referenceResult', 'declarationResult', 'typeDefinitionResult', 'implementationResult'].includes(resultLabel)) {
      stats.errors += 1;
      return;
    }
    if (resultLabel === 'referenceResult' && ['referenceResults', 'referenceLinks'].includes(edge.property)) {
      const expected = edge.property === 'referenceResults' ? 'referenceResult' : 'moniker';
      for (const id of edge.inVs) if (vertexById.get(id)?.label !== expected) stats.errors += 1;
      // Links add membership to results, not new locations. This flat export
      // already includes each linked result's concrete ranges exactly once.
      return;
    }
    const role = resultLabel === 'definitionResult' ? 'definition'
      : resultLabel === 'referenceResult'
        ? ({ definitions: 'definition', references: 'reference', declarations: 'other' })[edge.property ?? 'references']
        : 'other';
    if (!role) { stats.errors += 1; return; }
    for (const inV of edge.inVs) {
      if (!rangeById.has(inV)) { stats.errors += 1; continue; }
      if (!occurrences.has(inV)) occurrences.set(inV, new Map());
      const roles = occurrences.get(inV);
      if (!roles.has(role)) roles.set(role, new Set());
      const document = docById.get(edge.document ?? edge.shard);
      if (document) roles.get(role).add(document);
    }
  }
};

const emitOccurrences = async () => {
  const emitted = new Set();
  for (const [id, roles] of occurrences) {
    if (conflictingRanges.has(id)) continue;
    const range = rangeById.get(id);
    const normalized = normalizeRange(range);
    if (!normalized) { stats.errors += 1; continue; }
    for (const [role, hints] of roles) {
      const contained = rangeToDoc.get(id);
      if (hints.size > 1 || (contained && hints.size && !hints.has(contained))) { stats.errors += 1; continue; }
      const doc = contained || hints.values().next().value;
      const file = normalizePath(uriPathFromDocumentUri(doc?.uri));
      if (!file) { stats.errors += 1; continue; }
      const identity = JSON.stringify([file, normalized, role]);
      if (emitted.has(identity)) continue;
      emitted.add(identity);
      if (role === 'definition') stats.definitions += 1;
      if (role === 'reference') stats.references += 1;
      bumpStat(stats.languages, doc?.languageId || 'unknown');
      await recordEntry({
        file,
        ext: path.extname(file).toLowerCase(),
        name: (typeof range.tag === 'string' ? range.tag : range.tag?.text) || range.text || null,
        kind: range.tag?.kind ?? range.kind ?? null,
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
      else if (parsed && parsed.type === 'edge') handleEdge(parsed);
    }
  });
};

await withStagedIngestOutput(outputPath, async (stream) => {
  writeStream = stream;
  if (inputPath && inputPath !== '-') {
    const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    await ingestJsonLines(inputStream);
  } else {
    await ingestJsonLines(process.stdin);
  }
  await emitOccurrences();
});

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

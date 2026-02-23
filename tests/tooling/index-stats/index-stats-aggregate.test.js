#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-stats-aggregate');
const indexRoot = path.join(tempRoot, 'build-root');
const toolPath = path.join(root, 'tools', 'index', 'stats.js');

const writeModeManifest = async (mode, values) => {
  const modeDir = path.join(indexRoot, `index-${mode}`);
  await fs.mkdir(path.join(modeDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(modeDir, 'index_state.json'), JSON.stringify({
    compatibilityKey: `compat-${mode}`
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(modeDir, 'pieces', 'manifest.json'), JSON.stringify({
    version: 2,
    buildId: 'build-aggregate',
    compatibilityKey: `compat-${mode}`,
    artifactSurfaceVersion: 'surf-1',
    pieces: [
      { name: 'chunk_meta', path: 'chunk_meta.json', bytes: values.chunkMeta, count: values.chunkRows },
      { name: 'token_postings', path: 'token_postings.json', bytes: values.tokenPostings, count: values.tokenRows },
      { name: 'phrase_ngrams', path: 'phrase_ngrams.json', bytes: values.phraseNgrams, count: values.phraseRows },
      { name: 'chargram_postings', path: 'chargram_postings.json', bytes: values.chargramPostings, count: values.chargramRows },
      { name: 'symbols', path: 'symbols.json', bytes: values.symbols, count: values.symbolRows },
      { name: 'symbol_occurrences', path: 'symbol_occurrences.json', bytes: values.symbolOccurrences, count: values.symbolOccurrenceRows },
      { name: 'symbol_edges', path: 'symbol_edges.json', bytes: values.symbolEdges, count: values.symbolEdgeRows },
      { name: 'graph_relations', path: 'graph_relations.json', bytes: values.graphRelations, count: values.graphRows },
      { name: 'call_sites', path: 'call_sites.json', bytes: values.callSites, count: values.callRows },
      { name: 'file_meta', path: 'file_meta.json', bytes: values.fileMeta, count: values.fileRows },
      { name: 'dense_vectors', path: 'dense_vectors.json', bytes: values.denseVectors, count: values.denseCount },
      { name: 'dense_vectors_hnsw', path: 'dense_vectors_hnsw.bin', bytes: values.hnsw },
      { name: 'dense_vectors_lancedb', path: 'dense_vectors_lancedb.db', bytes: values.lancedb }
    ]
  }, null, 2), 'utf8');
};

await fs.rm(tempRoot, { recursive: true, force: true });

await writeModeManifest('code', {
  chunkMeta: 10,
  chunkRows: 2,
  tokenPostings: 20,
  tokenRows: 5,
  phraseNgrams: 30,
  phraseRows: 7,
  chargramPostings: 40,
  chargramRows: 8,
  symbols: 50,
  symbolRows: 3,
  symbolOccurrences: 60,
  symbolOccurrenceRows: 4,
  symbolEdges: 70,
  symbolEdgeRows: 5,
  graphRelations: 80,
  graphRows: 6,
  callSites: 90,
  callRows: 7,
  fileMeta: 11,
  fileRows: 4,
  denseVectors: 100,
  denseCount: 9,
  hnsw: 110,
  lancedb: 120
});

await writeModeManifest('prose', {
  chunkMeta: 4,
  chunkRows: 1,
  tokenPostings: 6,
  tokenRows: 2,
  phraseNgrams: 8,
  phraseRows: 3,
  chargramPostings: 10,
  chargramRows: 4,
  symbols: 12,
  symbolRows: 1,
  symbolOccurrences: 14,
  symbolOccurrenceRows: 1,
  symbolEdges: 16,
  symbolEdgeRows: 1,
  graphRelations: 18,
  graphRows: 1,
  callSites: 20,
  callRows: 1,
  fileMeta: 5,
  fileRows: 2,
  denseVectors: 22,
  denseCount: 3,
  hnsw: 24,
  lancedb: 26
});

const run = spawnSync(
  process.execPath,
  [toolPath, '--index-dir', indexRoot, '--json'],
  {
    encoding: 'utf8',
    env: { ...process.env }
  }
);

assert.equal(run.status, 0, run.stderr || run.stdout);
const payload = JSON.parse(run.stdout);
assert.deepEqual(Object.keys(payload.modes), ['code', 'prose']);
assert.equal(payload.totals.chunkCount, 3);
assert.equal(payload.totals.fileCount, 6);
assert.equal(payload.totals.bytesByFamily.chunks, 14);
assert.equal(payload.totals.bytesByFamily.postings, 114);
assert.equal(payload.totals.bytesByFamily.symbols, 222);
assert.equal(payload.totals.bytesByFamily.relations, 208);
assert.equal(payload.totals.bytesByFamily.embeddings, 402);
assert.equal(payload.totals.totalBytes, 960);

console.log('index stats aggregate test passed');

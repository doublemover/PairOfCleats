#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-extracted-sqlite-fallback-'));
const compatibilityKey = 'compat-extracted-sqlite-fallback';

const writeModeIndex = async (mode, chunkMeta) => {
  const indexDir = path.join(rootDir, `index-${mode}`);
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  const indexState = {
    generatedAt: new Date().toISOString(),
    mode,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey
  };
  const tokenPostings = {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    avgDocLen: 1,
    totalDocs: 1
  };
  const manifest = {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    pieces: [
      { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
      { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
      { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' }
    ]
  };
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenPostings, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexState, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
};

await writeModeIndex('code', [{ id: 11, file: 'src/code.js', start: 0, end: 4 }]);
await writeModeIndex('extracted-prose', [{ id: 22, file: 'docs/notes.md', start: 0, end: 4 }]);

const sqliteCalls = [];
const loadIndexFromSqlite = (mode, options) => {
  sqliteCalls.push({
    mode,
    options: {
      includeDense: options?.includeDense,
      includeMinhash: options?.includeMinhash,
      includeChunks: options?.includeChunks,
      includeFilterIndex: options?.includeFilterIndex
    }
  });
  if (mode === 'code') {
    return {
      chunkMeta: [{ id: 701, file: 'src/sqlite-only.js', start: 0, end: 1 }]
    };
  }
  if (mode === 'extracted-prose') {
    throw new Error('sqlite extracted-prose index unavailable');
  }
  throw new Error(`unexpected sqlite mode ${mode}`);
};

const loaded = await loadSearchIndexes({
  rootDir,
  userConfig: {},
  searchMode: 'code',
  runProse: false,
  runExtractedProse: false,
  loadExtractedProse: true,
  runCode: true,
  runRecords: false,
  useSqlite: true,
  useLmdb: false,
  emitOutput: false,
  exitOnError: false,
  annActive: false,
  filtersActive: false,
  contextExpansionEnabled: false,
  graphRankingEnabled: false,
  sqliteFtsRequested: true,
  backendLabel: 'memory',
  backendForcedTantivy: false,
  indexCache: null,
  modelIdDefault: null,
  fileChargramN: null,
  hnswConfig: { enabled: false },
  lancedbConfig: { enabled: false },
  tantivyConfig: { enabled: false },
  strict: true,
  requiredArtifacts: new Set(),
  loadIndexFromSqlite,
  loadIndexFromLmdb: () => {
    throw new Error('unexpected lmdb load');
  },
  resolvedDenseVectorMode: 'auto'
});

const sqliteModes = new Set(sqliteCalls.map((entry) => entry.mode));
assert.equal(sqliteModes.has('code'), true, 'expected sqlite loader call for code mode');
assert.equal(sqliteModes.has('extracted-prose'), true, 'expected sqlite loader call for extracted-prose mode');

for (const mode of ['code', 'extracted-prose']) {
  const call = sqliteCalls.find((entry) => entry.mode === mode);
  assert.equal(call?.options?.includeDense, false, `expected includeDense=false for mode ${mode}`);
  assert.equal(call?.options?.includeMinhash, false, `expected includeMinhash=false for mode ${mode}`);
  assert.equal(call?.options?.includeChunks, false, `expected sqlite lazy chunk include=false for mode ${mode}`);
  assert.equal(call?.options?.includeFilterIndex, false, `expected includeFilterIndex=false for mode ${mode}`);
}

assert.equal(loaded.runExtractedProse, false, 'expected optional extracted-prose run flag to remain disabled');
assert.equal(loaded.extractedProseLoaded, true, 'expected extracted-prose mode to stay loaded via fallback');
assert.equal(
  loaded.idxCode?.chunkMeta?.[0]?.id,
  701,
  'expected code mode to use sqlite loader payload'
);
assert.equal(
  loaded.idxExtractedProse?.chunkMeta?.[0]?.id,
  22,
  'expected extracted-prose mode to fall back to artifact loader payload'
);

console.log('optional extracted-prose sqlite fallback test passed');

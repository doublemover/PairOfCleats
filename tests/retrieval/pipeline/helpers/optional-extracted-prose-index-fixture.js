import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { loadSearchIndexes } from '../../../../src/retrieval/cli/load-indexes.js';

export const createOptionalExtractedProseRoot = (prefix) => (
  fs.mkdtemp(path.join(os.tmpdir(), prefix))
);

export const writeModeIndex = async (rootDir, mode, compatibilityKey, { chunkMeta = [] } = {}) => {
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
  return indexDir;
};

export const writeLegacyChunkMetaIndex = async (rootDir, mode, chunkMeta = []) => {
  const indexDir = path.join(rootDir, `index-${mode}`);
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2), 'utf8');
  return indexDir;
};

export const writeOptionalExtractedProseIndexPair = async (
  rootDir,
  {
    codeCompatibilityKey,
    extractedProseCompatibilityKey = codeCompatibilityKey,
    codeChunkMeta = [],
    extractedProseChunkMeta = []
  }
) => {
  await writeModeIndex(rootDir, 'code', codeCompatibilityKey, { chunkMeta: codeChunkMeta });
  await writeModeIndex(rootDir, 'extracted-prose', extractedProseCompatibilityKey, {
    chunkMeta: extractedProseChunkMeta
  });
};

export const loadOptionalExtractedProseIndexes = (rootDir, overrides = {}) => loadSearchIndexes({
  rootDir,
  userConfig: {},
  searchMode: 'code',
  runProse: false,
  runExtractedProse: false,
  loadExtractedProse: true,
  runCode: true,
  runRecords: false,
  useSqlite: false,
  useLmdb: false,
  emitOutput: false,
  exitOnError: false,
  annActive: false,
  filtersActive: false,
  contextExpansionEnabled: false,
  graphRankingEnabled: false,
  sqliteFtsRequested: false,
  backendLabel: 'memory',
  backendForcedTantivy: false,
  indexCache: null,
  modelIdDefault: null,
  fileChargramN: null,
  hnswConfig: { enabled: false },
  lancedbConfig: { enabled: true },
  tantivyConfig: { enabled: false },
  strict: true,
  loadIndexFromSqlite: () => ({}),
  loadIndexFromLmdb: () => ({}),
  resolvedDenseVectorMode: 'merged',
  ...overrides
});

export const loadOptionalExtractedProseIndexesWithWarnings = async (rootDir, overrides = {}) => {
  const warnings = [];
  const originalWarn = console.warn;
  let loaded;
  try {
    console.warn = (message) => warnings.push(String(message || ''));
    loaded = await loadOptionalExtractedProseIndexes(rootDir, overrides);
  } finally {
    console.warn = originalWarn;
  }
  return { loaded, warnings };
};

export const assertOptionalExtractedProseDisabled = (loaded, message) => {
  assert.equal(loaded.runExtractedProse, false, `${message}: expected run flag to remain disabled`);
  assert.equal(loaded.extractedProseLoaded, false, message);
  assert.deepEqual(
    loaded.idxExtractedProse?.chunkMeta || [],
    [],
    `${message}: expected optional extracted-prose index to remain empty`
  );
};

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';

const DEFAULT_TOKEN_POSTINGS = Object.freeze({
  vocab: ['alpha'],
  postings: [[[0, 1]]],
  docLengths: [1],
  avgDocLen: 1,
  totalDocs: 1
});

const DEFAULT_FILE_LISTS = Object.freeze({
  scanned: { count: 1, sample: [] },
  skipped: { count: 0, sample: [] }
});

const INDEX_PIECES = Object.freeze([
  { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
  { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
  { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' }
]);

const LOAD_INDEX_PIECES = Object.freeze([
  ...INDEX_PIECES,
  { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
]);

const MIXED_PROFILE_INDEXES = Object.freeze([
  {
    mode: 'code',
    compatibilityKey: 'compat-default-profile',
    profileId: 'default'
  },
  {
    mode: 'prose',
    compatibilityKey: 'compat-vector-only-profile',
    profileId: 'vector_only'
  }
]);

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
};

export const createCompatibilityIndex = async (
  rootDir,
  {
    directory = null,
    mode = 'code',
    compatibilityKey,
    profileId = null,
    includeFileLists = true,
    fileName = `src/${mode}.js`
  }
) => {
  const indexDir = path.join(rootDir, directory || `index-${mode}`);
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

  const generatedAt = new Date().toISOString();
  const chunkMeta = [{ id: 0, file: fileName, start: 0, end: 1 }];
  const indexState = {
    generatedAt,
    mode,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey
  };
  if (profileId) {
    indexState.profile = {
      id: profileId,
      schemaVersion: 1
    };
  }

  const pieces = includeFileLists ? LOAD_INDEX_PIECES : INDEX_PIECES;
  const manifest = {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    pieces
  };

  await writeJson(path.join(indexDir, 'chunk_meta.json'), chunkMeta);
  await writeJson(path.join(indexDir, 'token_postings.json'), DEFAULT_TOKEN_POSTINGS);
  await writeJson(path.join(indexDir, 'index_state.json'), indexState);
  if (includeFileLists) {
    await writeJson(path.join(indexDir, '.filelists.json'), {
      generatedAt,
      ...DEFAULT_FILE_LISTS
    });
  }
  await writeJson(path.join(indexDir, 'pieces', 'manifest.json'), manifest);

  return indexDir;
};

export const createCompatibilityIndexFixture = async (tmpPrefix, indexConfigs) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
  const indexDirs = [];

  for (const indexConfig of indexConfigs) {
    indexDirs.push(await createCompatibilityIndex(rootDir, indexConfig));
  }

  return { rootDir, indexDirs };
};

export const createMixedProfileFixture = (tmpPrefix) =>
  createCompatibilityIndexFixture(tmpPrefix, MIXED_PROFILE_INDEXES);

export const createLoadSearchIndexesMemoryOptions = (rootDir, overrides = {}) => ({
  rootDir,
  userConfig: {},
  searchMode: 'default',
  runProse: true,
  runExtractedProse: false,
  loadExtractedProse: false,
  runCode: true,
  runRecords: false,
  useSqlite: false,
  useLmdb: false,
  emitOutput: false,
  exitOnError: false,
  annActive: false,
  filtersActive: false,
  contextExpansionEnabled: false,
  sqliteFtsRequested: false,
  backendLabel: 'memory',
  backendForcedTantivy: false,
  indexCache: null,
  modelIdDefault: null,
  fileChargramN: null,
  hnswConfig: { enabled: false },
  lancedbConfig: { enabled: false },
  tantivyConfig: { enabled: false },
  loadIndexFromSqlite: () => ({}),
  loadIndexFromLmdb: () => ({}),
  resolvedDenseVectorMode: 'auto',
  ...overrides
});

export const createMixedProfileLoadOptions = createLoadSearchIndexesMemoryOptions;

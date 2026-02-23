#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCli } from '../../src/shared/cli.js';
import { createToolDisplay } from '../shared/cli-display.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifactSync,
  loadTokenPostings,
  readJsonFile,
  MAX_JSON_BYTES
} from '../../src/shared/artifact-io.js';
import { hasChunkMetaArtifactsSync } from '../../src/shared/index-artifact-helpers.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { updateIndexStateManifest } from '../shared/index-state-utils.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../src/storage/lmdb/schema.js';
import { getIndexDir, getMetricsDir, resolveIndexRoot, resolveLmdbPaths, resolveRepoConfig } from '../shared/dict-utils.js';
import { resolveAsOfContext, resolveSingleRootForModes } from '../../src/index/as-of.js';
import { Packr } from 'msgpackr';

const require = createRequire(import.meta.url);
let open = null;
try {
  ({ open } = require('lmdb'));
} catch {}

const argv = createCli({
  scriptName: 'build-lmdb-index',
  options: {
    mode: { type: 'string', default: 'all' },
    repo: { type: 'string' },
    'index-root': { type: 'string' },
    'as-of': { type: 'string' },
    snapshot: { type: 'string' },
    validate: { type: 'boolean', default: false },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();

const display = createToolDisplay({ argv, stream: process.stderr });
const log = (message) => display.log(message);
const warn = (message) => display.warn(message);
const fail = (message, code = 1) => {
  display.error(message);
  display.close();
  process.exit(code);
};

if (!open) {
  fail('lmdb is required. Run npm install first.');
}

const validateArtifacts = argv.validate === true;
const buildModeRaw = String(argv.mode || 'all').trim().toLowerCase();
const buildMode = buildModeRaw === 'both' ? 'all' : buildModeRaw;
const supportedModes = ['code', 'prose'];
const modes = buildMode === 'all' ? supportedModes : [buildMode];

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const asOfRequested = (
  (typeof argv['as-of'] === 'string' && argv['as-of'].trim())
  || (typeof argv.snapshot === 'string' && argv.snapshot.trim())
);
const asOfContext = asOfRequested
  ? resolveAsOfContext({
    repoRoot: root,
    userConfig,
    requestedModes: modes,
    asOf: argv['as-of'],
    snapshot: argv.snapshot,
    preferFrozen: true,
    allowMissingModesForLatest: false
  })
  : null;
const asOfRootSelection = asOfContext?.provided
  ? resolveSingleRootForModes(asOfContext.indexBaseRootByMode, modes)
  : { roots: [], root: null, mixed: false };
if (asOfContext?.strict && modes.length > 1 && asOfRootSelection.mixed) {
  fail(
    `[lmdb] --as-of ${asOfContext.ref} resolves to multiple index roots for selected modes. ` +
    'Select a single mode.'
  );
}
const indexRoot = argv['index-root']
  ? path.resolve(argv['index-root'])
  : (asOfRootSelection.root ? path.resolve(asOfRootSelection.root) : resolveIndexRoot(root, userConfig));
const lmdbPaths = resolveLmdbPaths(root, userConfig, { indexRoot });
const metricsDir = getMetricsDir(root, userConfig);

const readJsonOptional = (filePath) => {
  if (!filePath || !fsSync.existsSync(filePath)) return null;
  return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
};

const sumDocLengths = (docLengths) => {
  if (!Array.isArray(docLengths)) return null;
  let total = 0;
  for (const entry of docLengths) {
    const value = Number(entry);
    if (Number.isFinite(value)) total += value;
  }
  return total;
};


const updateLmdbState = async (indexDir, patch) => {
  if (!indexDir) return null;
  const statePath = path.join(indexDir, 'index_state.json');
  let state = {};
  if (fsSync.existsSync(statePath)) {
    try {
      state = readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) || {};
    } catch {
      state = {};
    }
  }
  const now = new Date().toISOString();
  state.generatedAt = state.generatedAt || now;
  state.updatedAt = now;
  state.lmdb = {
    ...(state.lmdb || {}),
    ...patch,
    updatedAt: now
  };
  try {
    await writeJsonObjectFile(statePath, { fields: state, atomic: true });
  } catch {
    // Ignore index state write failures.
  }
  await updateIndexStateManifest(indexDir);
  return state;
};

const modeTask = display.task('LMDB', { total: modes.length, stage: 'lmdb' });
let completedModes = 0;

const packr = new Packr();
const LMDB_PAGE_SIZE = 4096;
const LMDB_MAP_SIZE_FACTOR = 2;
const LMDB_MIN_MAP_SIZE = 64 * 1024 * 1024;

const alignMapSize = (bytes) => {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  return Math.ceil(size / LMDB_PAGE_SIZE) * LMDB_PAGE_SIZE;
};

const estimateValueBytes = (value) => {
  if (value == null) return 0;
  try {
    return packr.pack(value).length;
  } catch {
    return 0;
  }
};

const estimateEntryBytes = (key, value) => (
  Buffer.byteLength(String(key || '')) + estimateValueBytes(value)
);

const estimateLmdbBytes = (meta, artifacts) => {
  let total = 0;
  const metaEntries = [
    [LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION],
    [LMDB_META_KEYS.createdAt, meta.createdAt],
    [LMDB_META_KEYS.mode, meta.mode],
    [LMDB_META_KEYS.sourceIndex, meta.sourceIndex],
    [LMDB_META_KEYS.chunkCount, meta.chunkCount],
    [LMDB_META_KEYS.artifacts, meta.artifacts],
    [LMDB_META_KEYS.artifactManifest, { keys: meta.artifacts, createdAt: meta.createdAt }]
  ];
  for (const [key, value] of metaEntries) {
    total += estimateEntryBytes(key, value);
  }
  for (const [key, value] of Object.entries(artifacts || {})) {
    total += estimateEntryBytes(key, value);
  }
  return total;
};

const resolveMapSizeBytes = (estimatedBytes) => {
  const estimated = Number.isFinite(estimatedBytes) ? estimatedBytes : 0;
  const padded = estimated * LMDB_MAP_SIZE_FACTOR;
  const base = Math.max(LMDB_MIN_MAP_SIZE, Math.ceil(padded));
  return alignMapSize(base);
};

const storeValue = (db, key, value) => {
  if (value == null) return false;
  db.putSync(key, packr.pack(value));
  return true;
};

const storeArtifacts = (db, meta, artifacts) => {
  db.clearSync();
  db.transactionSync(() => {
    storeValue(db, LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION);
    storeValue(db, LMDB_META_KEYS.createdAt, meta.createdAt);
    storeValue(db, LMDB_META_KEYS.mode, meta.mode);
    storeValue(db, LMDB_META_KEYS.sourceIndex, meta.sourceIndex);
    storeValue(db, LMDB_META_KEYS.chunkCount, meta.chunkCount);
    storeValue(db, LMDB_META_KEYS.artifacts, meta.artifacts);
    storeValue(db, LMDB_META_KEYS.artifactManifest, {
      keys: meta.artifacts,
      createdAt: meta.createdAt
    });
    storeValue(db, LMDB_META_KEYS.mapSizeBytes, meta.mapSizeBytes);
    storeValue(db, LMDB_META_KEYS.mapSizeEstimatedBytes, meta.mapSizeEstimatedBytes);
    storeValue(db, LMDB_META_KEYS.mapSizeFactor, meta.mapSizeFactor);
    storeValue(db, LMDB_META_KEYS.pageSize, meta.pageSize);
    for (const [key, value] of Object.entries(artifacts)) {
      storeValue(db, key, value);
    }
  });
};

/**
 * Coarse sparse-artifact readiness probe for LMDB materialization.
 *
 * @param {string|null|undefined} indexDir
 * @returns {boolean}
 */
const hasChunkMeta = (indexDir) => {
  if (!indexDir) return false;
  return hasChunkMetaArtifactsSync(indexDir);
};

const hasTokenPostings = (indexDir) => {
  if (!indexDir) return false;
  const json = path.join(indexDir, 'token_postings.json');
  const meta = path.join(indexDir, 'token_postings.meta.json');
  const shards = path.join(indexDir, 'token_postings.shards');
  return fsSync.existsSync(json) || fsSync.existsSync(meta) || fsSync.existsSync(shards);
};

const validateRequiredArtifacts = (indexDir, mode) => {
  if (!hasChunkMeta(indexDir)) {
    fail(`[lmdb] ${mode} missing chunk_meta artifacts. Run build_index.js first.`, 2);
  }
  if (!hasTokenPostings(indexDir)) {
    fail(`[lmdb] ${mode} missing token_postings artifacts. Run build_index.js first.`, 2);
  }
};

const loadArtifactsForMode = async (indexDir, mode) => {
  const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES });
  const tokenPostings = loadTokenPostings(indexDir, { maxBytes: MAX_JSON_BYTES });
  const fileMeta = readJsonOptional(path.join(indexDir, 'file_meta.json'));
  const fileRelations = (() => {
    try {
      return loadJsonArrayArtifactSync(indexDir, 'file_relations', { maxBytes: MAX_JSON_BYTES });
    } catch {
      return null;
    }
  })();
  const repoMap = (() => {
    try {
      return loadJsonArrayArtifactSync(indexDir, 'repo_map', { maxBytes: MAX_JSON_BYTES });
    } catch {
      return null;
    }
  })();
  const filterIndex = readJsonOptional(path.join(indexDir, 'filter_index.json'));
  const fieldPostings = readJsonOptional(path.join(indexDir, 'field_postings.json'));
  const fieldTokens = readJsonOptional(path.join(indexDir, 'field_tokens.json'));
  const phraseNgrams = readJsonOptional(path.join(indexDir, 'phrase_ngrams.json'));
  const chargramPostings = readJsonOptional(path.join(indexDir, 'chargram_postings.json'));
  const minhashSignatures = readJsonOptional(path.join(indexDir, 'minhash_signatures.json'));
  const denseVectors = readJsonOptional(path.join(indexDir, 'dense_vectors_uint8.json'));
  const denseVectorsDoc = readJsonOptional(path.join(indexDir, 'dense_vectors_doc_uint8.json'));
  const denseVectorsCode = readJsonOptional(path.join(indexDir, 'dense_vectors_code_uint8.json'));
  const denseHnswMeta = readJsonOptional(path.join(indexDir, 'dense_vectors_hnsw.meta.json'));
  const indexState = readJsonOptional(path.join(indexDir, 'index_state.json'));
  const artifacts = {
    [LMDB_ARTIFACT_KEYS.chunkMeta]: chunkMeta,
    [LMDB_ARTIFACT_KEYS.tokenPostings]: tokenPostings,
    [LMDB_ARTIFACT_KEYS.fileMeta]: fileMeta,
    [LMDB_ARTIFACT_KEYS.fileRelations]: fileRelations,
    [LMDB_ARTIFACT_KEYS.repoMap]: repoMap,
    [LMDB_ARTIFACT_KEYS.filterIndex]: filterIndex,
    [LMDB_ARTIFACT_KEYS.fieldPostings]: fieldPostings,
    [LMDB_ARTIFACT_KEYS.fieldTokens]: fieldTokens,
    [LMDB_ARTIFACT_KEYS.phraseNgrams]: phraseNgrams,
    [LMDB_ARTIFACT_KEYS.chargramPostings]: chargramPostings,
    [LMDB_ARTIFACT_KEYS.minhashSignatures]: minhashSignatures,
    [LMDB_ARTIFACT_KEYS.denseVectors]: denseVectors,
    [LMDB_ARTIFACT_KEYS.denseVectorsDoc]: denseVectorsDoc,
    [LMDB_ARTIFACT_KEYS.denseVectorsCode]: denseVectorsCode,
    [LMDB_ARTIFACT_KEYS.denseHnswMeta]: denseHnswMeta,
    [LMDB_ARTIFACT_KEYS.indexState]: indexState
  };
  const artifactKeys = Object.entries(artifacts)
    .filter(([, value]) => value != null)
    .map(([key]) => key);
  const meta = {
    createdAt: new Date().toISOString(),
    mode,
    sourceIndex: indexDir,
    chunkCount: Array.isArray(chunkMeta) ? chunkMeta.length : 0,
    artifacts: artifactKeys
  };
  const stats = {
    chunkCount: meta.chunkCount,
    fileCount: Array.isArray(fileMeta) ? fileMeta.length : null,
    tokenCount: sumDocLengths(tokenPostings?.docLengths)
  };
  return { meta, artifacts, stats };
};

for (const mode of modes) {
  if (!supportedModes.includes(mode)) {
    fail(`Invalid mode: ${mode}. LMDB supports code|prose|all.`);
  }
  modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
  const indexDir = asOfContext?.provided
    ? asOfContext.indexDirByMode?.[mode] || null
    : getIndexDir(root, mode, userConfig, { indexRoot });
  if (asOfContext?.strict && !indexDir) {
    fail(`[lmdb] ${mode} index is unavailable for --as-of ${asOfContext.ref}.`, 2);
  }
  if (validateArtifacts) {
    validateRequiredArtifacts(indexDir, mode);
  }
  const targetPath = mode === 'code' ? lmdbPaths.codePath : lmdbPaths.prosePath;
  const buildStart = Date.now();
  await fs.mkdir(targetPath, { recursive: true });
  await updateLmdbState(indexDir, {
    enabled: true,
    ready: false,
    pending: true,
    schemaVersion: LMDB_SCHEMA_VERSION,
    buildMode
  });

  const readStart = Date.now();
  const { meta, artifacts, stats } = await loadArtifactsForMode(indexDir, mode);
  const estimatedBytes = estimateLmdbBytes(meta, artifacts);
  const mapSizeBytes = resolveMapSizeBytes(estimatedBytes);
  meta.mapSizeEstimatedBytes = estimatedBytes;
  meta.mapSizeBytes = mapSizeBytes;
  meta.mapSizeFactor = LMDB_MAP_SIZE_FACTOR;
  meta.pageSize = LMDB_PAGE_SIZE;
  const readMs = Date.now() - readStart;
  const writeStart = Date.now();
  const db = open({ path: targetPath, readOnly: false, mapSize: mapSizeBytes });
  storeArtifacts(db, meta, artifacts);
  db.close();
  const writeMs = Date.now() - writeStart;

  const finalState = await updateLmdbState(indexDir, {
    enabled: true,
    ready: true,
    pending: false,
    schemaVersion: LMDB_SCHEMA_VERSION,
    buildMode,
    path: targetPath,
    mapSizeBytes,
    mapSizeEstimatedBytes: estimatedBytes
  });
  const finalDb = open({ path: targetPath, readOnly: false, mapSize: mapSizeBytes });
  storeValue(finalDb, LMDB_ARTIFACT_KEYS.indexState, finalState);
  finalDb.close();

  const totalMs = Date.now() - buildStart;
  const metrics = {
    generatedAt: new Date().toISOString(),
    mode,
    sourceIndex: meta.sourceIndex,
    artifacts: meta.artifacts,
    files: { candidates: stats.fileCount },
    chunks: { total: stats.chunkCount },
    tokens: { total: stats.tokenCount },
    lmdb: {
      path: targetPath,
      mapSizeBytes,
      mapSizeEstimatedBytes: estimatedBytes,
      mapSizeFactor: LMDB_MAP_SIZE_FACTOR
    },
    timings: {
      totalMs,
      readMs,
      writeMs
    }
  };
  try {
    await fs.mkdir(metricsDir, { recursive: true });
    await writeJsonObjectFile(
      path.join(metricsDir, `lmdb-${mode}.json`),
      { fields: metrics, atomic: true }
    );
  } catch {}

  completedModes += 1;
  modeTask.set(completedModes, modes.length, { message: `built ${mode}` });
  log(`[lmdb] ${mode} index built at ${targetPath}.`);
}

display.close();

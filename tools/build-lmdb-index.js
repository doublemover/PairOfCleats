#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { createDisplay } from '../src/shared/cli/display.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifactSync,
  loadTokenPostings,
  readJsonFile,
  MAX_JSON_BYTES
} from '../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../src/shared/json-stream.js';
import { checksumFile } from '../src/shared/hash.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../src/storage/lmdb/schema.js';
import { getIndexDir, getMetricsDir, loadUserConfig, resolveIndexRoot, resolveLmdbPaths, resolveRepoRoot } from './dict-utils.js';
import { Packr } from 'msgpackr';

let open = null;
try {
  ({ open } = await import('lmdb'));
} catch {}

const argv = createCli({
  scriptName: 'build-lmdb-index',
  options: {
    mode: { type: 'string', default: 'all' },
    repo: { type: 'string' },
    'index-root': { type: 'string' },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();

const display = createDisplay({
  stream: process.stderr,
  progressMode: argv.progress,
  verbose: argv.verbose === true,
  quiet: argv.quiet === true
});
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

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const indexRoot = argv['index-root']
  ? path.resolve(argv['index-root'])
  : resolveIndexRoot(root, userConfig);
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

const updateIndexStateManifest = async (indexDir) => {
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) return;
  let manifest = null;
  try {
    manifest = readJsonFile(manifestPath) || null;
  } catch {
    return;
  }
  if (!manifest || !Array.isArray(manifest.pieces)) return;
  const statePath = path.join(indexDir, 'index_state.json');
  if (!fsSync.existsSync(statePath)) return;
  let bytes = null;
  let checksum = null;
  let checksumAlgo = null;
  try {
    const stat = await fs.stat(statePath);
    bytes = stat.size;
    const result = await checksumFile(statePath);
    checksum = result?.value || null;
    checksumAlgo = result?.algo || null;
  } catch {}
  if (!bytes || !checksum) return;
  const pieces = manifest.pieces.map((piece) => {
    if (piece?.name !== 'index_state' || piece?.path !== 'index_state.json') {
      return piece;
    }
    return {
      ...piece,
      bytes,
      checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : piece.checksum
    };
  });
  const next = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    pieces
  };
  try {
    await writeJsonObjectFile(manifestPath, { fields: next, atomic: true });
  } catch {
    // Ignore manifest write failures.
  }
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

const buildModeRaw = String(argv.mode || 'all').trim().toLowerCase();
const buildMode = buildModeRaw === 'both' ? 'all' : buildModeRaw;
const modes = buildMode === 'all' ? ['code', 'prose'] : [buildMode];
const modeTask = display.task('LMDB', { total: modes.length, stage: 'lmdb' });
let completedModes = 0;

const packr = new Packr();

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
    for (const [key, value] of Object.entries(artifacts)) {
      storeValue(db, key, value);
    }
  });
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
  if (!['code', 'prose'].includes(mode)) {
    fail(`Invalid mode: ${mode}`);
  }
  modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
  const indexDir = getIndexDir(root, mode, userConfig, { indexRoot });
  const targetPath = mode === 'code' ? lmdbPaths.codePath : lmdbPaths.prosePath;
  const buildStart = Date.now();
  await fs.mkdir(targetPath, { recursive: true });
  await updateLmdbState(indexDir, {
    enabled: true,
    ready: false,
    pending: true,
    schemaVersion: LMDB_SCHEMA_VERSION
  });

  const readStart = Date.now();
  const { meta, artifacts, stats } = await loadArtifactsForMode(indexDir, mode);
  const readMs = Date.now() - readStart;
  const writeStart = Date.now();
  const db = open({ path: targetPath, readOnly: false });
  storeArtifacts(db, meta, artifacts);
  db.close();
  const writeMs = Date.now() - writeStart;

  const finalState = await updateLmdbState(indexDir, {
    enabled: true,
    ready: true,
    pending: false,
    schemaVersion: LMDB_SCHEMA_VERSION,
    path: targetPath
  });
  const finalDb = open({ path: targetPath, readOnly: false });
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
    lmdb: { path: targetPath },
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

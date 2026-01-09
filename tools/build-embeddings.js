#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getEnvConfig } from '../src/shared/env.js';
import { createEmbedder, normalizeVec, quantizeVec } from '../src/index/embedding.js';
import { MAX_JSON_BYTES, loadChunkMeta, readJsonFile } from '../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../src/shared/json-stream.js';
import { sha1, sha1File } from '../src/shared/hash.js';
import {
  getIndexDir,
  getModelConfig,
  getRepoCacheRoot,
  loadUserConfig,
  resolveIndexRoot,
  resolveRepoRoot,
  resolveSqlitePaths
} from './dict-utils.js';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension
} from './vector-extension.js';
import { loadIncrementalManifest } from '../src/storage/sqlite/incremental.js';
import { dequantizeUint8ToFloat32, packUint8, toVectorId } from '../src/storage/sqlite/vector.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../src/index/build/build-state.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

const argv = createCli({
  scriptName: 'build-embeddings',
  argv: ['node', 'build-embeddings.js', ...process.argv.slice(2)],
  options: {
    mode: { type: 'string', default: 'all' },
    repo: { type: 'string' },
    dims: { type: 'number' },
    batch: { type: 'number' },
    'stub-embeddings': { type: 'boolean', default: false },
    'index-root': { type: 'string' }
  }
}).parse();

const root = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const envConfig = getEnvConfig();
const indexingConfig = userConfig.indexing || {};
const embeddingsConfig = indexingConfig.embeddings || {};
const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
  ? embeddingsConfig.mode.trim().toLowerCase()
  : 'auto';
const baseStubEmbeddings = argv['stub-embeddings'] === true
  || envConfig.embeddings === 'stub';
const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
  ? embeddingModeRaw
  : 'auto';
const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
  ? (baseStubEmbeddings ? 'stub' : 'inline')
  : (normalizedEmbeddingMode === 'service'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : normalizedEmbeddingMode);

if (embeddingsConfig.enabled === false || resolvedEmbeddingMode === 'off') {
  console.error('Embeddings disabled; skipping build-embeddings.');
  process.exit(0);
}

const modelConfig = getModelConfig(root, userConfig);
const modelId = modelConfig.id;
const modelsDir = modelConfig.dir || null;
const embeddingBatchRaw = Number(argv.batch ?? indexingConfig.embeddingBatchSize);
let embeddingBatchSize = Number.isFinite(embeddingBatchRaw)
  ? Math.max(0, Math.floor(embeddingBatchRaw))
  : 0;
if (!embeddingBatchSize) {
  const totalGb = os.totalmem() / (1024 ** 3);
  const autoBatch = Math.floor(totalGb * 32);
  embeddingBatchSize = Math.min(128, Math.max(32, autoBatch));
}

const useStubEmbeddings = resolvedEmbeddingMode === 'stub' || baseStubEmbeddings;
const embedder = createEmbedder({
  useStubEmbeddings,
  modelId,
  dims: argv.dims,
  modelsDir
});
const getChunkEmbeddings = embedder.getChunkEmbeddings;

const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const indexRoot = argv['index-root']
  ? path.resolve(argv['index-root'])
  : resolveIndexRoot(root, userConfig);
const buildStatePath = resolveBuildStatePath(indexRoot);
const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
const stopHeartbeat = hasBuildState ? startBuildHeartbeat(indexRoot, 'stage3') : () => {};
const cacheDirConfig = embeddingsConfig.cache?.dir;
const cacheRoot = cacheDirConfig
  ? path.resolve(cacheDirConfig)
  : path.join(repoCacheRoot, 'embeddings');

const resolveCacheDir = (mode) => path.join(cacheRoot, mode, 'files');

const hasTable = (db, table) => {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    return !!row;
  } catch {
    return false;
  }
};

const updateSqliteDense = ({ mode, vectors, dims, scale }) => {
  if (userConfig?.sqlite?.use === false) return;
  if (!Database) {
    console.warn(`[embeddings] better-sqlite3 not available; skipping SQLite update for ${mode}.`);
    return;
  }
  const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const dbPath = mode === 'code' ? sqlitePaths.codePath : sqlitePaths.prosePath;
  if (!dbPath || !fsSync.existsSync(dbPath)) {
    console.warn(`[embeddings] SQLite ${mode} index missing; skipping.`);
    return;
  }

  const db = new Database(dbPath);
  try {
    if (!hasTable(db, 'dense_vectors') || !hasTable(db, 'dense_meta')) {
      console.warn(`[embeddings] SQLite ${mode} index missing dense tables; skipping.`);
      return;
    }
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    } catch {}

    const vectorExtension = getVectorExtensionConfig(root, userConfig);
    let vectorAnnReady = false;
    let vectorAnnTable = vectorExtension.table || 'dense_vectors_ann';
    let vectorAnnColumn = vectorExtension.column || 'embedding';
    let insertVectorAnn = null;
    if (vectorExtension.enabled) {
      const loadResult = loadVectorExtension(db, vectorExtension, `embeddings ${mode}`);
      if (loadResult.ok) {
        if (hasVectorTable(db, vectorAnnTable)) {
          vectorAnnReady = true;
        } else {
          const created = ensureVectorTable(db, vectorExtension, dims);
          if (created.ok) {
            vectorAnnReady = true;
            vectorAnnTable = created.tableName;
            vectorAnnColumn = created.column;
          } else {
            console.warn(`[embeddings] Failed to create vector table for ${mode}: ${created.reason}`);
          }
        }
        if (vectorAnnReady) {
          insertVectorAnn = db.prepare(
            `INSERT OR REPLACE INTO ${vectorAnnTable} (rowid, ${vectorAnnColumn}) VALUES (?, ?)`
          );
        }
      } else {
        console.warn(`[embeddings] Vector extension unavailable for ${mode}: ${loadResult.reason}`);
      }
    }

    const deleteDense = db.prepare('DELETE FROM dense_vectors WHERE mode = ?');
    const deleteMeta = db.prepare('DELETE FROM dense_meta WHERE mode = ?');
    const insertDense = db.prepare(
      'INSERT OR REPLACE INTO dense_vectors (mode, doc_id, vector) VALUES (?, ?, ?)'
    );
    const insertMeta = db.prepare(
      'INSERT OR REPLACE INTO dense_meta (mode, dims, scale, model) VALUES (?, ?, ?, ?)'
    );
    const run = db.transaction(() => {
      deleteDense.run(mode);
      deleteMeta.run(mode);
      if (vectorAnnReady) {
        db.exec(`DELETE FROM ${vectorAnnTable}`);
      }
      insertMeta.run(mode, dims, scale, modelId || null);
      for (let docId = 0; docId < vectors.length; docId += 1) {
        const vec = vectors[docId];
        insertDense.run(mode, docId, packUint8(vec));
        if (vectorAnnReady && insertVectorAnn) {
          const floatVec = dequantizeUint8ToFloat32(vec);
          const encoded = encodeVector(floatVec, vectorExtension);
          if (encoded) insertVectorAnn.run(toVectorId(docId), encoded);
        }
      }
    });
    run();
    console.log(`[embeddings] ${mode}: SQLite dense vectors updated (${dbPath}).`);
  } finally {
    db.close();
  }
};

const updatePieceManifest = async ({ indexDir, mode, totalChunks, dims }) => {
  const piecesDir = path.join(indexDir, 'pieces');
  const manifestPath = path.join(piecesDir, 'manifest.json');
  let existing = {};
  if (fsSync.existsSync(manifestPath)) {
    try {
      existing = readJsonFile(manifestPath, { maxBytes: MAX_JSON_BYTES }) || {};
    } catch {
      existing = {};
    }
  }
  const priorPieces = Array.isArray(existing.pieces) ? existing.pieces : [];
  const retained = priorPieces.filter((entry) => entry?.type !== 'embeddings');
  const embeddingPieces = [
    { type: 'embeddings', name: 'dense_vectors', format: 'json', path: 'dense_vectors_uint8.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_doc', format: 'json', path: 'dense_vectors_doc_uint8.json', count: totalChunks, dims },
    { type: 'embeddings', name: 'dense_vectors_code', format: 'json', path: 'dense_vectors_code_uint8.json', count: totalChunks, dims }
  ];
  const enriched = [];
  for (const entry of embeddingPieces) {
    const absPath = path.join(indexDir, entry.path);
    if (!fsSync.existsSync(absPath)) continue;
    let bytes = null;
    let checksum = null;
    try {
      const stat = await fs.stat(absPath);
      bytes = stat.size;
      checksum = await sha1File(absPath);
    } catch {}
    enriched.push({
      ...entry,
      bytes,
      checksum: checksum ? `sha1:${checksum}` : null
    });
  }
  const now = new Date().toISOString();
  const manifest = {
    version: existing.version || 2,
    generatedAt: existing.generatedAt || now,
    updatedAt: now,
    mode,
    stage: existing.stage || 'stage3',
    pieces: [...retained, ...enriched]
  };
  await fs.mkdir(piecesDir, { recursive: true });
  await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });
};

const runBatched = async (texts) => {
  if (!texts.length) return [];
  if (!embeddingBatchSize || texts.length <= embeddingBatchSize) {
    return getChunkEmbeddings(texts);
  }
  const out = [];
  for (let i = 0; i < texts.length; i += embeddingBatchSize) {
    const slice = texts.slice(i, i + embeddingBatchSize);
    const batch = await getChunkEmbeddings(slice);
    out.push(...batch);
  }
  return out;
};

const ensureVectorArrays = (vectors, count) => {
  if (Array.isArray(vectors) && vectors.length === count) return vectors;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Array.isArray(vectors?.[i]) ? vectors[i] : []);
  }
  return out;
};

const buildChunkSignature = (items) => sha1(
  items.map(({ chunk }) => `${chunk.start}:${chunk.end}`).join('|')
);

const buildChunksFromBundles = async (bundleDir, manifestFiles) => {
  const chunksByFile = new Map();
  let maxChunkId = -1;
  let total = 0;
  for (const [relPath, entry] of Object.entries(manifestFiles || {})) {
    const bundleName = entry?.bundle || `${sha1(relPath)}.json`;
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) continue;
    let bundle;
    try {
      bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    } catch {
      continue;
    }
    const filePath = bundle?.file || relPath;
    const chunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
    if (!chunks.length) continue;
    const list = chunksByFile.get(filePath) || [];
    for (const chunk of chunks) {
      if (!chunk) continue;
      const id = Number.isFinite(chunk.id) ? chunk.id : null;
      if (Number.isFinite(id) && id > maxChunkId) maxChunkId = id;
      list.push({ index: Number.isFinite(id) ? id : null, chunk });
      total += 1;
    }
    chunksByFile.set(filePath, list);
  }
  if (!chunksByFile.size) {
    return { chunksByFile, totalChunks: 0 };
  }
  let totalChunks = maxChunkId >= 0 ? maxChunkId + 1 : total;
  if (maxChunkId < 0) {
    let next = 0;
    for (const list of chunksByFile.values()) {
      for (const item of list) {
        item.index = next;
        next += 1;
      }
    }
    totalChunks = next;
  } else {
    let next = maxChunkId + 1;
    for (const list of chunksByFile.values()) {
      for (const item of list) {
        if (Number.isFinite(item.index)) continue;
        item.index = next;
        next += 1;
      }
    }
    totalChunks = Math.max(totalChunks, next);
  }
  return { chunksByFile, totalChunks };
};

const embedModeRaw = (argv.mode || 'all').toLowerCase();
const embedMode = embedModeRaw === 'both' ? 'all' : embedModeRaw;
const modes = embedMode === 'all' ? ['code', 'prose'] : [embedMode];

if (hasBuildState) {
  await markBuildPhase(indexRoot, 'stage3', 'running');
}

for (const mode of modes) {
  if (!['code', 'prose'].includes(mode)) {
    console.error(`Invalid mode: ${mode}`);
    process.exit(1);
  }
  const indexDir = getIndexDir(root, mode, userConfig, { indexRoot });
  const chunkMetaPath = path.join(indexDir, 'chunk_meta.json');
  const chunkMetaJsonlPath = path.join(indexDir, 'chunk_meta.jsonl');
  const chunkMetaMetaPath = path.join(indexDir, 'chunk_meta.meta.json');
  const incremental = loadIncrementalManifest(repoCacheRoot, mode);
  const manifestFiles = incremental?.manifest?.files || {};
  const hasChunkMeta = fsSync.existsSync(chunkMetaPath)
    || fsSync.existsSync(chunkMetaJsonlPath)
    || fsSync.existsSync(chunkMetaMetaPath);
  let chunkMeta;
  try {
    if (hasChunkMeta) {
      chunkMeta = loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES });
    }
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') {
      console.warn(`[embeddings] chunk_meta too large for ${mode}; using incremental bundles if available.`);
    } else {
      console.warn(`[embeddings] Failed to load chunk_meta for ${mode}: ${err?.message || err}`);
    }
    chunkMeta = null;
  }
  let chunksByFile = new Map();
  let totalChunks = 0;
  if (Array.isArray(chunkMeta)) {
    const fileMetaPath = path.join(indexDir, 'file_meta.json');
    let fileMeta = [];
    if (fsSync.existsSync(fileMetaPath)) {
      try {
        fileMeta = readJsonFile(fileMetaPath, { maxBytes: MAX_JSON_BYTES });
      } catch (err) {
        console.warn(`[embeddings] Failed to read file_meta for ${mode}: ${err?.message || err}`);
        fileMeta = [];
      }
    }
    const fileMetaById = new Map();
    if (Array.isArray(fileMeta)) {
      for (const entry of fileMeta) {
        if (!entry || !Number.isFinite(entry.id)) continue;
        fileMetaById.set(entry.id, entry);
      }
    }
    for (let i = 0; i < chunkMeta.length; i += 1) {
      const chunk = chunkMeta[i];
      if (!chunk) continue;
      const filePath = chunk.file || fileMetaById.get(chunk.fileId)?.file;
      if (!filePath) continue;
      const list = chunksByFile.get(filePath) || [];
      list.push({ index: i, chunk });
      chunksByFile.set(filePath, list);
    }
    totalChunks = chunkMeta.length;
  } else {
    if (!manifestFiles || !Object.keys(manifestFiles).length) {
      console.warn(`[embeddings] Missing chunk_meta and no incremental bundles for ${mode}; skipping.`);
      continue;
    }
    const bundleResult = await buildChunksFromBundles(incremental.bundleDir, manifestFiles);
    chunksByFile = bundleResult.chunksByFile;
    totalChunks = bundleResult.totalChunks;
    if (!chunksByFile.size || !totalChunks) {
      console.warn(`[embeddings] Incremental bundles empty for ${mode}; skipping.`);
      continue;
    }
    console.log(`[embeddings] ${mode}: using incremental bundles (${chunksByFile.size} files).`);
  }
  const codeVectors = new Array(totalChunks).fill(null);
  const docVectors = new Array(totalChunks).fill(null);
  const mergedVectors = new Array(totalChunks).fill(null);
  const cacheDir = resolveCacheDir(mode);
  await fs.mkdir(cacheDir, { recursive: true });
  let dims = 0;
  let processedFiles = 0;

  for (const [relPath, items] of chunksByFile.entries()) {
    const normalizedRel = relPath.replace(/\\/g, '/');
    const chunkSignature = buildChunkSignature(items);
    const manifestEntry = manifestFiles[normalizedRel] || null;
    const manifestHash = typeof manifestEntry?.hash === 'string' ? manifestEntry.hash : null;
    let fileHash = manifestHash;
    let cacheKey = fileHash
      ? sha1(`${normalizedRel}:${fileHash}:${chunkSignature}`)
      : null;
    let cachePath = cacheKey ? path.join(cacheDir, `${cacheKey}.json`) : null;

    if (cachePath && fsSync.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        if (cached && cached.chunkSignature === chunkSignature) {
          const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
          const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
          const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
          for (let i = 0; i < items.length; i += 1) {
            const chunkIndex = items[i].index;
            codeVectors[chunkIndex] = cachedCode[i] || [];
            docVectors[chunkIndex] = cachedDoc[i] || [];
            mergedVectors[chunkIndex] = cachedMerged[i] || [];
            if (!dims && cachedMerged[i] && cachedMerged[i].length) {
              dims = cachedMerged[i].length;
            }
          }
          processedFiles += 1;
          continue;
        }
      } catch {
        // Ignore cache parse errors.
      }
    }

    const absPath = path.resolve(root, normalizedRel.split('/').join(path.sep));
    let text;
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      console.warn(`[embeddings] Failed to read ${normalizedRel}; skipping.`);
      continue;
    }
    if (!fileHash) {
      fileHash = sha1(text);
      cacheKey = sha1(`${normalizedRel}:${fileHash}:${chunkSignature}`);
      cachePath = path.join(cacheDir, `${cacheKey}.json`);
      if (fsSync.existsSync(cachePath)) {
        try {
          const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
          if (cached && cached.chunkSignature === chunkSignature) {
            const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
            const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
            const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
            for (let i = 0; i < items.length; i += 1) {
              const chunkIndex = items[i].index;
              codeVectors[chunkIndex] = cachedCode[i] || [];
              docVectors[chunkIndex] = cachedDoc[i] || [];
              mergedVectors[chunkIndex] = cachedMerged[i] || [];
              if (!dims && cachedMerged[i] && cachedMerged[i].length) {
                dims = cachedMerged[i].length;
              }
            }
            processedFiles += 1;
            continue;
          }
        } catch {
          // Ignore cache parse errors.
        }
      }
    }

    const codeTexts = [];
    const docTexts = [];
    for (const { chunk } of items) {
      const start = Number(chunk.start) || 0;
      const end = Number(chunk.end) || start;
      codeTexts.push(text.slice(start, end));
      const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
      docTexts.push(docText.trim() ? docText : '');
    }

    let codeEmbeds = await runBatched(codeTexts);
    codeEmbeds = ensureVectorArrays(codeEmbeds, codeTexts.length);
    const docVectorsRaw = new Array(items.length).fill(null);
    const docIndexes = [];
    const docPayloads = [];
    for (let i = 0; i < docTexts.length; i += 1) {
      if (docTexts[i]) {
        docIndexes.push(i);
        docPayloads.push(docTexts[i]);
      }
    }
    if (docPayloads.length) {
      const embeddedDocs = await runBatched(docPayloads);
      for (let i = 0; i < docIndexes.length; i += 1) {
        docVectorsRaw[docIndexes[i]] = embeddedDocs[i] || null;
      }
    }

    if (!dims) {
      const first = codeEmbeds.find((vec) => Array.isArray(vec) && vec.length);
      dims = first ? first.length : dims;
    }
    const zeroVec = dims ? Array.from({ length: dims }, () => 0) : [];

    const cachedCodeVectors = [];
    const cachedDocVectors = [];
    const cachedMergedVectors = [];
    for (let i = 0; i < items.length; i += 1) {
      const chunkIndex = items[i].index;
      const embedCode = Array.isArray(codeEmbeds[i]) ? codeEmbeds[i] : [];
      const embedDoc = Array.isArray(docVectorsRaw[i])
        ? docVectorsRaw[i]
        : zeroVec;
      const merged = embedCode.length
        ? embedCode.map((v, idx) => (v + (embedDoc[idx] ?? 0)) / 2)
        : embedDoc;
      const normalized = normalizeVec(merged);
      const quantizedCode = embedCode.length ? quantizeVec(embedCode) : [];
      const quantizedDoc = embedDoc.length ? quantizeVec(embedDoc) : [];
      const quantizedMerged = normalized.length ? quantizeVec(normalized) : [];
      codeVectors[chunkIndex] = quantizedCode;
      docVectors[chunkIndex] = quantizedDoc;
      mergedVectors[chunkIndex] = quantizedMerged;
      cachedCodeVectors.push(quantizedCode);
      cachedDocVectors.push(quantizedDoc);
      cachedMergedVectors.push(quantizedMerged);
    }

    try {
      await fs.writeFile(cachePath, JSON.stringify({
        key: cacheKey,
        file: normalizedRel,
        hash: fileHash,
        chunkSignature,
        codeVectors: cachedCodeVectors,
        docVectors: cachedDocVectors,
        mergedVectors: cachedMergedVectors
      }));
    } catch {
      // Ignore cache write failures.
    }
    processedFiles += 1;
    if (processedFiles % 50 === 0) {
      console.log(`[embeddings] ${mode}: processed ${processedFiles}/${chunksByFile.size} files`);
    }
  }

  const finalDims = dims || Number(argv.dims) || 384;
  const fillMissing = (vectorList) => {
    const fallback = new Array(finalDims).fill(0);
    for (let i = 0; i < vectorList.length; i += 1) {
      if (!Array.isArray(vectorList[i]) || vectorList[i].length !== finalDims) {
        vectorList[i] = fallback;
      }
    }
  };
  fillMissing(codeVectors);
  fillMissing(docVectors);
  fillMissing(mergedVectors);

  const denseScale = 2 / 255;
  await writeJsonObjectFile(path.join(indexDir, 'dense_vectors_uint8.json'), {
    fields: { model: modelId, dims: finalDims, scale: denseScale },
    arrays: { vectors: mergedVectors },
    atomic: true
  });
  await writeJsonObjectFile(path.join(indexDir, 'dense_vectors_doc_uint8.json'), {
    fields: { model: modelId, dims: finalDims, scale: denseScale },
    arrays: { vectors: docVectors },
    atomic: true
  });
  await writeJsonObjectFile(path.join(indexDir, 'dense_vectors_code_uint8.json'), {
    fields: { model: modelId, dims: finalDims, scale: denseScale },
    arrays: { vectors: codeVectors },
    atomic: true
  });

  const statePath = path.join(indexDir, 'index_state.json');
  let indexState = {};
  if (fsSync.existsSync(statePath)) {
    try {
      indexState = readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) || {};
    } catch {
      indexState = {};
    }
  }
  const now = new Date().toISOString();
  indexState.generatedAt = indexState.generatedAt || now;
  indexState.updatedAt = now;
  indexState.mode = indexState.mode || mode;
  indexState.embeddings = {
    ...(indexState.embeddings || {}),
    enabled: true,
    ready: true,
    mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
    service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
    updatedAt: now
  };
  if (indexState.enrichment && indexState.enrichment.enabled) {
    indexState.enrichment = {
      ...indexState.enrichment,
      pending: false,
      stage: indexState.enrichment.stage || indexState.stage || 'stage2'
    };
  }
  try {
    await fs.writeFile(statePath, JSON.stringify(indexState, null, 2));
  } catch {
    // Ignore index state write failures.
  }

  try {
    await updatePieceManifest({ indexDir, mode, totalChunks, dims: finalDims });
  } catch {
    // Ignore piece manifest write failures.
  }

  updateSqliteDense({
    mode,
    vectors: mergedVectors,
    dims: finalDims,
    scale: denseScale
  });

  console.log(`[embeddings] ${mode}: wrote ${totalChunks} vectors (dims=${finalDims}).`);
}

if (hasBuildState) {
  await markBuildPhase(indexRoot, 'stage3', 'done');
}
stopHeartbeat();

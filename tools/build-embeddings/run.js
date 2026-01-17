import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createEmbedder } from '../../src/index/embedding.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../src/index/build/build-state.js';
import { loadIncrementalManifest } from '../../src/storage/sqlite/incremental.js';
import { dequantizeUint8ToFloat32 } from '../../src/storage/sqlite/vector.js';
import { loadChunkMeta, readJsonFile, MAX_JSON_BYTES } from '../../src/shared/artifact-io.js';
import { readTextFileWithHash } from '../../src/shared/encoding.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { resolveHnswPaths } from '../../src/shared/hnsw.js';
import { normalizeLanceDbConfig } from '../../src/shared/lancedb.js';
import { createDisplay } from '../../src/shared/cli/display.js';
import { getIndexDir, getRepoCacheRoot } from '../dict-utils.js';
import { buildCacheIdentity, buildCacheKey, isCacheValid, resolveCacheDir, resolveCacheRoot } from './cache.js';
import { buildChunkSignature, buildChunksFromBundles } from './chunks.js';
import {
  buildQuantizedVectors,
  createDimsValidator,
  ensureVectorArrays,
  fillMissingVectors,
  isDimsMismatch,
  runBatched,
  validateCachedDims
} from './embed.js';
import { createHnswBuilder } from './hnsw.js';
import { writeLanceDbIndex } from './lancedb.js';
import { updatePieceManifest } from './manifest.js';
import { updateSqliteDense } from './sqlite-dense.js';
import { parseBuildEmbeddingsArgs } from './cli.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

const loadIndexState = (statePath) => {
  if (!fsSync.existsSync(statePath)) return {};
  try {
    return readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) || {};
  } catch {
    return {};
  }
};

const writeIndexState = async (statePath, state) => {
  await writeJsonObjectFile(statePath, { fields: state, atomic: true });
};

export async function runBuildEmbeddings(rawArgs = process.argv.slice(2), _options = {}) {
  const config = parseBuildEmbeddingsArgs(rawArgs, _options);
  const {
    argv,
    root,
    userConfig,
    embeddingsConfig,
    embeddingProvider,
    embeddingOnnx,
    hnswConfig,
    normalizedEmbeddingMode,
    resolvedEmbeddingMode,
    useStubEmbeddings,
    embeddingBatchSize,
    configuredDims,
    modelId,
    modelsDir,
    indexRoot,
    modes
  } = config;
  const display = createDisplay({
    stream: process.stderr,
    progressMode: argv.progress,
    verbose: argv.verbose === true,
    quiet: argv.quiet === true
  });
  let displayClosed = false;
  const closeDisplay = () => {
    if (displayClosed) return;
    displayClosed = true;
    display.close();
  };
  process.once('exit', closeDisplay);
  const log = (message) => display.log(message);
  const warn = (message) => display.warn(message);
  const error = (message) => display.error(message);
  const logger = { log, warn, error };
  const fail = (message, code = 1) => {
    error(message);
    closeDisplay();
    process.exit(code);
  };
  const lanceConfig = normalizeLanceDbConfig(embeddingsConfig.lancedb || {});

  if (embeddingsConfig.enabled === false || resolvedEmbeddingMode === 'off') {
    error('Embeddings disabled; skipping build-embeddings.');
    closeDisplay();
    return { skipped: true };
  }

  const denseScale = 2 / 255;
  const cacheDims = useStubEmbeddings ? (configuredDims || 384) : configuredDims;
  const { identity: cacheIdentity, key: cacheIdentityKey } = buildCacheIdentity({
    modelId,
    provider: embeddingProvider,
    mode: resolvedEmbeddingMode,
    stub: useStubEmbeddings,
    dims: cacheDims,
    scale: denseScale
  });

  const embedder = createEmbedder({
    rootDir: root,
    useStubEmbeddings,
    modelId,
    dims: argv.dims,
    modelsDir,
    provider: embeddingProvider,
    onnx: embeddingOnnx
  });
  const getChunkEmbeddings = embedder.getChunkEmbeddings;

  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const buildStatePath = resolveBuildStatePath(indexRoot);
  const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
  const stopHeartbeat = hasBuildState ? startBuildHeartbeat(indexRoot, 'stage3') : () => {};

  const cacheRoot = resolveCacheRoot({
    repoCacheRoot,
    cacheDirConfig: embeddingsConfig.cache?.dir
  });

  if (hasBuildState) {
    await markBuildPhase(indexRoot, 'stage3', 'running');
  }

  const modeTask = display.task('Embeddings', { total: modes.length, stage: 'embeddings' });
  let completedModes = 0;

  for (const mode of modes) {
    if (!['code', 'prose', 'extracted-prose'].includes(mode)) {
      fail(`Invalid mode: ${mode}`);
    }
    modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
    const finishMode = (message) => {
      completedModes += 1;
      modeTask.set(completedModes, modes.length, { message });
    };
    const indexDir = getIndexDir(root, mode, userConfig, { indexRoot });
    const statePath = path.join(indexDir, 'index_state.json');
    const stateNow = new Date().toISOString();
    let indexState = loadIndexState(statePath);
    indexState.generatedAt = indexState.generatedAt || stateNow;
    indexState.updatedAt = stateNow;
    indexState.mode = indexState.mode || mode;
    indexState.embeddings = {
      ...(indexState.embeddings || {}),
      enabled: true,
      ready: false,
      pending: true,
      mode: indexState.embeddings?.mode || resolvedEmbeddingMode,
      service: indexState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
      updatedAt: stateNow
    };
    try {
      await writeIndexState(statePath, indexState);
    } catch {
      // Ignore index state write failures.
    }

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
        chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES });
      }
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        warn(`[embeddings] chunk_meta too large for ${mode}; using incremental bundles if available.`);
      } else {
        warn(`[embeddings] Failed to load chunk_meta for ${mode}: ${err?.message || err}`);
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
          warn(`[embeddings] Failed to read file_meta for ${mode}: ${err?.message || err}`);
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
        warn(`[embeddings] Missing chunk_meta and no incremental bundles for ${mode}; skipping.`);
        finishMode(`skipped ${mode}`);
        continue;
      }
      const bundleResult = await buildChunksFromBundles(
        incremental.bundleDir,
        manifestFiles,
        incremental?.manifest?.bundleFormat
      );
      chunksByFile = bundleResult.chunksByFile;
      totalChunks = bundleResult.totalChunks;
      if (!chunksByFile.size || !totalChunks) {
        warn(`[embeddings] Incremental bundles empty for ${mode}; skipping.`);
        finishMode(`skipped ${mode}`);
        continue;
      }
      log(`[embeddings] ${mode}: using incremental bundles (${chunksByFile.size} files).`);
    }

    const codeVectors = new Array(totalChunks).fill(null);
    const docVectors = new Array(totalChunks).fill(null);
    const mergedVectors = new Array(totalChunks).fill(null);
    const { indexPath: hnswIndexPath, metaPath: hnswMetaPath } = resolveHnswPaths(indexDir);
    const hnswBuilder = createHnswBuilder({ enabled: hnswConfig.enabled, config: hnswConfig, totalChunks, mode });

    const cacheDir = resolveCacheDir(cacheRoot, mode);
    await fs.mkdir(cacheDir, { recursive: true });

    const dimsValidator = createDimsValidator({ mode, configuredDims });
    const assertDims = dimsValidator.assertDims;

    if (configuredDims) {
      try {
        const entries = await fs.readdir(cacheDir);
        for (const entry of entries) {
          if (!entry.endsWith('.json')) continue;
          const cached = JSON.parse(await fs.readFile(path.join(cacheDir, entry), 'utf8'));
          if (cached.cacheMeta?.identityKey !== cacheIdentityKey) continue;
          const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
          validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
          validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
          validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
        }
      } catch (err) {
        if (isDimsMismatch(err)) throw err;
        // Ignore cache preflight errors.
      }
    }

    let processedFiles = 0;
    const fileTask = display.task('Files', {
      taskId: `embeddings:${mode}:files`,
      total: chunksByFile.size,
      stage: 'embeddings',
      mode,
      ephemeral: true
    });
    for (const [relPath, items] of chunksByFile.entries()) {
      const normalizedRel = relPath.replace(/\\/g, '/');
      const chunkSignature = buildChunkSignature(items);
      const manifestEntry = manifestFiles[normalizedRel] || null;
      const manifestHash = typeof manifestEntry?.hash === 'string' ? manifestEntry.hash : null;
      let fileHash = manifestHash;
      let cacheKey = buildCacheKey({
        file: normalizedRel,
        hash: fileHash,
        signature: chunkSignature,
        identityKey: cacheIdentityKey
      });
      let cachePath = cacheKey ? path.join(cacheDir, `${cacheKey}.json`) : null;

      if (cachePath && fsSync.existsSync(cachePath)) {
        try {
          const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
          const cacheIdentityMatches = cached.cacheMeta?.identityKey === cacheIdentityKey;
          if (cacheIdentityMatches) {
            const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
            validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
            validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
            validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
          }
          if (isCacheValid({ cached, signature: chunkSignature, identityKey: cacheIdentityKey })) {
            const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
            const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
            const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
            for (let i = 0; i < items.length; i += 1) {
              const chunkIndex = items[i].index;
              const codeVec = cachedCode[i] || [];
              const docVec = cachedDoc[i] || [];
              const mergedVec = cachedMerged[i] || [];
              if (codeVec.length) assertDims(codeVec.length);
              if (docVec.length) assertDims(docVec.length);
              if (mergedVec.length) assertDims(mergedVec.length);
              codeVectors[chunkIndex] = codeVec;
              docVectors[chunkIndex] = docVec;
              mergedVectors[chunkIndex] = mergedVec;
              if (hnswConfig.enabled && mergedVec.length) {
                const floatVec = dequantizeUint8ToFloat32(mergedVec);
                if (floatVec) hnswBuilder.addVector(chunkIndex, floatVec);
              }
            }
            processedFiles += 1;
            continue;
          }
        } catch (err) {
          if (isDimsMismatch(err)) throw err;
          // Ignore cache parse errors.
        }
      }

      const absPath = path.resolve(root, normalizedRel.split('/').join(path.sep));
      let textInfo;
      try {
        textInfo = await readTextFileWithHash(absPath);
      } catch {
        warn(`[embeddings] Failed to read ${normalizedRel}; skipping.`);
        continue;
      }
      const text = textInfo.text;
      if (!fileHash) {
        fileHash = textInfo.hash;
        cacheKey = buildCacheKey({
          file: normalizedRel,
          hash: fileHash,
          signature: chunkSignature,
          identityKey: cacheIdentityKey
        });
        cachePath = cacheKey ? path.join(cacheDir, `${cacheKey}.json`) : null;
        if (cachePath && fsSync.existsSync(cachePath)) {
          try {
            const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
            const cacheIdentityMatches = cached.cacheMeta?.identityKey === cacheIdentityKey;
            if (cacheIdentityMatches) {
              const expectedDims = configuredDims || cached.cacheMeta?.identity?.dims || null;
              validateCachedDims({ vectors: cached.codeVectors, expectedDims, mode });
              validateCachedDims({ vectors: cached.docVectors, expectedDims, mode });
              validateCachedDims({ vectors: cached.mergedVectors, expectedDims, mode });
            }
            if (isCacheValid({ cached, signature: chunkSignature, identityKey: cacheIdentityKey })) {
              const cachedCode = ensureVectorArrays(cached.codeVectors, items.length);
              const cachedDoc = ensureVectorArrays(cached.docVectors, items.length);
              const cachedMerged = ensureVectorArrays(cached.mergedVectors, items.length);
              for (let i = 0; i < items.length; i += 1) {
                const chunkIndex = items[i].index;
                const codeVec = cachedCode[i] || [];
                const docVec = cachedDoc[i] || [];
                const mergedVec = cachedMerged[i] || [];
                if (codeVec.length) assertDims(codeVec.length);
                if (docVec.length) assertDims(docVec.length);
                if (mergedVec.length) assertDims(mergedVec.length);
                codeVectors[chunkIndex] = codeVec;
                docVectors[chunkIndex] = docVec;
                mergedVectors[chunkIndex] = mergedVec;
                if (hnswConfig.enabled && mergedVec.length) {
                  const floatVec = dequantizeUint8ToFloat32(mergedVec);
                  if (floatVec) hnswBuilder.addVector(chunkIndex, floatVec);
                }
              }
              processedFiles += 1;
              continue;
            }
          } catch (err) {
            if (isDimsMismatch(err)) throw err;
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

      let codeEmbeds = await runBatched({
        texts: codeTexts,
        batchSize: embeddingBatchSize,
        embed: getChunkEmbeddings
      });
      codeEmbeds = ensureVectorArrays(codeEmbeds, codeTexts.length);
      for (const vec of codeEmbeds) {
        if (Array.isArray(vec) && vec.length) assertDims(vec.length);
      }

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
        const embeddedDocs = await runBatched({
          texts: docPayloads,
          batchSize: embeddingBatchSize,
          embed: getChunkEmbeddings
        });
        for (let i = 0; i < docIndexes.length; i += 1) {
          docVectorsRaw[docIndexes[i]] = embeddedDocs[i] || null;
        }
      }
      for (const vec of docVectorsRaw) {
        if (Array.isArray(vec) && vec.length) assertDims(vec.length);
      }

      const dims = dimsValidator.getDims();
      const zeroVec = dims ? Array.from({ length: dims }, () => 0) : [];

      const cachedCodeVectors = [];
      const cachedDocVectors = [];
      const cachedMergedVectors = [];
      for (let i = 0; i < items.length; i += 1) {
        const chunkIndex = items[i].index;
        const embedCode = Array.isArray(codeEmbeds[i]) ? codeEmbeds[i] : [];
        const embedDoc = Array.isArray(docVectorsRaw[i]) ? docVectorsRaw[i] : zeroVec;
        const quantized = buildQuantizedVectors({
          chunkIndex,
          codeVector: embedCode,
          docVector: embedDoc,
          zeroVector: zeroVec,
          addHnswVector: hnswConfig.enabled ? hnswBuilder.addVector : null
        });
        codeVectors[chunkIndex] = quantized.quantizedCode;
        docVectors[chunkIndex] = quantized.quantizedDoc;
        mergedVectors[chunkIndex] = quantized.quantizedMerged;
        cachedCodeVectors.push(quantized.quantizedCode);
        cachedDocVectors.push(quantized.quantizedDoc);
        cachedMergedVectors.push(quantized.quantizedMerged);
      }

      if (cachePath) {
        try {
          await fs.writeFile(cachePath, JSON.stringify({
            key: cacheKey,
            file: normalizedRel,
            hash: fileHash,
            chunkSignature,
            cacheMeta: {
              identityKey: cacheIdentityKey,
              identity: cacheIdentity,
              createdAt: new Date().toISOString()
            },
            codeVectors: cachedCodeVectors,
            docVectors: cachedDocVectors,
            mergedVectors: cachedMergedVectors
          }));
        } catch {
          // Ignore cache write failures.
        }
      }

      processedFiles += 1;
      if (processedFiles % 50 === 0 || processedFiles === chunksByFile.size) {
        fileTask.set(processedFiles, chunksByFile.size, { message: `${processedFiles}/${chunksByFile.size} files` });
        log(`[embeddings] ${mode}: processed ${processedFiles}/${chunksByFile.size} files`);
      }
    }

    const observedDims = dimsValidator.getDims();
    if (configuredDims && observedDims && configuredDims !== observedDims) {
      throw new Error(
        `[embeddings] ${mode} embedding dims mismatch (configured=${configuredDims}, observed=${observedDims}).`
      );
    }
    const finalDims = observedDims || configuredDims || 384;
    fillMissingVectors(codeVectors, finalDims);
    fillMissingVectors(docVectors, finalDims);
    fillMissingVectors(mergedVectors, finalDims);

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

    if (hnswConfig.enabled) {
      try {
        const result = await hnswBuilder.writeIndex({
          indexPath: hnswIndexPath,
          metaPath: hnswMetaPath,
          modelId,
          dims: finalDims
        });
        if (!result.skipped) {
          log(`[embeddings] ${mode}: wrote HNSW index (${result.count} vectors).`);
        }
      } catch (err) {
        warn(`[embeddings] ${mode}: failed to write HNSW index: ${err?.message || err}`);
      }
    }

    try {
      await writeLanceDbIndex({
        indexDir,
        variant: 'merged',
        vectors: mergedVectors,
        dims: finalDims,
        modelId,
        config: lanceConfig,
        emitOutput: true,
        label: `${mode}/merged`,
        logger
      });
      await writeLanceDbIndex({
        indexDir,
        variant: 'doc',
        vectors: docVectors,
        dims: finalDims,
        modelId,
        config: lanceConfig,
        emitOutput: true,
        label: `${mode}/doc`,
        logger
      });
      await writeLanceDbIndex({
        indexDir,
        variant: 'code',
        vectors: codeVectors,
        dims: finalDims,
        modelId,
        config: lanceConfig,
        emitOutput: true,
        label: `${mode}/code`,
        logger
      });
    } catch (err) {
      warn(`[embeddings] ${mode}: failed to write LanceDB indexes: ${err?.message || err}`);
    }

    const now = new Date().toISOString();
    indexState.generatedAt = indexState.generatedAt || now;
    indexState.updatedAt = now;
    indexState.mode = indexState.mode || mode;
    indexState.embeddings = {
      ...(indexState.embeddings || {}),
      enabled: true,
      ready: true,
      pending: false,
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
      await writeIndexState(statePath, indexState);
    } catch {
      // Ignore index state write failures.
    }

    try {
      await updatePieceManifest({ indexDir, mode, totalChunks, dims: finalDims });
    } catch {
      // Ignore piece manifest write failures.
    }

    if (mode === 'code' || mode === 'prose') {
      updateSqliteDense({
        Database,
        root,
        userConfig,
        indexRoot,
        mode,
        vectors: mergedVectors,
        dims: finalDims,
        scale: denseScale,
        modelId,
        emitOutput: true,
        logger
      });
    }

    const validation = await validateIndexArtifacts({
      root,
      indexRoot,
      modes: [mode],
      userConfig,
      sqliteEnabled: false
    });
    if (!validation.ok) {
      throw new Error(`[embeddings] ${mode} index validation failed; see index-validate output for details.`);
    }

    log(`[embeddings] ${mode}: wrote ${totalChunks} vectors (dims=${finalDims}).`);
    finishMode(`built ${mode}`);
  }

  if (hasBuildState) {
    await markBuildPhase(indexRoot, 'stage3', 'done');
  }
  stopHeartbeat();
  closeDisplay();
  return { modes };
}

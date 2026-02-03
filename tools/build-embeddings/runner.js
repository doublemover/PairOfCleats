import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createEmbedder } from '../../src/index/embedding.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../src/index/build/build-state.js';
import { createStageCheckpointRecorder } from '../../src/index/build/stage-checkpoints.js';
import { loadIncrementalManifest } from '../../src/storage/sqlite/incremental.js';
import { dequantizeUint8ToFloat32, resolveQuantizationParams } from '../../src/storage/sqlite/vector.js';
import { loadChunkMeta, readJsonFile, MAX_JSON_BYTES } from '../../src/shared/artifact-io.js';
import { readTextFileWithHash } from '../../src/shared/encoding.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { createCrashLogger } from '../../src/index/build/crash-log.js';
import { resolveHnswPaths, resolveHnswTarget } from '../../src/shared/hnsw.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths, resolveLanceDbTarget } from '../../src/shared/lancedb.js';
import { DEFAULT_STUB_DIMS, resolveStubDims } from '../../src/shared/embedding.js';
import {
  clampQuantizedVectorsInPlace,
  normalizeEmbeddingVectorInPlace
} from '../../src/shared/embedding-utils.js';
import { resolveOnnxModelPath } from '../../src/shared/onnx-embeddings.js';
import { fromPosix, toPosix } from '../../src/shared/files.js';
import { getEnvConfig, isTestingEnv } from '../../src/shared/env.js';
import {
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  getTriageConfig,
  resolveSqlitePaths
} from '../dict-utils.js';
import {
  buildCacheIdentity,
  buildCacheKey,
  isCacheValid,
  readCacheMeta,
  readCacheEntry,
  resolveCacheDir,
  resolveCacheRoot,
  writeCacheEntry,
  writeCacheMeta
} from './cache.js';
import { buildChunkSignature, buildChunksFromBundles } from './chunks.js';
import {
  assertVectorArrays,
  buildQuantizedVectors,
  createDimsValidator,
  ensureVectorArrays,
  fillMissingVectors,
  isDimsMismatch,
  runBatched,
  validateCachedDims
} from './embed.js';
import { createHnswBuilder, writeHnswIndex } from './hnsw.js';
import { writeLanceDbIndex } from './lancedb.js';
import { updatePieceManifest } from './manifest.js';
import { updateSqliteDense } from './sqlite-dense.js';
import { createBuildEmbeddingsContext } from './context.js';
import { loadIndexState, writeIndexState } from './state.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

export async function runBuildEmbeddingsWithConfig(config) {
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
  const {
    display,
    log,
    warn,
    error,
    logger,
    fail,
    finalize,
    setHeartbeat
  } = createBuildEmbeddingsContext({ argv });
  const embeddingNormalize = embeddingsConfig.normalize !== false;
  const isVectorLike = (value) => {
    if (Array.isArray(value)) return true;
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
  };
  const countNonEmptyVectors = (vectors) => {
    if (!Array.isArray(vectors)) return 0;
    let count = 0;
    for (const vec of vectors) {
      if (vec && typeof vec.length === 'number' && vec.length > 0) count += 1;
    }
    return count;
  };
  const lanceConfig = normalizeLanceDbConfig(embeddingsConfig.lancedb || {});
  const normalizeDenseVectorMode = (value) => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (raw === 'code' || raw === 'doc' || raw === 'auto' || raw === 'merged') return raw;
    return 'merged';
  };
  const denseVectorMode = normalizeDenseVectorMode(userConfig?.search?.denseVectorMode);
  const readJsonOptional = (filePath) => {
    if (!filePath || !fsSync.existsSync(filePath)) return null;
    try {
      return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
    } catch {
      return null;
    }
  };

  if (embeddingsConfig.enabled === false || resolvedEmbeddingMode === 'off') {
    error('Embeddings disabled; skipping build-embeddings.');
    finalize();
    return { skipped: true };
  }

  const quantization = resolveQuantizationParams(embeddingsConfig.quantization);
  const quantRange = quantization.maxVal - quantization.minVal;
  const quantLevels = Number.isFinite(quantization.levels) ? quantization.levels : 256;
  const denseScale = quantLevels > 1 && Number.isFinite(quantRange) && quantRange !== 0
    ? quantRange / (quantLevels - 1)
    : 2 / 255;
  const cacheDims = useStubEmbeddings ? resolveStubDims(configuredDims) : configuredDims;
  const resolvedOnnxModelPath = embeddingProvider === 'onnx'
    ? resolveOnnxModelPath({
      rootDir: root,
      modelPath: embeddingOnnx?.modelPath,
      modelsDir,
      modelId
    })
    : null;
  const { identity: cacheIdentity, key: cacheIdentityKey } = buildCacheIdentity({
    modelId,
    provider: embeddingProvider,
    mode: resolvedEmbeddingMode,
    stub: useStubEmbeddings,
    dims: cacheDims,
    scale: denseScale,
    pooling: 'mean',
    normalize: embeddingNormalize,
    truncation: 'truncate',
    maxLength: null,
    quantization: {
      version: 1,
      minVal: quantization.minVal,
      maxVal: quantization.maxVal,
      levels: quantization.levels
    },
    onnx: embeddingProvider === 'onnx' ? {
      ...embeddingOnnx,
      resolvedModelPath: resolvedOnnxModelPath
    } : null
  });

  const embedder = createEmbedder({
    rootDir: root,
    useStubEmbeddings,
    modelId,
    dims: argv.dims,
    modelsDir,
    provider: embeddingProvider,
    onnx: embeddingOnnx,
    normalize: embeddingNormalize
  });
  const getChunkEmbeddings = embedder.getChunkEmbeddings;

  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const metricsDir = getMetricsDir(root, userConfig);
  const envConfig = getEnvConfig();
  const crashLoggingEnabled = isTestingEnv()
    || envConfig.debugCrash === true;
  const crashLogger = await createCrashLogger({
    repoCacheRoot,
    enabled: crashLoggingEnabled,
    log: null
  });
  const triageConfig = getTriageConfig(root, userConfig);
  const recordsDir = triageConfig.recordsDir;
  const buildStatePath = resolveBuildStatePath(indexRoot);
  const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
  setHeartbeat(hasBuildState ? startBuildHeartbeat(indexRoot, 'stage3') : () => {});

  const cacheScopeRaw = embeddingsConfig.cache?.scope;
  const cacheScope = typeof cacheScopeRaw === 'string' ? cacheScopeRaw.trim().toLowerCase() : '';
  const resolvedCacheScope = (cacheScope === 'repo' || cacheScope === 'local') ? 'repo' : 'global';
  const cacheRoot = resolveCacheRoot({
    repoCacheRoot,
    cacheDirConfig: embeddingsConfig.cache?.dir,
    scope: resolvedCacheScope
  });
  const sqlitePaths = resolveSqlitePaths(root, userConfig, { indexRoot });
  const sqliteSharedDb = sqlitePaths?.codePath
    && sqlitePaths?.prosePath
    && path.resolve(sqlitePaths.codePath) === path.resolve(sqlitePaths.prosePath);

  if (hasBuildState) {
    await markBuildPhase(indexRoot, 'stage3', 'running');
  }

  const modeTask = display.task('Embeddings', { total: modes.length, stage: 'embeddings' });
  let completedModes = 0;

  try {
    for (const mode of modes) {
      if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) {
        fail(`Invalid mode: ${mode}`);
      }
      let stageCheckpoints = null;
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
        embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
        embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
        lastError: null,
        updatedAt: stateNow
      };
      try {
        await writeIndexState(statePath, indexState);
      } catch {
        // Ignore index state write failures.
      }

      try {
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

        stageCheckpoints = createStageCheckpointRecorder({
          buildRoot: indexRoot,
          metricsDir,
          mode,
          buildId: indexRoot ? path.basename(indexRoot) : null
        });
        stageCheckpoints.record({
          stage: 'stage3',
          step: 'chunks',
          extra: {
            files: chunksByFile.size,
            totalChunks
          }
        });

        const codeVectors = new Array(totalChunks).fill(null);
        const docVectors = new Array(totalChunks).fill(null);
        const mergedVectors = new Array(totalChunks).fill(null);
        stageCheckpoints.record({
          stage: 'stage3',
          step: 'vectors-allocated',
          extra: {
            vectors: {
              merged: mergedVectors.length,
              doc: docVectors.length,
              code: codeVectors.length
            }
          }
        });
        const hnswPaths = {
          merged: resolveHnswPaths(indexDir, 'merged'),
          doc: resolveHnswPaths(indexDir, 'doc'),
          code: resolveHnswPaths(indexDir, 'code')
        };
        const hnswIsolate = hnswConfig.enabled
          ? (isTestingEnv() || process.platform === 'win32')
          : false;
        const hnswEnabled = hnswConfig.enabled && !hnswIsolate;
        const hnswBuilders = hnswEnabled ? {
          merged: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          }),
          doc: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          }),
          code: createHnswBuilder({
            enabled: hnswConfig.enabled,
            config: hnswConfig,
            totalChunks,
            mode,
            logger
          })
        } : null;
        const addHnswFloatVector = (target, chunkIndex, floatVec) => {
          if (!hnswEnabled || !floatVec || !floatVec.length) return;
          const builder = hnswBuilders?.[target];
          if (!builder) return;
          builder.addVector(chunkIndex, floatVec);
        };
        const addHnswFromQuantized = (target, chunkIndex, quantizedVec) => {
          if (!hnswEnabled || !quantizedVec || !quantizedVec.length) return;
          const floatVec = dequantizeUint8ToFloat32(
            quantizedVec,
            quantization.minVal,
            quantization.maxVal,
            quantization.levels
          );
          if (floatVec && embeddingNormalize) {
            normalizeEmbeddingVectorInPlace(floatVec);
          }
          if (floatVec) addHnswFloatVector(target, chunkIndex, floatVec);
        };
        const hnswResults = {
          merged: null,
          doc: null,
          code: null
        };

        const cacheDir = resolveCacheDir(cacheRoot, cacheIdentity, mode);
        await fs.mkdir(cacheDir, { recursive: true });
        const cacheMeta = readCacheMeta(cacheRoot, cacheIdentity, mode);
        const cacheMetaMatches = cacheMeta?.identityKey === cacheIdentityKey;
        let cacheEligible = true;
        if (cacheMeta?.identityKey && !cacheMetaMatches) {
          warn(`[embeddings] ${mode} cache identity mismatch; ignoring cached vectors.`);
          cacheEligible = false;
        }

        const dimsValidator = createDimsValidator({ mode, configuredDims });
        const assertDims = dimsValidator.assertDims;

        if (configuredDims && cacheEligible) {
          if (cacheMetaMatches && Number.isFinite(Number(cacheMeta?.dims))) {
            const cachedDims = Number(cacheMeta.dims);
            if (cachedDims !== configuredDims) {
              throw new Error(
                `[embeddings] ${mode} cache dims mismatch (configured=${configuredDims}, cached=${cachedDims}).`
              );
            }
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
        const fileEntries = Array.from(chunksByFile.entries())
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        const batchTarget = Number.isFinite(embeddingBatchSize) && embeddingBatchSize > 0
          ? embeddingBatchSize
          : 0;
        const pending = [];
        let pendingChunks = 0;

        const processFileEmbeddings = async (entry, codeEmbeds, docVectorsRaw) => {
          if (!Array.isArray(codeEmbeds) || codeEmbeds.length !== entry.items.length) {
            throw new Error(
              `[embeddings] ${mode} code batch size mismatch (expected ${entry.items.length}, got ${codeEmbeds?.length ?? 0}).`
            );
          }
          if (!Array.isArray(docVectorsRaw) || docVectorsRaw.length !== entry.items.length) {
            throw new Error(
              `[embeddings] ${mode} doc batch size mismatch (expected ${entry.items.length}, got ${docVectorsRaw?.length ?? 0}).`
            );
          }
          const fileCodeEmbeds = ensureVectorArrays(codeEmbeds, entry.items.length);
          for (const vec of fileCodeEmbeds) {
            if (isVectorLike(vec) && vec.length) assertDims(vec.length);
          }
          for (const vec of docVectorsRaw) {
            if (isVectorLike(vec) && vec.length) assertDims(vec.length);
          }

          const dims = dimsValidator.getDims();
          const zeroVec = dims ? new Float32Array(dims) : new Float32Array(0);

          const cachedCodeVectors = [];
          const cachedDocVectors = [];
          const cachedMergedVectors = [];
          for (let i = 0; i < entry.items.length; i += 1) {
            const chunkIndex = entry.items[i].index;
            const embedCode = isVectorLike(fileCodeEmbeds[i]) ? fileCodeEmbeds[i] : [];
            const embedDoc = isVectorLike(docVectorsRaw[i]) ? docVectorsRaw[i] : zeroVec;
            const quantized = buildQuantizedVectors({
              chunkIndex,
              codeVector: embedCode,
              docVector: embedDoc,
              zeroVector: zeroVec,
              addHnswVectors: hnswEnabled ? {
                merged: (id, vec) => addHnswFloatVector('merged', id, vec),
                doc: (id, vec) => addHnswFloatVector('doc', id, vec),
                code: (id, vec) => addHnswFloatVector('code', id, vec)
              } : null,
              quantization,
              normalize: embeddingNormalize
            });
            codeVectors[chunkIndex] = quantized.quantizedCode;
            docVectors[chunkIndex] = quantized.quantizedDoc;
            mergedVectors[chunkIndex] = quantized.quantizedMerged;
            cachedCodeVectors.push(quantized.quantizedCode);
            cachedDocVectors.push(quantized.quantizedDoc);
            cachedMergedVectors.push(quantized.quantizedMerged);
          }

          if (entry.cacheKey && entry.cacheDir) {
            try {
              await writeCacheEntry(entry.cacheDir, entry.cacheKey, {
                key: entry.cacheKey,
                file: entry.normalizedRel,
                hash: entry.fileHash,
                chunkSignature: entry.chunkSignature,
                cacheMeta: {
                  identityKey: cacheIdentityKey,
                  identity: cacheIdentity,
                  createdAt: new Date().toISOString()
                },
                codeVectors: cachedCodeVectors,
                docVectors: cachedDocVectors,
                mergedVectors: cachedMergedVectors
              });
            } catch {
            // Ignore cache write failures.
            }
          }

          processedFiles += 1;
          if (processedFiles % 8 === 0 || processedFiles === chunksByFile.size) {
            fileTask.set(processedFiles, chunksByFile.size, { message: `${processedFiles}/${chunksByFile.size} files` });
            log(`[embeddings] ${mode}: processed ${processedFiles}/${chunksByFile.size} files`);
          }
        };

        const flushPending = async () => {
          if (!pending.length) return;
          const combinedCodeTexts = [];
          const codeRanges = [];
          for (const entry of pending) {
            const start = combinedCodeTexts.length;
            combinedCodeTexts.push(...entry.codeTexts);
            codeRanges.push({ start, count: entry.codeTexts.length });
          }
          const codeEmbeds = await runBatched({
            texts: combinedCodeTexts,
            batchSize: embeddingBatchSize,
            embed: getChunkEmbeddings
          });
          assertVectorArrays(codeEmbeds, combinedCodeTexts.length, `${mode} code`);

          const docPayloads = [];
          const docMappings = [];
          for (let i = 0; i < pending.length; i += 1) {
            const entry = pending[i];
            entry.docVectorsRaw = new Array(entry.items.length).fill(null);
            for (let j = 0; j < entry.docTexts.length; j += 1) {
              if (entry.docTexts[j]) {
                docMappings.push({ entryIndex: i, chunkOffset: j });
                docPayloads.push(entry.docTexts[j]);
              }
            }
          }
          if (docPayloads.length) {
            const docEmbeds = await runBatched({
              texts: docPayloads,
              batchSize: embeddingBatchSize,
              embed: getChunkEmbeddings
            });
            assertVectorArrays(docEmbeds, docPayloads.length, `${mode} doc`);
            for (let i = 0; i < docMappings.length; i += 1) {
              const mapping = docMappings[i];
              pending[mapping.entryIndex].docVectorsRaw[mapping.chunkOffset] = docEmbeds[i] || null;
            }
          }

          for (let i = 0; i < pending.length; i += 1) {
            const entry = pending[i];
            const range = codeRanges[i];
            const fileCodeEmbeds = codeEmbeds.slice(range.start, range.start + range.count);
            await processFileEmbeddings(entry, fileCodeEmbeds, entry.docVectorsRaw || []);
          }

          pending.length = 0;
          pendingChunks = 0;
        };
        for (const [relPath, items] of fileEntries) {
          const normalizedRel = toPosix(relPath);
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
          const cachedResult = cacheEligible && cacheKey
            ? await readCacheEntry(cacheDir, cacheKey)
            : null;
          const cached = cachedResult?.entry;
          if (cached) {
            try {
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
                  if (hnswEnabled) {
                    addHnswFromQuantized('merged', chunkIndex, mergedVec);
                    addHnswFromQuantized('doc', chunkIndex, docVec);
                    addHnswFromQuantized('code', chunkIndex, codeVec);
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

          const absPath = mode === 'records'
            ? path.resolve(
              recordsDir,
              fromPosix(
                normalizedRel.startsWith('triage/records/')
                  ? normalizedRel.slice('triage/records/'.length)
                  : normalizedRel
              )
            )
            : path.resolve(root, fromPosix(normalizedRel));
          let textInfo;
          try {
            textInfo = await readTextFileWithHash(absPath);
          } catch (err) {
            const reason = err?.code ? `${err.code}: ${err.message || err}` : (err?.message || err);
            warn(`[embeddings] ${mode}: Failed to read ${normalizedRel}; skipping (${reason}).`);
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
            const cachedAfterHash = cacheEligible && cacheKey
              ? await readCacheEntry(cacheDir, cacheKey)
              : null;
            const cached = cachedAfterHash?.entry;
            if (cached) {
              try {
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
                    if (hnswEnabled) {
                      addHnswFromQuantized('merged', chunkIndex, mergedVec);
                      addHnswFromQuantized('doc', chunkIndex, docVec);
                      addHnswFromQuantized('code', chunkIndex, codeVec);
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
            const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
            const end = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
            codeTexts.push(text.slice(start, end));
            const docText = typeof chunk.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
            docTexts.push(docText.trim() ? docText : '');
          }
          pending.push({
            normalizedRel,
            items,
            cacheKey,
            cacheDir,
            fileHash,
            chunkSignature,
            codeTexts,
            docTexts
          });
          pendingChunks += items.length;
          if (!batchTarget || pendingChunks >= batchTarget) {
            await flushPending();
          }
        }
        await flushPending();

        stageCheckpoints.record({
          stage: 'stage3',
          step: 'vectors-filled',
          extra: {
            vectors: {
              merged: countNonEmptyVectors(mergedVectors),
              doc: countNonEmptyVectors(docVectors),
              code: countNonEmptyVectors(codeVectors)
            }
          }
        });

        const observedDims = dimsValidator.getDims();
        if (configuredDims && observedDims && configuredDims !== observedDims) {
          throw new Error(
            `[embeddings] ${mode} embedding dims mismatch (configured=${configuredDims}, observed=${observedDims}).`
          );
        }
        const finalDims = observedDims
        || configuredDims
        || (useStubEmbeddings ? resolveStubDims(configuredDims) : DEFAULT_STUB_DIMS);
        fillMissingVectors(codeVectors, finalDims);
        fillMissingVectors(docVectors, finalDims);
        fillMissingVectors(mergedVectors, finalDims);
        clampQuantizedVectorsInPlace(codeVectors);
        clampQuantizedVectorsInPlace(docVectors);
        clampQuantizedVectorsInPlace(mergedVectors);

        const mergedVectorsPath = path.join(indexDir, 'dense_vectors_uint8.json');
        const docVectorsPath = path.join(indexDir, 'dense_vectors_doc_uint8.json');
        const codeVectorsPath = path.join(indexDir, 'dense_vectors_code_uint8.json');
        await writeJsonObjectFile(mergedVectorsPath, {
          fields: {
            model: modelId,
            dims: finalDims,
            scale: denseScale,
            minVal: quantization.minVal,
            maxVal: quantization.maxVal,
            levels: quantization.levels
          },
          arrays: { vectors: mergedVectors },
          atomic: true
        });
        await writeJsonObjectFile(docVectorsPath, {
          fields: {
            model: modelId,
            dims: finalDims,
            scale: denseScale,
            minVal: quantization.minVal,
            maxVal: quantization.maxVal,
            levels: quantization.levels
          },
          arrays: { vectors: docVectors },
          atomic: true
        });
        await writeJsonObjectFile(codeVectorsPath, {
          fields: {
            model: modelId,
            dims: finalDims,
            scale: denseScale,
            minVal: quantization.minVal,
            maxVal: quantization.maxVal,
            levels: quantization.levels
          },
          arrays: { vectors: codeVectors },
          atomic: true
        });

        if (hnswConfig.enabled) {
          const hnswEntries = [
            {
              target: 'merged',
              label: `${mode}/merged`,
              paths: hnswPaths.merged,
              vectors: mergedVectors,
              vectorsPath: mergedVectorsPath
            },
            {
              target: 'doc',
              label: `${mode}/doc`,
              paths: hnswPaths.doc,
              vectors: docVectors,
              vectorsPath: docVectorsPath
            },
            {
              target: 'code',
              label: `${mode}/code`,
              paths: hnswPaths.code,
              vectors: codeVectors,
              vectorsPath: codeVectorsPath
            }
          ];
          for (const entry of hnswEntries) {
            try {
              if (hnswIsolate) {
                hnswResults[entry.target] = await writeHnswIndex({
                  indexPath: entry.paths.indexPath,
                  metaPath: entry.paths.metaPath,
                  modelId,
                  dims: finalDims,
                  quantization,
                  scale: denseScale,
                  vectors: entry.vectors,
                  vectorsPath: entry.vectorsPath,
                  normalize: embeddingNormalize,
                  config: hnswConfig,
                  isolate: true,
                  logger
                });
              } else {
                const builder = hnswBuilders?.[entry.target];
                if (!builder) continue;
                hnswResults[entry.target] = await builder.writeIndex({
                  indexPath: entry.paths.indexPath,
                  metaPath: entry.paths.metaPath,
                  modelId,
                  dims: finalDims,
                  quantization,
                  scale: denseScale
                });
              }
              if (hnswResults[entry.target] && !hnswResults[entry.target].skipped) {
                log(`[embeddings] ${entry.label}: wrote HNSW index (${hnswResults[entry.target].count} vectors).`);
              }
            } catch (err) {
              warn(`[embeddings] ${entry.label}: failed to write HNSW index: ${err?.message || err}`);
            }
          }
        }

        try {
          await writeLanceDbIndex({
            indexDir,
            variant: 'merged',
            vectors: mergedVectors,
            vectorsPath: mergedVectorsPath,
            dims: finalDims,
            modelId,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            config: lanceConfig,
            emitOutput: true,
            label: `${mode}/merged`,
            logger
          });
          await writeLanceDbIndex({
            indexDir,
            variant: 'doc',
            vectors: docVectors,
            vectorsPath: docVectorsPath,
            dims: finalDims,
            modelId,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            config: lanceConfig,
            emitOutput: true,
            label: `${mode}/doc`,
            logger
          });
          await writeLanceDbIndex({
            indexDir,
            variant: 'code',
            vectors: codeVectors,
            vectorsPath: codeVectorsPath,
            dims: finalDims,
            modelId,
            quantization,
            scale: denseScale,
            normalize: embeddingNormalize,
            config: lanceConfig,
            emitOutput: true,
            label: `${mode}/code`,
            logger
          });
        } catch (err) {
          warn(`[embeddings] ${mode}: failed to write LanceDB indexes: ${err?.message || err}`);
        }

        let sqliteVecState = { enabled: false, available: false };
        if (mode === 'code' || mode === 'prose') {
          const sqliteResult = updateSqliteDense({
            Database,
            root,
            userConfig,
            indexRoot,
            mode,
            vectors: mergedVectors,
            dims: finalDims,
            scale: denseScale,
            modelId,
            quantization,
            sharedDb: sqliteSharedDb,
            emitOutput: true,
            warnOnMissing: false,
            logger
          });
          const vectorAnn = sqliteResult?.vectorAnn || null;
          sqliteVecState = {
            enabled: vectorAnn?.enabled === true,
            available: vectorAnn?.available === true
          };
          if (sqliteVecState.available) {
            sqliteVecState.dims = finalDims;
            sqliteVecState.count = totalChunks;
          }
          const sqliteMetaPath = path.join(indexDir, 'dense_vectors_sqlite_vec.meta.json');
          if (vectorAnn?.available && vectorAnn?.table) {
            const sqliteMeta = {
              version: 1,
              generatedAt: new Date().toISOString(),
              model: modelId || null,
              dims: finalDims,
              count: totalChunks,
              table: vectorAnn.table,
              embeddingColumn: vectorAnn.column || null,
              idColumn: vectorAnn.idColumn || 'rowid',
              scale: denseScale,
              minVal: quantization.minVal,
              maxVal: quantization.maxVal,
              levels: quantization.levels
            };
            try {
              await writeJsonObjectFile(sqliteMetaPath, { fields: sqliteMeta, atomic: true });
            } catch {
            // Ignore sqlite vec meta write failures.
            }
          } else {
            try {
              await fs.rm(sqliteMetaPath, { force: true });
            } catch {}
          }
        }

        const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
        const hnswTargetPaths = resolveHnswPaths(indexDir, hnswTarget);
        const hnswMeta = readJsonOptional(hnswTargetPaths.metaPath);
        const hnswIndexExists = fsSync.existsSync(hnswTargetPaths.indexPath)
        || fsSync.existsSync(`${hnswTargetPaths.indexPath}.bak`);
        const hnswAvailable = Boolean(hnswMeta) && hnswIndexExists;
        const hnswState = {
          enabled: hnswConfig.enabled !== false,
          available: hnswAvailable,
          target: hnswTarget
        };
        if (hnswMeta) {
          hnswState.dims = Number.isFinite(Number(hnswMeta.dims)) ? Number(hnswMeta.dims) : finalDims;
          hnswState.count = Number.isFinite(Number(hnswMeta.count)) ? Number(hnswMeta.count) : totalChunks;
        }

        const lancePaths = resolveLanceDbPaths(indexDir);
        const lanceTarget = resolveLanceDbTarget(mode, denseVectorMode);
        const targetPaths = lancePaths?.[lanceTarget] || lancePaths?.merged || {};
        const lanceMeta = readJsonOptional(targetPaths.metaPath);
        const lanceAvailable = Boolean(lanceMeta)
        && Boolean(targetPaths.dir)
        && fsSync.existsSync(targetPaths.dir);
        const lancedbState = {
          enabled: lanceConfig.enabled !== false,
          available: lanceAvailable,
          target: lanceTarget
        };
        if (lanceMeta) {
          lancedbState.dims = Number.isFinite(Number(lanceMeta.dims)) ? Number(lanceMeta.dims) : finalDims;
          lancedbState.count = Number.isFinite(Number(lanceMeta.count)) ? Number(lanceMeta.count) : totalChunks;
        }

        stageCheckpoints.record({
          stage: 'stage3',
          step: 'write',
          extra: {
            vectors: {
              merged: countNonEmptyVectors(mergedVectors),
              doc: countNonEmptyVectors(docVectors),
              code: countNonEmptyVectors(codeVectors)
            },
            hnsw: hnswState.available ? (hnswState.count || 0) : 0,
            lancedb: lancedbState.available ? (lancedbState.count || 0) : 0,
            sqliteVec: sqliteVecState.available ? (sqliteVecState.count || 0) : 0
          }
        });

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
          embeddingIdentity: cacheIdentity || indexState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || indexState.embeddings?.embeddingIdentityKey || null,
          lastError: null,
          backends: {
            ...(indexState.embeddings?.backends || {}),
            hnsw: hnswState,
            lancedb: lancedbState,
            sqliteVec: sqliteVecState
          },
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

        const validation = await validateIndexArtifacts({
          root,
          indexRoot,
          modes: [mode],
          userConfig,
          sqliteEnabled: false
        });
        if (!validation.ok) {
          if (validation.issues?.length) {
            error('Index validation issues (first 10):');
            validation.issues.slice(0, 10).forEach((issue) => {
              error(`- ${issue}`);
            });
          }
          if (validation.warnings?.length) {
            warn('Index validation warnings (first 10):');
            validation.warnings.slice(0, 10).forEach((warning) => {
              warn(`- ${warning}`);
            });
          }
          crashLogger.logError({
            phase: `embeddings:${mode}`,
            stage: 'validation',
            message: `[embeddings] ${mode} index validation failed`,
            issues: validation.issues || [],
            warnings: validation.warnings || [],
            hints: validation.hints || []
          });
          throw new Error(`[embeddings] ${mode} index validation failed; see index-validate output for details.`);
        }

        const cacheMetaNow = new Date().toISOString();
        const cacheMetaPayload = {
          version: 1,
          identityKey: cacheIdentityKey,
          identity: cacheIdentity,
          dims: finalDims,
          mode,
          provider: embeddingProvider,
          modelId: modelId || null,
          normalize: embeddingNormalize,
          createdAt: cacheMetaMatches ? (cacheMeta?.createdAt || cacheMetaNow) : cacheMetaNow,
          updatedAt: cacheMetaNow
        };
        try {
          await writeCacheMeta(cacheRoot, cacheIdentity, mode, cacheMetaPayload);
        } catch {
        // Ignore cache meta write failures.
        }

        log(`[embeddings] ${mode}: wrote ${totalChunks} vectors (dims=${finalDims}).`);
        finishMode(`built ${mode}`);
      } catch (err) {
        const now = new Date().toISOString();
        const failureState = loadIndexState(statePath);
        failureState.generatedAt = failureState.generatedAt || now;
        failureState.updatedAt = now;
        failureState.mode = failureState.mode || mode;
        failureState.embeddings = {
          ...(failureState.embeddings || {}),
          enabled: true,
          ready: false,
          pending: false,
          mode: failureState.embeddings?.mode || resolvedEmbeddingMode,
          service: failureState.embeddings?.service ?? (normalizedEmbeddingMode === 'service'),
          embeddingIdentity: cacheIdentity || failureState.embeddings?.embeddingIdentity || null,
          embeddingIdentityKey: cacheIdentityKey || failureState.embeddings?.embeddingIdentityKey || null,
          lastError: err?.message || String(err),
          updatedAt: now
        };
        if (failureState.enrichment && failureState.enrichment.enabled) {
          failureState.enrichment = {
            ...failureState.enrichment,
            pending: false,
            stage: failureState.enrichment.stage || failureState.stage || 'stage2'
          };
        }
        try {
          await writeIndexState(statePath, failureState);
        } catch {
          // Ignore index state write failures.
        }
        throw err;
      } finally {
        if (stageCheckpoints) {
          await stageCheckpoints.flush();
        }
      }
    }

    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage3', 'done');
    }
    return { modes };
  } finally {
    finalize();
  }
}

import { loadChunkMetaRows, loadFileMetaRows } from '../../../../src/shared/artifact-io.js';
import { toPosix } from '../../../../src/shared/files.js';
import { buildChunksFromBundles } from '../chunks.js';
import {
  createDeterministicFileStreamSampler,
  selectDeterministicFileSample
} from '../sampling.js';
import { compactChunkForEmbeddings } from './incremental-refresh.js';

/**
 * Normalize one chunk index to stage3 sort semantics.
 *
 * @param {{index?:unknown}|null|undefined} entry
 * @returns {number}
 */
const normalizeChunkIndex = (entry) => {
  const parsed = Number(entry?.index ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Count total chunk payloads represented by `[file, chunkList]` tuples.
 *
 * @param {Array<[string, Array<any>]>} fileEntries
 * @returns {number}
 */
export const countChunksInFileEntries = (fileEntries) => {
  let total = 0;
  for (const entry of fileEntries) {
    const list = Array.isArray(entry?.[1]) ? entry[1] : null;
    if (list) total += list.length;
  }
  return total;
};

/**
 * Sort per-file chunk lists only when out-of-order indexes are detected.
 *
 * Most chunk-meta streams already emit file-local rows in ascending order.
 * Avoiding unconditional sort passes reduces stage3 CPU in large repositories
 * while preserving deterministic ordering guarantees.
 *
 * @param {Map<string, Array<{index?:number,chunk?:object}>>} chunksByFile
 * @returns {number} Number of file lists that required sorting.
 */
export const sortChunkListsByIndexWhenNeeded = (chunksByFile) => {
  let sortedFileCount = 0;
  for (const list of chunksByFile.values()) {
    if (!Array.isArray(list) || list.length < 2) continue;
    let previous = normalizeChunkIndex(list[0]);
    let outOfOrder = false;
    for (let i = 1; i < list.length; i += 1) {
      const current = normalizeChunkIndex(list[i]);
      if (current < previous) {
        outOfOrder = true;
        break;
      }
      previous = current;
    }
    if (!outOfOrder) continue;
    list.sort((a, b) => normalizeChunkIndex(a) - normalizeChunkIndex(b));
    sortedFileCount += 1;
  }
  return sortedFileCount;
};

/**
 * Check whether incremental manifest includes any file entries.
 *
 * @param {Record<string, any>} manifestFiles
 * @returns {boolean}
 */
const hasManifestFiles = (manifestFiles) => {
  if (!manifestFiles || typeof manifestFiles !== 'object') return false;
  for (const key in manifestFiles) {
    if (!Object.hasOwn(manifestFiles, key)) continue;
    return true;
  }
  return false;
};

/**
 * Prepare per-mode stage3 chunk workset from artifacts or incremental bundles.
 *
 * Sequencing contract:
 * 1. Stream `chunk_meta` first so we avoid bundle scans when artifacts exist.
 * 2. Apply stream-file sampling before chunk compaction so evictions release
 *    whole-file payloads early in the hot path.
 * 3. Preserve deterministic file/chunk ordering for downstream cache and vector
 *    wiring while skipping unnecessary sort work for already ordered streams.
 *
 * @param {{
 *   mode:string,
 *   indexDir:string,
 *   incremental:{manifest?:object,bundleDir?:string}|null|undefined,
 *   chunkMetaMaxBytes:number,
 *   embeddingSampling:{maxFiles:number,seed:string},
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   log:(line:string)=>void,
 *   warn:(line:string)=>void,
 *   isChunkMetaTooLargeError:(err:any)=>boolean,
 *   isMissingArtifactError:(err:any, artifactBaseName:string)=>boolean,
 *   loadChunkMetaRowsImpl?:(...args:any[])=>AsyncIterable<any>,
 *   loadFileMetaRowsImpl?:(...args:any[])=>AsyncIterable<any>,
 *   toPosixImpl?:(value:string)=>string,
 *   compactChunkForEmbeddingsImpl?:(chunk:object,filePath:string)=>object|null,
 *   createDeterministicFileStreamSamplerImpl?:(input:object)=>{
 *     considerFile:(file:string)=>{selected:boolean,evicted:string|null|undefined},
 *     getSeenCount:()=>number,
 *     getSelectedCount:()=>number
 *   },
 *   selectDeterministicFileSampleImpl?:(input:object)=>Array<[string, Array<any>]>,
 *   buildChunksFromBundlesImpl?:(...args:any[])=>Promise<{chunksByFile:Map<string, Array<any>>,totalChunks:number}>
 * }} input
 * @returns {Promise<{
 *   skipped:boolean,
 *   chunksByFile:Map<string, Array<{index:number,chunk:object}>>|null,
 *   sampledChunksByFile:Map<string, Array<{index:number,chunk:object}>>|null,
 *   sampledFileEntries:Array<[string, Array<{index:number,chunk:object}>]>,
 *   totalFileCount:number,
 *   totalChunks:number,
 *   sampledChunkCount:number
 * }>}
 */
export const loadModeChunkWorkset = async ({
  mode,
  indexDir,
  incremental,
  chunkMetaMaxBytes,
  embeddingSampling,
  scheduleIo,
  log,
  warn,
  isChunkMetaTooLargeError,
  isMissingArtifactError,
  loadChunkMetaRowsImpl = loadChunkMetaRows,
  loadFileMetaRowsImpl = loadFileMetaRows,
  toPosixImpl = toPosix,
  compactChunkForEmbeddingsImpl = compactChunkForEmbeddings,
  createDeterministicFileStreamSamplerImpl = createDeterministicFileStreamSampler,
  selectDeterministicFileSampleImpl = selectDeterministicFileSample,
  buildChunksFromBundlesImpl = buildChunksFromBundles
}) => {
  const manifestFiles = incremental?.manifest?.files || {};
  let chunksByFile = new Map();
  let totalChunks = 0;
  let streamSamplingSummary = null;
  let streamSampledChunkCount = 0;
  let loadedChunkMetaFromArtifacts = false;

  try {
    await scheduleIo(async () => {
      const fileMetaById = new Map();
      const streamSampler = embeddingSampling.maxFiles
        ? createDeterministicFileStreamSamplerImpl({
          mode,
          maxFiles: embeddingSampling.maxFiles,
          seed: embeddingSampling.seed
        })
        : null;
      const sampledChunkCountsByFile = streamSampler ? new Map() : null;
      let fileMetaLoaded = false;
      let fileMetaLoadFailed = false;
      /**
       * Lazily load file id -> file path mapping for chunk rows that only
       * include `fileId`.
       *
       * @returns {Promise<void>}
       */
      const ensureFileMetaById = async () => {
        if (fileMetaLoaded || fileMetaLoadFailed) return;
        try {
          for await (const row of loadFileMetaRowsImpl(indexDir, {
            maxBytes: chunkMetaMaxBytes,
            strict: false
          })) {
            if (!row || !Number.isFinite(Number(row.id)) || typeof row.file !== 'string') continue;
            fileMetaById.set(Number(row.id), row.file);
          }
          fileMetaLoaded = true;
        } catch (err) {
          fileMetaLoadFailed = true;
          if (!isMissingArtifactError(err, 'file_meta')) {
            warn(`[embeddings] Failed to stream file_meta for ${mode}: ${err?.message || err}`);
          }
        }
      };
      let unresolvedFileRows = 0;
      let nextIndex = 0;
      for await (const chunkRow of loadChunkMetaRowsImpl(indexDir, {
        maxBytes: chunkMetaMaxBytes,
        strict: false,
        includeCold: false
      })) {
        const chunkIndex = nextIndex;
        nextIndex += 1;
        if (!chunkRow || typeof chunkRow !== 'object') continue;
        const fileId = Number(chunkRow.fileId);
        let filePath = typeof chunkRow.file === 'string' && chunkRow.file
          ? chunkRow.file
          : null;
        if (!filePath && Number.isFinite(fileId)) {
          if (!fileMetaLoaded && !fileMetaLoadFailed) {
            await ensureFileMetaById();
          }
          filePath = fileMetaById.get(fileId) || null;
        }
        if (!filePath) {
          unresolvedFileRows += 1;
          continue;
        }
        const normalizedFilePath = toPosixImpl(filePath);
        if (!normalizedFilePath) {
          unresolvedFileRows += 1;
          continue;
        }
        if (streamSampler) {
          const decision = streamSampler.considerFile(normalizedFilePath);
          if (decision.evicted) {
            chunksByFile.delete(decision.evicted);
            if (sampledChunkCountsByFile) {
              const evictedCount = sampledChunkCountsByFile.get(decision.evicted) || 0;
              streamSampledChunkCount = Math.max(0, streamSampledChunkCount - evictedCount);
              sampledChunkCountsByFile.delete(decision.evicted);
            }
          }
          if (!decision.selected) {
            continue;
          }
        }
        const compactChunk = compactChunkForEmbeddingsImpl(chunkRow, filePath);
        if (!compactChunk) {
          unresolvedFileRows += 1;
          continue;
        }
        let list = chunksByFile.get(normalizedFilePath);
        if (!list) {
          list = [];
          chunksByFile.set(normalizedFilePath, list);
        }
        list.push({ index: chunkIndex, chunk: compactChunk });
        if (sampledChunkCountsByFile) {
          const nextChunkCount = (sampledChunkCountsByFile.get(normalizedFilePath) || 0) + 1;
          sampledChunkCountsByFile.set(normalizedFilePath, nextChunkCount);
          streamSampledChunkCount += 1;
        }
      }
      if (unresolvedFileRows > 0) {
        warn(
          `[embeddings] ${mode}: skipped ${unresolvedFileRows} chunk_meta rows with unresolved file mapping.`
        );
      }
      if (streamSampler) {
        streamSamplingSummary = {
          seenFiles: streamSampler.getSeenCount(),
          selectedFiles: streamSampler.getSelectedCount()
        };
      }
      totalChunks = nextIndex;
    });
    loadedChunkMetaFromArtifacts = true;
  } catch (err) {
    if (isChunkMetaTooLargeError(err)) {
      warn(
        `[embeddings] chunk_meta exceeded budget for ${mode} ` +
        `(${chunkMetaMaxBytes} bytes); using incremental bundles if available.`
      );
    } else if (!isMissingArtifactError(err, 'chunk_meta')) {
      warn(`[embeddings] Failed to load chunk_meta for ${mode}: ${err?.message || err}`);
    }
    loadedChunkMetaFromArtifacts = false;
  }

  if (!loadedChunkMetaFromArtifacts) {
    if (!hasManifestFiles(manifestFiles)) {
      warn(`[embeddings] Missing chunk_meta and no incremental bundles for ${mode}; skipping.`);
      return {
        skipped: true,
        chunksByFile: null,
        sampledChunksByFile: null,
        sampledFileEntries: [],
        totalFileCount: 0,
        totalChunks: 0,
        sampledChunkCount: 0
      };
    }
    const bundleResult = await scheduleIo(() => buildChunksFromBundlesImpl(
      incremental.bundleDir,
      manifestFiles,
      incremental?.manifest?.bundleFormat
    ));
    chunksByFile = bundleResult.chunksByFile;
    totalChunks = bundleResult.totalChunks;
    if (!chunksByFile.size || !totalChunks) {
      warn(`[embeddings] Incremental bundles empty for ${mode}; skipping.`);
      return {
        skipped: true,
        chunksByFile: null,
        sampledChunksByFile: null,
        sampledFileEntries: [],
        totalFileCount: 0,
        totalChunks: 0,
        sampledChunkCount: 0
      };
    }
    log(`[embeddings] ${mode}: using incremental bundles (${chunksByFile.size} files).`);
  }

  sortChunkListsByIndexWhenNeeded(chunksByFile);
  const fileEntries = Array.from(chunksByFile.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  let sampledFileEntries = fileEntries;
  let totalFileCount = fileEntries.length;
  let sampledChunkCount = totalChunks;
  if (streamSamplingSummary && embeddingSampling.maxFiles) {
    totalFileCount = Math.max(fileEntries.length, streamSamplingSummary.seenFiles || 0);
    sampledChunkCount = streamSampledChunkCount;
    if (totalFileCount > sampledFileEntries.length) {
      log(
        `[embeddings] ${mode}: sampling ${sampledFileEntries.length}/${totalFileCount} files ` +
        `(${sampledChunkCount}/${totalChunks} chunks, seed=${embeddingSampling.seed}).`
      );
    }
  } else if (embeddingSampling.maxFiles && embeddingSampling.maxFiles < fileEntries.length) {
    sampledFileEntries = selectDeterministicFileSampleImpl({
      fileEntries,
      mode,
      maxFiles: embeddingSampling.maxFiles,
      seed: embeddingSampling.seed
    });
    sampledChunkCount = countChunksInFileEntries(sampledFileEntries);
    log(
      `[embeddings] ${mode}: sampling ${sampledFileEntries.length}/${totalFileCount} files ` +
      `(${sampledChunkCount}/${totalChunks} chunks, seed=${embeddingSampling.seed}).`
    );
  }

  return {
    skipped: false,
    chunksByFile,
    sampledChunksByFile: sampledFileEntries === fileEntries
      ? chunksByFile
      : new Map(sampledFileEntries),
    sampledFileEntries,
    totalFileCount,
    totalChunks,
    sampledChunkCount
  };
};

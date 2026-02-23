import path from 'node:path';
import { writeIncrementalManifest } from '../../../../src/storage/sqlite/incremental.js';
import { toPosix } from '../../../../src/shared/files.js';
import { runWithConcurrency } from '../../../../src/shared/concurrency.js';
import { coercePositiveIntMinOne } from '../../../../src/shared/number-coerce.js';
import {
  normalizeBundleFormat,
  readBundleFile,
  resolveBundleFilename,
  resolveBundleFormatFromName,
  writeBundleFile
} from '../../../../src/shared/bundle-io.js';
import {
  normalizeExtractedProseLowYieldBailoutConfig,
  selectDeterministicWarmupSample
} from '../../../../src/index/chunking/formats/document-common.js';
import {
  createIncrementalChunkMappingIndex,
  createMappingFailureReasons,
  formatMappingFailureReasons,
  hasVectorPayload,
  recordMappingFailureReason,
  resolveBundleChunkVectorIndex,
  resolveChunkFileMapping,
  toChunkIndex,
  toUint8Vector,
  vectorsEqual
} from './mapping.js';

/**
 * @typedef {object} RefreshIncrementalBundlesResult
 * @property {number} attempted
 * @property {number} eligible
 * @property {number} rewritten
 * @property {number} covered
 * @property {number} scanned
 * @property {number} skippedNoMapping
 * @property {number} skippedNoMappingChunks
 * @property {{boundaryMismatch:number,missingParent:number,parserOmission:number}} mappingFailureReasons
 * @property {number} skippedInvalidBundle
 * @property {number} skippedEmptyBundle
 * @property {number} lowYieldBailoutSkipped
 * @property {object|null} lowYieldBailout
 * @property {boolean} manifestWritten
 * @property {boolean} completeCoverage
 */

/**
 * Strip non-essential `metaV2` fields before writing incremental bundles with
 * refreshed embedding vectors.
 *
 * @param {object|null} metaV2
 * @returns {object|null}
 */
const compactChunkMetaV2ForEmbeddings = (metaV2) => {
  if (!metaV2 || typeof metaV2 !== 'object') return null;
  const out = {};
  if (typeof metaV2.chunkId === 'string' && metaV2.chunkId) out.chunkId = metaV2.chunkId;
  if (typeof metaV2.file === 'string' && metaV2.file) out.file = metaV2.file;
  if (typeof metaV2.kind === 'string' && metaV2.kind) out.kind = metaV2.kind;
  if (typeof metaV2.name === 'string' && metaV2.name) out.name = metaV2.name;
  if (typeof metaV2.doc === 'string' && metaV2.doc) out.doc = metaV2.doc;
  const segment = metaV2.segment && typeof metaV2.segment === 'object'
    ? metaV2.segment
    : null;
  if (segment) {
    const compactSegment = {};
    if (typeof segment.anchor === 'string' && segment.anchor) {
      compactSegment.anchor = segment.anchor;
    }
    if (typeof segment.segmentUid === 'string' && segment.segmentUid) {
      compactSegment.segmentUid = segment.segmentUid;
    }
    if (Object.keys(compactSegment).length) {
      out.segment = compactSegment;
    }
  }
  return Object.keys(out).length ? out : null;
};

/**
 * Build a minimal chunk payload suitable for embedding artifact persistence.
 *
 * @param {object|null} chunk
 * @param {string|null} filePath
 * @returns {object|null}
 */
export const compactChunkForEmbeddings = (chunk, filePath) => {
  if (!chunk || typeof chunk !== 'object') return null;
  const start = Number.isFinite(Number(chunk.start)) ? Number(chunk.start) : 0;
  const endRaw = Number.isFinite(Number(chunk.end)) ? Number(chunk.end) : start;
  const end = endRaw >= start ? endRaw : start;
  const out = {
    start,
    end
  };
  const chunkId = toChunkIndex(chunk.id);
  if (chunkId != null) out.id = chunkId;
  if (typeof filePath === 'string' && filePath) {
    out.file = filePath;
  } else if (typeof chunk.file === 'string' && chunk.file) {
    out.file = chunk.file;
  }
  if (typeof chunk.kind === 'string' && chunk.kind) out.kind = chunk.kind;
  if (typeof chunk.name === 'string' && chunk.name) out.name = chunk.name;
  if (typeof chunk.chunkId === 'string' && chunk.chunkId) out.chunkId = chunk.chunkId;
  const docText = typeof chunk?.docmeta?.doc === 'string' ? chunk.docmeta.doc : '';
  if (docText) {
    out.docmeta = { doc: docText };
  }
  const segment = chunk.segment && typeof chunk.segment === 'object' ? chunk.segment : null;
  if (segment) {
    const compactSegment = {};
    if (typeof segment.anchor === 'string' && segment.anchor) {
      compactSegment.anchor = segment.anchor;
    }
    if (typeof segment.segmentUid === 'string' && segment.segmentUid) {
      compactSegment.segmentUid = segment.segmentUid;
    }
    if (Object.keys(compactSegment).length) {
      out.segment = compactSegment;
    }
  }
  const compactMetaV2 = compactChunkMetaV2ForEmbeddings(chunk.metaV2);
  if (compactMetaV2) {
    out.metaV2 = compactMetaV2;
  }
  return out;
};

/**
 * Rewrite incremental bundle files with updated `embedding_u8` vectors produced
 * during stage 3, and stamp manifest metadata when coverage is complete.
 *
 * @param {{
 *   mode:string,
 *   incremental:{manifest?:object,bundleDir?:string,manifestPath?:string},
 *   chunksByFile:Map<string,Array<{index?:number,chunk?:object}>>,
 *   mergedVectors:Array<Uint8Array|number[]|ArrayBufferView|null>,
 *   embeddingMode:string,
 *   embeddingIdentityKey:string|null,
 *   lowYieldBailout:object,
 *   parallelism?:number,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   log:(line:string)=>void,
 *   warn:(line:string)=>void
 * }} input
 * @returns {Promise<RefreshIncrementalBundlesResult|{attempted:number,rewritten:number,manifestWritten:boolean,completeCoverage:boolean}>}
 */
export const refreshIncrementalBundlesWithEmbeddings = async ({
  mode,
  incremental,
  chunksByFile,
  mergedVectors,
  embeddingMode,
  embeddingIdentityKey,
  lowYieldBailout,
  parallelism = 1,
  scheduleIo,
  log,
  warn
}) => {
  if (!incremental?.manifest || !incremental?.bundleDir || !incremental?.manifestPath) {
    return { attempted: 0, rewritten: 0, manifestWritten: false, completeCoverage: false };
  }
  const manifest = incremental.manifest;
  const manifestFiles = manifest.files && typeof manifest.files === 'object'
    ? manifest.files
    : {};
  const manifestEntries = Object.entries(manifestFiles)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  if (!manifestEntries.length) {
    return { attempted: 0, rewritten: 0, manifestWritten: false, completeCoverage: false };
  }

  const mappingIndex = createIncrementalChunkMappingIndex(chunksByFile);

  const resolvedBundleFormat = normalizeBundleFormat(manifest.bundleFormat);
  const scanned = manifestEntries.length;
  const lowYieldConfig = normalizeExtractedProseLowYieldBailoutConfig(lowYieldBailout);
  const lowYieldEnabled = mode === 'extracted-prose' && lowYieldConfig.enabled !== false;
  const warmupWindowSize = lowYieldEnabled
    ? Math.max(1, Math.min(scanned, Math.floor(lowYieldConfig.warmupWindowSize)))
    : 0;
  const warmupWindowEntries = lowYieldEnabled
    ? manifestEntries.slice(0, warmupWindowSize)
    : [];
  const warmupSampleSize = lowYieldEnabled
    ? Math.max(0, Math.min(warmupWindowEntries.length, Math.floor(lowYieldConfig.warmupSampleSize)))
    : 0;
  const sampledWarmupEntries = lowYieldEnabled
    ? selectDeterministicWarmupSample({
      values: warmupWindowEntries,
      sampleSize: warmupSampleSize,
      seed: lowYieldConfig.seed,
      resolveKey: (entry) => entry?.[0] || ''
    })
    : [];
  const sampledWarmupFiles = new Set(sampledWarmupEntries.map((entry) => toPosix(entry?.[0])));
  const observedWarmupFiles = new Set();
  let warmupObserved = 0;
  let warmupMapped = 0;
  let lowYieldDecisionMade = false;
  let lowYieldBailoutTriggered = false;
  let lowYieldBailoutSkipped = 0;
  let lowYieldBailoutSummary = null;
  let processedEntries = 0;
  let eligible = 0;
  let rewritten = 0;
  let covered = 0;
  let skippedNoMapping = 0;
  let skippedNoMappingChunks = 0;
  const mappingFailureReasons = createMappingFailureReasons();
  let skippedInvalidBundle = 0;
  let skippedEmptyBundle = 0;

  const refreshParallelism = coercePositiveIntMinOne(parallelism) || 1;

  /**
   * Record warmup mapping yield for deterministic low-yield bailout sampling.
   *
   * @param {{normalizedFile:string,chunkMapping:any}} input
   * @returns {void}
   */
  const observeWarmupMapping = ({ normalizedFile, chunkMapping }) => {
    if (!lowYieldEnabled || lowYieldDecisionMade || warmupSampleSize <= 0) return;
    if (!sampledWarmupFiles.has(normalizedFile) || observedWarmupFiles.has(normalizedFile)) return;
    observedWarmupFiles.add(normalizedFile);
    warmupObserved += 1;
    if (chunkMapping) warmupMapped += 1;
    if (warmupObserved < warmupSampleSize) return;
    lowYieldDecisionMade = true;
    const observedYieldRatio = warmupObserved > 0 ? warmupMapped / warmupObserved : 0;
    const minYieldedFiles = Math.min(
      Math.max(1, Math.floor(Number(lowYieldConfig.minYieldedFiles) || 1)),
      Math.max(1, warmupObserved)
    );
    lowYieldBailoutTriggered = observedYieldRatio < lowYieldConfig.minYieldRatio
      && warmupMapped < minYieldedFiles;
    lowYieldBailoutSummary = {
      enabled: lowYieldEnabled,
      triggered: lowYieldBailoutTriggered,
      seed: lowYieldConfig.seed,
      warmupWindowSize,
      warmupSampleSize,
      sampledFiles: warmupObserved,
      sampledMappedFiles: warmupMapped,
      observedYieldRatio,
      minYieldRatio: lowYieldConfig.minYieldRatio,
      minYieldedFiles
    };
  };

  /**
   * Refresh one manifest bundle entry against stage-3 vectors.
   *
   * @param {[string, any]} manifestEntry
   * @param {{trackWarmup?:boolean}} [input]
   * @returns {Promise<void>}
   */
  const processManifestEntry = async (manifestEntry, { trackWarmup = false } = {}) => {
    const [filePath, entry] = manifestEntry;
    processedEntries += 1;
    const normalizedFile = toPosix(filePath).trim();
    const chunkMapping = resolveChunkFileMapping(mappingIndex, normalizedFile);
    if (trackWarmup) observeWarmupMapping({ normalizedFile, chunkMapping });
    const bundleName = entry?.bundle || resolveBundleFilename(filePath, resolvedBundleFormat);
    const bundlePath = path.join(incremental.bundleDir, bundleName);
    const bundleFormat = resolveBundleFormatFromName(bundleName, resolvedBundleFormat);
    let existing = null;
    try {
      existing = await scheduleIo(() => readBundleFile(bundlePath, { format: bundleFormat }));
    } catch {
      existing = null;
    }
    if (!existing?.ok || !Array.isArray(existing.bundle?.chunks)) {
      skippedInvalidBundle += 1;
      return;
    }

    const bundle = existing.bundle;
    if (!bundle.chunks.length) {
      skippedEmptyBundle += 1;
      return;
    }
    eligible += 1;
    const fallbackState = { cursor: 0 };
    let changed = false;
    let fileCovered = true;
    let fileNoMappingCounted = false;

    for (const chunk of bundle.chunks) {
      if (!chunk || typeof chunk !== 'object') continue;
      const mappingResult = resolveBundleChunkVectorIndex({
        chunk,
        normalizedFile,
        fileMapping: chunkMapping,
        mappingIndex,
        fallbackState
      });
      const vectorIndex = mappingResult.vectorIndex;
      const vector = vectorIndex != null ? mergedVectors[vectorIndex] : null;
      if (hasVectorPayload(vector)) {
        const quantized = toUint8Vector(vector);
        if (quantized && !vectorsEqual(chunk.embedding_u8, quantized)) {
          chunk.embedding_u8 = quantized;
          changed = true;
        }
      }
      if (chunk.embedding !== undefined) {
        delete chunk.embedding;
        changed = true;
      }
      if (!hasVectorPayload(chunk.embedding_u8)) {
        fileCovered = false;
        if (vectorIndex == null) {
          skippedNoMappingChunks += 1;
          recordMappingFailureReason(mappingFailureReasons, mappingResult.reason);
          if (!fileNoMappingCounted) {
            skippedNoMapping += 1;
            fileNoMappingCounted = true;
          }
        }
      }
    }

    if (!changed) {
      if (fileCovered) covered += 1;
      return;
    }
    try {
      await scheduleIo(() => writeBundleFile({
        bundlePath,
        bundle,
        format: bundleFormat
      }));
      rewritten += 1;
      if (fileCovered) covered += 1;
    } catch (err) {
      warn(`[embeddings] ${mode}: failed to refresh bundle ${filePath}: ${err?.message || err}`);
    }
  };

  let nextEntryIndex = 0;
  if (lowYieldEnabled && warmupSampleSize > 0) {
    for (; nextEntryIndex < manifestEntries.length; nextEntryIndex += 1) {
      await processManifestEntry(manifestEntries[nextEntryIndex], { trackWarmup: true });
      if (lowYieldBailoutTriggered || lowYieldDecisionMade) {
        nextEntryIndex += 1;
        break;
      }
    }
  }

  const remainingEntries = lowYieldEnabled && warmupSampleSize > 0
    ? manifestEntries.slice(nextEntryIndex)
    : manifestEntries;
  if (!lowYieldBailoutTriggered && remainingEntries.length) {
    if (refreshParallelism > 1 && remainingEntries.length > 1) {
      await runWithConcurrency(
        remainingEntries,
        refreshParallelism,
        async (manifestEntry) => processManifestEntry(manifestEntry),
        { collectResults: false }
      );
    } else {
      for (const manifestEntry of remainingEntries) {
        await processManifestEntry(manifestEntry);
      }
    }
  }

  if (lowYieldBailoutTriggered) {
    lowYieldBailoutSkipped = Math.max(0, scanned - processedEntries);
  }

  const completeCoverage = eligible > 0
    ? covered === eligible
    : skippedInvalidBundle === 0;
  let manifestWritten = false;
  if (completeCoverage) {
    manifest.bundleEmbeddings = true;
    manifest.bundleEmbeddingMode = embeddingMode || manifest.bundleEmbeddingMode || null;
    manifest.bundleEmbeddingIdentityKey = embeddingIdentityKey || manifest.bundleEmbeddingIdentityKey || null;
    manifest.bundleEmbeddingStage = 'stage3';
    manifestWritten = await scheduleIo(
      () => writeIncrementalManifest(incremental.manifestPath, manifest)
    );
    if (!manifestWritten) {
      warn(`[embeddings] ${mode}: failed to persist incremental manifest embedding metadata.`);
    }
  }

  if (scanned > 0) {
    const skippedNotes = [];
    if (skippedNoMapping > 0) skippedNotes.push(`noMapping=${skippedNoMapping}`);
    if (skippedNoMappingChunks > 0) skippedNotes.push(`noMappingChunks=${skippedNoMappingChunks}`);
    if (skippedNoMappingChunks > 0) {
      skippedNotes.push(`noMappingReasons=${formatMappingFailureReasons(mappingFailureReasons)}`);
    }
    if (skippedEmptyBundle > 0) skippedNotes.push(`empty=${skippedEmptyBundle}`);
    if (skippedInvalidBundle > 0) skippedNotes.push(`invalid=${skippedInvalidBundle}`);
    if (lowYieldBailoutSkipped > 0) skippedNotes.push(`lowYieldBailout=${lowYieldBailoutSkipped}`);
    const skippedSuffix = skippedNotes.length ? ` (skipped ${skippedNotes.join(', ')})` : '';
    const coverageText = eligible > 0 ? `${covered}/${eligible}` : 'n/a';
    log(
      `[embeddings] ${mode}: refreshed ${rewritten}/${eligible} eligible incremental bundles; ` +
      `embedding coverage ${coverageText}${skippedSuffix}.`
    );
    if (lowYieldBailoutTriggered) {
      const ratioPct = ((lowYieldBailoutSummary?.observedYieldRatio || 0) * 100).toFixed(1);
      warn(
        `[embeddings] ${mode}: low-yield bailout engaged after ${warmupObserved} warmup files `
          + `(mapped=${warmupMapped}, ratio=${ratioPct}%, `
          + `threshold=${Math.round(lowYieldConfig.minYieldRatio * 100)}%); `
          + 'quality marker: reduced-extracted-prose-recall.'
      );
    }
  }
  return {
    attempted: eligible,
    eligible,
    rewritten,
    covered,
    scanned,
    skippedNoMapping,
    skippedNoMappingChunks,
    mappingFailureReasons,
    skippedInvalidBundle,
    skippedEmptyBundle,
    lowYieldBailoutSkipped,
    lowYieldBailout: lowYieldBailoutSummary,
    manifestWritten,
    completeCoverage
  };
};

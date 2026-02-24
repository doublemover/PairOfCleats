import { pathExists } from '../../shared/files.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import {
  MAX_JSON_BYTES,
  loadGraphRelations,
  loadJsonObjectArtifact,
  loadPiecesManifest,
  readJsonFile,
  resolveArtifactPresence,
  resolveDirArtifactPath
} from '../../shared/artifact-io.js';
import {
  isDenseVectorPayloadAvailable,
  loadDenseVectorBinaryFromMetaAsync,
  resolveDenseVectorBinaryArtifact
} from '../../shared/dense-vector-artifacts.js';
import { resolveLanceDbPaths, resolveLanceDbTarget } from '../../shared/lancedb.js';
import {
  extractEmbeddingIdentity,
  hasOwn,
  normalizeIdentityInputFormatting,
  normalizeIdentityNumber,
  normalizeModel,
  numbersEqual
} from './metadata.js';
const ANN_ATTACH_TASK_CONCURRENCY = 2;

/**
 * Resolve ordered dense-vector artifact candidates for a mode.
 * Auto mode prefers split vectors by cohort, with merged vectors as fallback.
 *
 * @param {string} mode
 * @param {string} resolvedDenseVectorMode
 * @returns {string[]}
 */
export const resolveDenseArtifactCandidates = (mode, resolvedDenseVectorMode) => {
  if (resolvedDenseVectorMode === 'code') return ['dense_vectors_code'];
  if (resolvedDenseVectorMode === 'doc') return ['dense_vectors_doc'];
  if (resolvedDenseVectorMode === 'auto') {
    if (mode === 'code') return ['dense_vectors_code', 'dense_vectors'];
    if (mode === 'prose' || mode === 'extracted-prose') return ['dense_vectors_doc', 'dense_vectors'];
  }
  return ['dense_vectors'];
};

/**
 * Attach lazy dense-vector loading for modes that defer ANN artifacts.
 * Candidate artifacts are tried in priority order and memoized per index.
 *
 * @param {object} input
 * @returns {void}
 */
export const attachDenseVectorLoader = ({
  idx,
  mode,
  dir,
  needsAnnArtifacts,
  lazyDenseVectorsEnabled,
  resolvedDenseVectorMode,
  strict,
  modelIdDefault
}) => {
  if (!idx || !dir || !needsAnnArtifacts || !lazyDenseVectorsEnabled) return;
  const artifactCandidates = resolveDenseArtifactCandidates(mode, resolvedDenseVectorMode);
  let pendingLoad = null;
  idx.loadDenseVectors = async () => {
    if (isDenseVectorPayloadAvailable(idx?.denseVec)) {
      return idx.denseVec;
    }
    if (pendingLoad) return pendingLoad;
    pendingLoad = (async () => {
      let manifest = null;
      try {
        manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
      } catch (err) {
        if (err?.code !== 'ERR_MANIFEST_MISSING' && err?.code !== 'ERR_MANIFEST_INVALID') {
          throw err;
        }
      }
      for (const artifactName of artifactCandidates) {
        const descriptor = resolveDenseVectorBinaryArtifact(artifactName);
        if (!descriptor) continue;
        let meta = null;
        try {
          meta = await loadJsonObjectArtifact(dir, descriptor.metaName, {
            maxBytes: MAX_JSON_BYTES,
            manifest,
            strict
          });
        } catch {
          if (strict) continue;
        }
        const loaded = await loadDenseVectorBinaryFromMetaAsync({
          dir,
          baseName: descriptor.baseName,
          meta,
          modelId: modelIdDefault || null
        });
        if (!loaded) continue;
        if (!loaded.model && modelIdDefault) loaded.model = modelIdDefault;
        idx.denseVec = loaded;
        return loaded;
      }
      idx.loadDenseVectors = null;
      return null;
    })().finally(() => {
      pendingLoad = null;
    });
    return pendingLoad;
  };
};

export const isMissingManifestLikeError = (err) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return code === 'ERR_MANIFEST_MISSING'
    || code === 'ERR_MANIFEST_INVALID'
    || code === 'ERR_COMPATIBILITY_KEY_MISSING'
    || /Missing pieces manifest/i.test(message)
    || /Missing compatibilityKey/i.test(message);
};

/**
 * Attach LanceDB metadata/dir pointers for ANN search.
 * Non-strict mode tolerates missing manifest entries and falls back to
 * legacy on-disk paths when present.
 *
 * @param {object} input
 * @returns {Promise<object|null>}
 */
export const attachLanceDb = async ({
  idx,
  mode,
  dir,
  lancedbConfig,
  resolvedDenseVectorMode,
  strict
}) => {
  if (!idx || !dir || lancedbConfig?.enabled === false) return null;
  const paths = resolveLanceDbPaths(dir);
  const target = resolveLanceDbTarget(mode, resolvedDenseVectorMode);
  const targetPaths = paths?.[target] || {};
  const metaName = target === 'doc'
    ? 'dense_vectors_doc_lancedb_meta'
    : target === 'code'
      ? 'dense_vectors_code_lancedb_meta'
      : 'dense_vectors_lancedb_meta';
  const dirName = target === 'doc'
    ? 'dense_vectors_doc_lancedb'
    : target === 'code'
      ? 'dense_vectors_code_lancedb'
      : 'dense_vectors_lancedb';
  let manifest = null;
  try {
    manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
  } catch (err) {
    if (
      err?.code !== 'ERR_MANIFEST_MISSING'
      && err?.code !== 'ERR_MANIFEST_INVALID'
    ) {
      throw err;
    }
    if (strict) throw err;
  }
  let meta = null;
  if (manifest) {
    const metaPresence = resolveArtifactPresence(dir, metaName, {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict
    });
    const missingMetaEntry = metaPresence?.error?.code === 'ERR_MANIFEST_MISSING'
      || metaPresence?.format === 'missing';
    if (metaPresence?.error && !missingMetaEntry) {
      throw metaPresence.error;
    }
    if (!missingMetaEntry) {
      try {
        meta = await loadJsonObjectArtifact(dir, metaName, {
          maxBytes: MAX_JSON_BYTES,
          manifest,
          strict
        });
      } catch (err) {
        if (strict) {
          throw err;
        }
      }
    }
  }
  if (!meta && !strict && targetPaths.metaPath && await pathExists(targetPaths.metaPath)) {
    try {
      meta = readJsonFile(targetPaths.metaPath, { maxBytes: MAX_JSON_BYTES });
    } catch {}
  }
  let lanceDir = null;
  if (manifest) {
    const dirPresence = resolveArtifactPresence(dir, dirName, {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict
    });
    const missingDirEntry = dirPresence?.error?.code === 'ERR_MANIFEST_MISSING'
      || dirPresence?.format === 'missing';
    if (dirPresence?.error && !missingDirEntry) {
      throw dirPresence.error;
    }
    if (!missingDirEntry) {
      try {
        lanceDir = resolveDirArtifactPath(dir, dirName, {
          manifest,
          strict
        });
      } catch (err) {
        if (
          err?.code !== 'ERR_MANIFEST_MISSING'
          && err?.code !== 'ERR_MANIFEST_INVALID'
        ) {
          throw err;
        }
      }
    }
  }
  if (!lanceDir && !strict && targetPaths.dir && await pathExists(targetPaths.dir)) {
    lanceDir = targetPaths.dir;
  }
  const available = Boolean(meta && lanceDir && await pathExists(lanceDir));
  idx.lancedb = {
    target,
    dir: lanceDir || null,
    metaPath: targetPaths.metaPath || null,
    meta,
    available
  };
  return idx.lancedb;
};

export const attachGraphRelations = async ({
  idx,
  dir,
  needsGraphRelations,
  strict,
  emitOutput
}) => {
  if (!idx || !dir || !needsGraphRelations) return null;
  let manifest = null;
  try {
    manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict });
  } catch (err) {
    if (err?.code === 'ERR_MANIFEST_MISSING' || err?.code === 'ERR_MANIFEST_INVALID') {
      return null;
    }
    throw err;
  }
  const presence = resolveArtifactPresence(dir, 'graph_relations', {
    manifest,
    maxBytes: MAX_JSON_BYTES,
    strict
  });
  if (!presence || presence.format === 'missing' || presence.error || presence.missingPaths?.length) {
    idx.graphRelations = null;
    return null;
  }
  try {
    idx.graphRelations = await loadGraphRelations(dir, {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict
    });
    return idx.graphRelations;
  } catch (err) {
    if (emitOutput) {
      console.warn(
        `[search] graph_relations load failed (${err?.message || err}); using name-based context expansion.`
      );
    }
    idx.graphRelations = null;
    return null;
  }
};

export const attachAnnAndGraphArtifacts = async ({
  needsGraphRelations,
  needsAnnArtifacts,
  idxCode,
  idxProse,
  idxExtractedProse,
  codeIndexDir,
  proseIndexDir,
  extractedProseDir,
  resolvedRunExtractedProse,
  resolvedLoadExtractedProse,
  lancedbConfig,
  resolvedDenseVectorMode,
  strict,
  emitOutput
}) => {
  const attachTasks = [];
  if (needsGraphRelations) {
    attachTasks.push(() => attachGraphRelations({
      idx: idxCode,
      dir: codeIndexDir,
      needsGraphRelations,
      strict,
      emitOutput
    }));
  }
  if (needsAnnArtifacts) {
    attachTasks.push(() => attachLanceDb({
      idx: idxCode,
      mode: 'code',
      dir: codeIndexDir,
      lancedbConfig,
      resolvedDenseVectorMode,
      strict
    }));
    attachTasks.push(() => attachLanceDb({
      idx: idxProse,
      mode: 'prose',
      dir: proseIndexDir,
      lancedbConfig,
      resolvedDenseVectorMode,
      strict
    }));
    if (resolvedRunExtractedProse && resolvedLoadExtractedProse) {
      attachTasks.push(() => attachLanceDb({
        idx: idxExtractedProse,
        mode: 'extracted-prose',
        dir: extractedProseDir,
        lancedbConfig,
        resolvedDenseVectorMode,
        strict
      }));
    }
  }
  if (!attachTasks.length) return;
  await runWithConcurrency(
    attachTasks,
    ANN_ATTACH_TASK_CONCURRENCY,
    async (task) => task(),
    { collectResults: false }
  );
};

/**
 * Compare embedding identity across ANN-related artifacts for one mode.
 * Returns mismatch records; in non-strict mode, disable hooks may mark
 * incompatible ANN sources unavailable to keep retrieval operational.
 *
 * @param {string} mode
 * @param {object} idx
 * @param {boolean} strict
 * @returns {Array<object>}
 */
export const validateEmbeddingIdentityForMode = (mode, idx, strict) => {
  if (!idx) return [];
  const sources = [];
  const stateIdentity = extractEmbeddingIdentity(idx?.state?.embeddings?.embeddingIdentity);
  if (stateIdentity) {
    sources.push({ name: 'index_state', identity: stateIdentity, disable: null });
  }
  const denseIdentity = extractEmbeddingIdentity(idx.denseVec);
  if (denseIdentity) {
    sources.push({ name: 'dense_vectors', identity: denseIdentity, disable: null });
  }
  const hnswIdentity = extractEmbeddingIdentity(idx.hnsw?.meta);
  if (hnswIdentity) {
    sources.push({
      name: 'hnsw',
      identity: hnswIdentity,
      disable: () => {
        if (!idx.hnsw || typeof idx.hnsw !== 'object') return;
        idx.hnsw.available = false;
        idx.hnsw.index = null;
      }
    });
  }
  const lanceIdentity = extractEmbeddingIdentity(idx.lancedb?.meta);
  if (lanceIdentity) {
    sources.push({
      name: 'lancedb',
      identity: lanceIdentity,
      disable: () => {
        if (!idx.lancedb || typeof idx.lancedb !== 'object') return;
        idx.lancedb.available = false;
      }
    });
  }
  const sqliteVecIdentity = extractEmbeddingIdentity(idx.sqliteVecMeta);
  if (sqliteVecIdentity) {
    sources.push({ name: 'sqlite-vec-meta', identity: sqliteVecIdentity, disable: null });
  }
  if (sources.length <= 1) return [];

  const reference = sources[0];
  const mismatches = [];
  const quantFields = ['scale', 'minVal', 'maxVal', 'levels'];
  for (const source of sources.slice(1)) {
    const beforeCount = mismatches.length;
    const leftDims = normalizeIdentityNumber(reference.identity?.dims);
    const rightDims = normalizeIdentityNumber(source.identity?.dims);
    if (leftDims == null || rightDims == null || !numbersEqual(leftDims, rightDims)) {
      mismatches.push({
        mode,
        source: source.name,
        field: 'dims',
        expected: leftDims,
        actual: rightDims
      });
    }

    const leftModel = normalizeModel(reference.identity?.model);
    const rightModel = normalizeModel(source.identity?.model);
    if (leftModel && rightModel && leftModel !== rightModel) {
      mismatches.push({
        mode,
        source: source.name,
        field: 'model',
        expected: leftModel,
        actual: rightModel
      });
    }
    const leftFormatting = normalizeIdentityInputFormatting(reference.identity?.inputFormatting);
    const rightFormatting = normalizeIdentityInputFormatting(source.identity?.inputFormatting);
    if (leftFormatting && rightFormatting) {
      const leftFormattingKey = JSON.stringify(leftFormatting);
      const rightFormattingKey = JSON.stringify(rightFormatting);
      if (leftFormattingKey !== rightFormattingKey) {
        mismatches.push({
          mode,
          source: source.name,
          field: 'inputFormatting',
          expected: leftFormattingKey,
          actual: rightFormattingKey
        });
      }
    }

    for (const field of quantFields) {
      const leftHas = hasOwn(reference.identity, field);
      const rightHas = hasOwn(source.identity, field);
      if (!leftHas || !rightHas) continue;
      const leftValue = normalizeIdentityNumber(reference.identity[field]);
      const rightValue = normalizeIdentityNumber(source.identity[field]);
      // Some ANN metadata formats omit quantization fields; treat null/omitted as unknown,
      // and only enforce when both sides provide concrete numeric values.
      if (leftValue == null || rightValue == null) continue;
      if (!numbersEqual(leftValue, rightValue)) {
        mismatches.push({
          mode,
          source: source.name,
          field,
          expected: leftValue,
          actual: rightValue
        });
      }
    }
    if (mismatches.length > beforeCount && !strict && typeof source.disable === 'function') {
      source.disable();
    }
  }
  return mismatches;
};

export const validateEmbeddingIdentity = ({
  needsAnnArtifacts,
  runCode,
  runProse,
  resolvedLoadExtractedProse,
  runRecords,
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords,
  strict,
  emitOutput
}) => {
  if (!needsAnnArtifacts) return;
  const identityMismatches = [];
  if (runCode) identityMismatches.push(...validateEmbeddingIdentityForMode('code', idxCode, strict));
  if (runProse) identityMismatches.push(...validateEmbeddingIdentityForMode('prose', idxProse, strict));
  if (resolvedLoadExtractedProse) {
    identityMismatches.push(...validateEmbeddingIdentityForMode('extracted-prose', idxExtractedProse, strict));
  }
  if (runRecords) identityMismatches.push(...validateEmbeddingIdentityForMode('records', idxRecords, strict));
  if (!identityMismatches.length) return;
  const details = identityMismatches
    .map((entry) => (
      `- ${entry.mode}/${entry.source}: ${entry.field} expected=${entry.expected ?? 'null'} actual=${entry.actual ?? 'null'}`
    ))
    .join('\n');
  if (strict) {
    throw new Error(`Embedding identity mismatch detected:\n${details}`);
  }
  if (emitOutput) {
    console.warn(`[search] Embedding identity mismatch detected; disabling incompatible ANN backends.\n${details}`);
  }
};

import {
  loadFileRelations,
  loadRepoMap,
  resolveDenseVector
} from '../index-loader.js';
import { attachDenseVectorLoader } from '../ann-backends.js';
import { assertRequiredRelationCoverage } from '../relation-readiness.js';

export function applyFallbackIndexStates({
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords,
  indexStates = null
}) {
  const applyFallbackIndexState = (idx, mode) => {
    if (!idx?.state && indexStates?.[mode]) {
      idx.state = indexStates[mode];
    }
  };

  applyFallbackIndexState(idxCode, 'code');
  applyFallbackIndexState(idxProse, 'prose');
  applyFallbackIndexState(idxExtractedProse, 'extracted-prose');
  applyFallbackIndexState(idxRecords, 'records');
}

export async function hydrateLoadedIndexes({
  rootDir,
  userConfig,
  useSqlite,
  useLmdb,
  needsFileRelations,
  needsRepoMap,
  needsAnnArtifacts,
  lazyDenseVectorsEnabled,
  resolvedDenseVectorMode,
  strict,
  modelIdDefault,
  codeIndexDir,
  proseIndexDir,
  extractedProseDir,
  recordsDir,
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords,
  runCode,
  runProse,
  runRecords,
  resolvedLoadExtractedProse,
  resolveOptions,
  relationFilters = null
}) {
  const relationLoadTasks = [];
  const queueRelationLoad = ({ idx, mode, relation, loader, options = {} }) => {
    relationLoadTasks.push(
      loader(rootDir, userConfig, mode, { resolveOptions, indexDir: idx.indexDir, ...options })
        .then((value) => {
          idx[relation] = value;
          if (relation === 'fileRelations' && options.required) idx.fileRelationsReadiness = value.readiness;
        })
    );
  };

  const hydrateLoadedIndex = ({
    idx,
    mode,
    dir,
    loadRelations = false
  }) => {
    idx.denseVec = resolveDenseVector(idx, mode, resolvedDenseVectorMode);
    if (!idx.denseVec && idx?.state?.embeddings?.embeddingIdentity) {
      idx.denseVec = { ...idx.state.embeddings.embeddingIdentity,
        embeddingGeneration: idx.state.embeddings.embeddingGeneration, vectors: null };
    }
    attachDenseVectorLoader({
      idx,
      mode,
      dir,
      needsAnnArtifacts,
      lazyDenseVectorsEnabled,
      resolvedDenseVectorMode,
      strict,
      modelIdDefault
    });
    idx.indexDir = dir;
    const demandedFields = [relationFilters?.importName && 'imports', relationFilters?.uses && 'usages'].filter(Boolean);
    let inlineComplete = demandedFields.length > 0;
    for (let id = 0; inlineComplete && id < (idx.chunkMeta?.length || 0); id++) {
      const chunk = idx.chunkMeta[id];
      inlineComplete = Boolean(chunk) && demandedFields.every(field => Array.isArray(chunk.codeRelations?.[field]));
    }
    if (demandedFields.length && inlineComplete) {
      idx.fileRelationsReadiness = { state: 'complete-inline', mode, indexDir: dir };
    } else if (demandedFields.length && idx.fileRelations?.readiness?.state !== 'complete') {
      queueRelationLoad({ idx, mode, relation: 'fileRelations', loader: loadFileRelations,
        options: { required: true, strict, indexDir: dir } });
    } else if (loadRelations && needsFileRelations && !idx.fileRelations) {
      queueRelationLoad({ idx, mode, relation: 'fileRelations', loader: loadFileRelations });
    }
    if (loadRelations && needsRepoMap && !idx.repoMap) {
      queueRelationLoad({ idx, mode, relation: 'repoMap', loader: loadRepoMap });
    }
  };

  if (runCode) {
    hydrateLoadedIndex({
      idx: idxCode,
      mode: 'code',
      dir: codeIndexDir,
      loadRelations: useSqlite || useLmdb
    });
  }
  if (runProse) {
    hydrateLoadedIndex({
      idx: idxProse,
      mode: 'prose',
      dir: proseIndexDir,
      loadRelations: useSqlite || useLmdb
    });
  }
  if (resolvedLoadExtractedProse) {
    hydrateLoadedIndex({
      idx: idxExtractedProse,
      mode: 'extracted-prose',
      dir: extractedProseDir,
      loadRelations: true
    });
  }
  if (runRecords) {
    hydrateLoadedIndex({
      idx: idxRecords,
      mode: 'records',
      dir: recordsDir
    });
  }
  if (relationLoadTasks.length) {
    await Promise.all(relationLoadTasks);
  }
  const fields = [relationFilters?.importName && 'imports', relationFilters?.uses && 'usages'].filter(Boolean);
  for (const [enabled, idx, mode, indexDir] of [
    [runCode, idxCode, 'code', codeIndexDir], [runProse, idxProse, 'prose', proseIndexDir],
    [resolvedLoadExtractedProse, idxExtractedProse, 'extracted-prose', extractedProseDir],
    [runRecords, idxRecords, 'records', recordsDir]
  ]) if (enabled) assertRequiredRelationCoverage({ idx, fields, mode, indexDir });
}

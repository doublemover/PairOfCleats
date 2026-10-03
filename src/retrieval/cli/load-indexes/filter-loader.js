import {
  loadFileRelations,
  loadRepoMap,
  resolveDenseVector
} from '../index-loader.js';
import { attachDenseVectorLoader } from '../ann-backends.js';

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
  resolveOptions
}) {
  const relationLoadTasks = [];
  const queueRelationLoad = ({ idx, mode, relation, loader }) => {
    relationLoadTasks.push(
      loader(rootDir, userConfig, mode, { resolveOptions })
        .then((value) => {
          idx[relation] = value;
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
      idx.denseVec = { ...idx.state.embeddings.embeddingIdentity, vectors: null };
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
    if (loadRelations && needsFileRelations && !idx.fileRelations) {
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
}

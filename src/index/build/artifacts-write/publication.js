import path from 'node:path';

import { writeFileLists } from '../artifacts/file-lists.js';
import { writeIndexMetrics } from '../artifacts/metrics.js';
import { writePiecesManifest } from '../artifacts/checksums.js';
import { writeArtifactPublicationRecord } from '../artifact-publication.js';
import { reconcileIndexIdentity } from '../../identity/reconcile.js';
import { createOrderingHasher } from '../../../shared/order.js';
import { recordOrderingHash } from '../build-state.js';

export const createArtifactOrderingRecorder = ({
  buildRoot,
  orderingStage,
  mode
} = {}) => {
  const recordOrdering = async (artifact, ordering, rule) => {
    if (!buildRoot || !ordering?.orderingHash) return;
    await recordOrderingHash(buildRoot, {
      stage: orderingStage,
      mode,
      artifact,
      hash: ordering.orderingHash,
      rule,
      count: ordering.orderingCount
    });
  };

  const measureVocabOrdering = (vocab = []) => {
    if (!Array.isArray(vocab) || !vocab.length) {
      return { orderingHash: null, orderingCount: 0 };
    }
    const orderingHasher = createOrderingHasher();
    for (const entry of vocab) {
      orderingHasher.update(entry);
    }
    const result = orderingHasher.digest();
    return {
      orderingHash: result?.hash || null,
      orderingCount: result?.count || 0
    };
  };

  return {
    recordOrdering,
    measureVocabOrdering
  };
};

export const runArtifactPublicationFinalizers = async ({
  runTrackedArtifactCloseout,
  listPieceEntries,
  hasPieceFile,
  addPieceFile,
  outDir,
  state,
  userConfig,
  log,
  mode,
  indexState,
  effectiveAbortSignal,
  root,
  postings,
  dictSummary,
  useStubEmbeddings,
  modelId,
  denseVectorsEnabled,
  incrementalEnabled,
  fileCounts,
  timing,
  perfProfile,
  filterIndexStats,
  resolvedTokenMode,
  tokenSampleSize,
  tokenMaxFiles,
  chunkMetaPlan,
  tokenPostingsUseShards,
  compressionEnabled,
  compressionMode,
  compressionKeepRaw,
  documentExtractionEnabled,
  repoProvenance,
  buildRoot
} = {}) => {
  await runTrackedArtifactCloseout('file-lists', async () => writeFileLists({
    outDir,
    state,
    userConfig,
    log
  }));
  const fileListsPath = path.join(outDir, '.filelists.json');
  if (await (async () => {
    try {
      await import('node:fs/promises').then(({ access }) => access(fileListsPath));
      return true;
    } catch {
      return false;
    }
  })() && !hasPieceFile(fileListsPath)) {
    addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, fileListsPath);
  }
  let pieceEntries = listPieceEntries();
  await runTrackedArtifactCloseout('pieces-manifest', async () => writePiecesManifest({
    pieceEntries,
    outDir,
    mode,
    indexState,
    abortSignal: effectiveAbortSignal
  }));
  await runTrackedArtifactCloseout('index-metrics', async () => writeIndexMetrics({
    root,
    userConfig,
    mode,
    outDir,
    state,
    postings,
    dictSummary,
    useStubEmbeddings,
    modelId,
    denseVectorsEnabled,
    incrementalEnabled,
    fileCounts,
    timing,
    perfProfile,
    indexState,
    filterIndexStats,
    resolvedTokenMode,
    tokenSampleSize,
    tokenMaxFiles,
    chunkMetaUseJsonl: chunkMetaPlan.chunkMetaUseJsonl,
    chunkMetaUseShards: chunkMetaPlan.chunkMetaUseShards,
    tokenPostingsUseShards,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    documentExtractionEnabled,
    repoProvenance
  }));
  pieceEntries = listPieceEntries();
  const identityReconciliation = await assertArtifactIdentityReconciliationReady({
    runTrackedArtifactCloseout,
    outDir,
    mode
  });
  await runTrackedArtifactCloseout('artifact-publication', async () => writeArtifactPublicationRecord({
    buildRoot: buildRoot || path.resolve(outDir, '..'),
    outDir,
    mode,
    stage: indexState?.stage || null,
    buildId: indexState?.buildId || null,
    artifactSurfaceVersion: indexState?.artifactSurfaceVersion || null,
    compatibilityKey: indexState?.compatibilityKey || null,
    pieceEntries,
    manifestPath: path.join(outDir, 'pieces', 'manifest.json'),
    identityReconciliation
  }));
  return pieceEntries;
};

export const assertArtifactIdentityReconciliationReady = async ({
  runTrackedArtifactCloseout,
  outDir,
  mode
} = {}) => {
  if (mode !== 'code') return null;
  let identityReconciliation = null;
  const run = typeof runTrackedArtifactCloseout === 'function'
    ? runTrackedArtifactCloseout
    : async (_label, task) => task();
  await run('identity-reconciliation', async () => {
    identityReconciliation = await reconcileIndexIdentity({
      indexDir: outDir,
      mode,
      strict: true
    });
    if (!identityReconciliation.ok) {
      const firstIssue = identityReconciliation.issues[0]?.message || 'identity reconciliation failed';
      throw new Error(
        `[identity] ${firstIssue} `
        + `(issues=${identityReconciliation.totalIssues}, chunk_meta=${identityReconciliation.counts.chunkMeta}, `
        + `symbols=${identityReconciliation.counts.symbols}, symbol_occurrences=${identityReconciliation.counts.symbolOccurrences}, `
        + `symbol_edges=${identityReconciliation.counts.symbolEdges})`
      );
    }
  });
  return identityReconciliation;
};

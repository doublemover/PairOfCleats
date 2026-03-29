import path from 'node:path';

import { writeFileLists } from '../artifacts/file-lists.js';
import { writeIndexMetrics } from '../artifacts/metrics.js';
import { writePiecesManifest } from '../artifacts/checksums.js';
import {
  ARTIFACT_PUBLICATION_STATUSES,
  resolveCommittedArtifactPaths,
  resolveArtifactPublicationPath,
  resolveArtifactPublicationValidationPath,
  writeArtifactPublicationRecord,
  writeArtifactPublicationValidationReport
} from '../artifact-publication.js';
import { reconcileIndexIdentity } from '../../identity/reconcile.js';
import { createOrderingHasher } from '../../../shared/order.js';
import { recordOrderingHash } from '../build-state.js';

const assertPublicationValidationSucceeded = (publicationValidation) => {
  if (publicationValidation?.payload?.ok) return;
  const payload = publicationValidation?.payload || {};
  const failedFamily = Array.isArray(payload.families)
    ? payload.families.find((entry) => entry?.ok === false)
    : null;
  if (failedFamily) {
    const missing = failedFamily.missingRequiredMembers.join(', ');
    throw new Error(
      `[artifact-publication] ${failedFamily.family} missing required members: ${missing}`
    );
  }
  if (Array.isArray(payload.checks?.missingManifestEntries) && payload.checks.missingManifestEntries.length) {
    throw new Error(
      `[artifact-publication] manifest missing committed entries: `
      + `${payload.checks.missingManifestEntries.join(', ')}`
    );
  }
  if (Array.isArray(payload.checks?.extraManifestEntries) && payload.checks.extraManifestEntries.length) {
    throw new Error(
      `[artifact-publication] manifest contains undeclared entries: `
      + `${payload.checks.extraManifestEntries.join(', ')}`
    );
  }
  if (Array.isArray(payload.checks?.missingCommittedPaths) && payload.checks.missingCommittedPaths.length) {
    throw new Error(
      `[artifact-publication] staged files missing on disk: `
      + `${payload.checks.missingCommittedPaths.map((entry) => entry.path).join(', ')}`
    );
  }
  throw new Error('[artifact-publication] validation failed');
};

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
  commitArtifactCleanup,
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
  buildRoot,
  familyDeclarations = []
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
  const publicationBuildRoot = buildRoot || path.resolve(outDir, '..');
  const publicationManifestPath = path.join(outDir, 'pieces', 'manifest.json');
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
  let publicationValidation = null;
  const publishedAt = new Date().toISOString();
  await runTrackedArtifactCloseout('artifact-publication-validation', async () => {
    publicationValidation = await writeArtifactPublicationValidationReport({
      buildRoot: publicationBuildRoot,
      outDir,
      mode,
      buildId: indexState?.buildId || null,
      pieceEntries,
      manifestPath: publicationManifestPath,
      familyDeclarations
    });
    assertPublicationValidationSucceeded(publicationValidation);
  });
  const identityReconciliation = await assertArtifactIdentityReconciliationReady({
    runTrackedArtifactCloseout,
    outDir,
    mode
  });
  let publicationRecord = null;
  await runTrackedArtifactCloseout('artifact-publication', async () => {
    publicationRecord = await writeArtifactPublicationRecord({
      buildRoot: publicationBuildRoot,
      outDir,
      mode,
      stage: indexState?.stage || null,
      buildId: indexState?.buildId || null,
      artifactSurfaceVersion: indexState?.artifactSurfaceVersion || null,
      compatibilityKey: indexState?.compatibilityKey || null,
      pieceEntries,
      manifestPath: publicationManifestPath,
      publicationValidation,
      identityReconciliation,
      cleanup: {
        status: 'pending',
        plannedActions: Number.isFinite(Number(indexState?.extensions?.artifactCleanup?.plannedActions))
          ? Number(indexState.extensions.artifactCleanup.plannedActions)
          : 0,
        completedActions: 0,
        failedActions: 0,
        failures: []
      },
      status: ARTIFACT_PUBLICATION_STATUSES.VALIDATED,
      publishedAt: null
    });
  });
  let cleanupCommit = null;
  if (typeof commitArtifactCleanup === 'function') {
    await runTrackedArtifactCloseout('artifact-cleanup-commit', async () => {
      cleanupCommit = await commitArtifactCleanup({
        immutablePaths: [
          ...resolveCommittedArtifactPaths({
            buildRoot: publicationBuildRoot,
            outDir,
            pieceEntries,
            manifestPath: publicationManifestPath
          }),
          resolveArtifactPublicationValidationPath(publicationBuildRoot, mode),
          publicationRecord?.publicationPath || resolveArtifactPublicationPath(publicationBuildRoot, mode)
        ]
      });
      if (Number(cleanupCommit?.failedActions || 0) > 0) {
        throw new Error(
          `[artifact-cleanup] cleanup failed for current generation: `
          + `${cleanupCommit.failures.map((entry) => entry.message).join(' | ')}`
        );
      }
    });
  }
  let finalPublicationValidation = publicationValidation;
  await runTrackedArtifactCloseout('artifact-publication-post-cleanup-validation', async () => {
    finalPublicationValidation = await writeArtifactPublicationValidationReport({
      buildRoot: publicationBuildRoot,
      outDir,
      mode,
      buildId: indexState?.buildId || null,
      pieceEntries,
      manifestPath: publicationManifestPath,
      familyDeclarations
    });
    assertPublicationValidationSucceeded(finalPublicationValidation);
  });
  await runTrackedArtifactCloseout('artifact-publication-record-finalize', async () => {
    publicationRecord = await writeArtifactPublicationRecord({
      buildRoot: publicationBuildRoot,
      outDir,
      mode,
      stage: indexState?.stage || null,
      buildId: indexState?.buildId || null,
      artifactSurfaceVersion: indexState?.artifactSurfaceVersion || null,
      compatibilityKey: indexState?.compatibilityKey || null,
      pieceEntries,
      manifestPath: publicationManifestPath,
      publicationValidation: finalPublicationValidation,
      identityReconciliation,
      cleanup: cleanupCommit || {
        status: 'not-required',
        plannedActions: 0,
        completedActions: 0,
        failedActions: 0,
        failures: []
      },
      status: ARTIFACT_PUBLICATION_STATUSES.PUBLISHED,
      publishedAt
    });
  });
  return {
    pieceEntries,
    publicationValidation: finalPublicationValidation,
    identityReconciliation,
    cleanupCommit,
    publicationRecord
  };
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

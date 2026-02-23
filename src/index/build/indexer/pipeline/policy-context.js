import { applyAdaptiveDictConfig } from '../../../../shared/dict-utils.js';
import { INDEX_PROFILE_VECTOR_ONLY } from '../../../../contracts/index-profile.js';
import { updateBuildState } from '../../build-state.js';
import {
  SIGNATURE_VERSION,
  buildIncrementalSignature,
  buildIncrementalSignatureSummary,
  buildTokenizationKey
} from '../signatures.js';
import {
  buildModalitySparsityEntryKey,
  readModalitySparsityProfile,
  shouldElideModalityProcessingStage
} from './modality-sparsity.js';
import { hasVectorEmbeddingBuildCapability, resolveVectorOnlyShortcutPolicy } from './features.js';
import { resolveTinyRepoFastPath } from './tiny-repo-policy.js';
import { summarizeTinyRepoFastPath } from './summaries.js';

/**
 * Resolve mode pipeline toggles from runtime policy and repo-size shortcuts.
 *
 * @param {{runtime:object,entries:Array<object>}} input
 * @returns {{
 *   runtimeRef:object,
 *   tinyRepoFastPath:object,
 *   tinyRepoFastPathActive:boolean,
 *   tinyRepoFastPathSummary:object|null,
 *   vectorOnlyShortcuts:object,
 *   vectorOnlyShortcutSummary:object|null,
 *   relationsEnabled:boolean,
 *   importGraphEnabled:boolean,
 *   crossFileInferenceEnabled:boolean
 * }}
 */
export const resolvePipelinePolicyContext = ({ runtime, entries }) => {
  const dictConfig = applyAdaptiveDictConfig(runtime.dictConfig, entries.length);
  const tinyRepoFastPath = resolveTinyRepoFastPath({ runtime, entries });
  const tinyRepoFastPathActive = tinyRepoFastPath.active === true;
  const runtimeWithDictConfig = dictConfig === runtime.dictConfig
    ? runtime
    : { ...runtime, dictConfig };
  const runtimeRef = tinyRepoFastPathActive
    ? {
      ...runtimeWithDictConfig,
      // Tiny-repo fast path: disable expensive cross-file analysis passes.
      typeInferenceEnabled: false,
      typeInferenceCrossFileEnabled: false,
      riskAnalysisCrossFileEnabled: false,
      tinyRepoFastPath
    }
    : runtimeWithDictConfig;
  const vectorOnlyShortcuts = resolveVectorOnlyShortcutPolicy(runtimeRef);
  const vectorOnlyShortcutSummary = vectorOnlyShortcuts.enabled
    ? {
      disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
      disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference
    }
    : null;
  const tinyRepoFastPathSummary = summarizeTinyRepoFastPath(tinyRepoFastPath);
  const relationsEnabled = runtimeRef.stage !== 'stage1';
  const importGraphEnabled = relationsEnabled
    && !vectorOnlyShortcuts.disableImportGraph
    && !(tinyRepoFastPathActive && tinyRepoFastPath.disableImportGraph);
  const crossFileInferenceEnabled = relationsEnabled
    && !vectorOnlyShortcuts.disableCrossFileInference
    && !(tinyRepoFastPathActive && tinyRepoFastPath.disableCrossFileInference);
  return {
    runtimeRef,
    tinyRepoFastPath,
    tinyRepoFastPathActive,
    tinyRepoFastPathSummary,
    vectorOnlyShortcuts,
    vectorOnlyShortcutSummary,
    relationsEnabled,
    importGraphEnabled,
    crossFileInferenceEnabled
  };
};

/**
 * Resolve and persist post-discovery policy/signature state for one mode.
 *
 * Sequencing contract:
 * This must run after discovery (entry list is finalized) and before
 * incremental planning so cache signatures and analysis shortcuts remain stable
 * across the remaining stages.
 *
 * @param {{
 *  runtime:object,
 *  mode:'code'|'prose'|'records'|'extracted-prose',
 *  entries:Array<object>,
 *  log?:(message:string)=>void
 * }} input
 * @returns {Promise<{
 *  runtimeRef:object,
 *  tinyRepoFastPath:object,
 *  tinyRepoFastPathActive:boolean,
 *  tinyRepoFastPathSummary:object|null,
 *  vectorOnlyShortcuts:object,
 *  vectorOnlyShortcutSummary:object|null,
 *  relationsEnabled:boolean,
 *  importGraphEnabled:boolean,
 *  crossFileInferenceEnabled:boolean,
 *  tokenizationKey:string,
 *  cacheSignature:string,
 *  cacheSignatureSummary:object,
 *  modalitySparsityProfilePath:string|null,
 *  modalitySparsityProfile:object,
 *  cachedZeroModality:boolean
 * }>}
 */
export const initializePipelinePolicyBootstrap = async ({
  runtime,
  mode,
  entries,
  log
}) => {
  const policyContext = resolvePipelinePolicyContext({ runtime, entries });
  const {
    runtimeRef,
    tinyRepoFastPath,
    tinyRepoFastPathActive,
    tinyRepoFastPathSummary,
    vectorOnlyShortcuts,
    vectorOnlyShortcutSummary
  } = policyContext;

  if (vectorOnlyShortcuts.enabled && typeof log === 'function') {
    log(
      '[vector_only] analysis shortcuts: '
      + `disableImportGraph=${vectorOnlyShortcuts.disableImportGraph}, `
      + `disableCrossFileInference=${vectorOnlyShortcuts.disableCrossFileInference}.`
    );
  }
  if (tinyRepoFastPathActive && typeof log === 'function') {
    log(
      `[tiny_repo] fast path active: files=${tinyRepoFastPath.fileCount}, `
      + `bytes=${tinyRepoFastPath.totalBytes}, estimatedLines=${tinyRepoFastPath.estimatedLines}, `
      + `disableImportGraph=${tinyRepoFastPath.disableImportGraph}, `
      + `disableCrossFileInference=${tinyRepoFastPath.disableCrossFileInference}, `
      + `minimalArtifacts=${tinyRepoFastPath.minimalArtifacts}.`
    );
  }

  await updateBuildState(runtimeRef.buildRoot, {
    analysisShortcuts: {
      [mode]: {
        profileId: vectorOnlyShortcuts.profileId,
        disableImportGraph: vectorOnlyShortcuts.disableImportGraph,
        disableCrossFileInference: vectorOnlyShortcuts.disableCrossFileInference,
        tinyRepoFastPath: tinyRepoFastPathSummary
      }
    }
  });

  const vectorOnlyProfile = runtimeRef?.profile?.id === INDEX_PROFILE_VECTOR_ONLY;
  if (vectorOnlyProfile && !hasVectorEmbeddingBuildCapability(runtimeRef)) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. '
      + 'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
    );
  }

  const tokenizationKey = buildTokenizationKey(runtimeRef, mode);
  const cacheSignature = buildIncrementalSignature(runtimeRef, mode, tokenizationKey);
  const cacheSignatureSummary = buildIncrementalSignatureSummary(runtimeRef, mode, tokenizationKey);
  await updateBuildState(runtimeRef.buildRoot, {
    signatures: {
      [mode]: {
        tokenizationKey,
        cacheSignature,
        signatureVersion: SIGNATURE_VERSION
      }
    }
  });

  const {
    profilePath: modalitySparsityProfilePath,
    profile: modalitySparsityProfile
  } = await readModalitySparsityProfile(runtimeRef);
  const modalitySparsityKey = buildModalitySparsityEntryKey({ mode, cacheSignature });
  const cachedModalitySparsity = modalitySparsityProfile?.entries?.[modalitySparsityKey] || null;
  const cachedZeroModality = shouldElideModalityProcessingStage({
    fileCount: cachedModalitySparsity?.fileCount ?? null,
    chunkCount: cachedModalitySparsity?.chunkCount ?? null
  });

  return {
    ...policyContext,
    tokenizationKey,
    cacheSignature,
    cacheSignatureSummary,
    modalitySparsityProfilePath,
    modalitySparsityProfile,
    cachedZeroModality
  };
};

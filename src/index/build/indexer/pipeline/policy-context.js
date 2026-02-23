import { applyAdaptiveDictConfig } from '../../../../shared/dict-utils.js';
import { resolveVectorOnlyShortcutPolicy } from './features.js';
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

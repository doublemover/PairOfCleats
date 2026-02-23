import { resolveRunSearchSparsePreflight } from './sparse-preflight.js';
import { reinitializeBackendAfterSparseFallback } from './backend-reinit.js';

/**
 * Apply sparse-preflight policy and optional backend reinitialization.
 *
 * @param {object} [input]
 * @param {object} input.preflightInput
 * @param {object} input.reinitInput
 * @param {()=>void} [input.syncAnnFlags]
 * @param {{
 *   resolveRunSearchSparsePreflight?:(input:object)=>object,
 *   reinitializeBackendAfterSparseFallback?:(input:object)=>Promise<object>
 * }} [input.dependencies]
 * @returns {Promise<object>}
 */
export async function applyRunSearchSparseFallbackPolicy({
  preflightInput = {},
  reinitInput = {},
  syncAnnFlags = null,
  dependencies = {}
} = {}) {
  const resolveRunSearchSparsePreflightImpl = (
    dependencies.resolveRunSearchSparsePreflight || resolveRunSearchSparsePreflight
  );
  const reinitializeBackendAfterSparseFallbackImpl = (
    dependencies.reinitializeBackendAfterSparseFallback || reinitializeBackendAfterSparseFallback
  );

  const sparsePreflight = resolveRunSearchSparsePreflightImpl(preflightInput);
  if (sparsePreflight?.error) {
    return {
      error: sparsePreflight.error,
      annEnabledEffective: sparsePreflight.annEnabledEffective,
      sparseFallbackForcedByPreflight: sparsePreflight.sparseFallbackForcedByPreflight === true,
      sparseMissingByMode: sparsePreflight.sparseMissingByMode || {}
    };
  }

  const response = {
    annEnabledEffective: sparsePreflight.annEnabledEffective,
    sparseFallbackForcedByPreflight: sparsePreflight.sparseFallbackForcedByPreflight === true,
    sparseMissingByMode: sparsePreflight.sparseMissingByMode || {},
    reinitialized: false
  };

  if (!response.sparseFallbackForcedByPreflight) {
    return response;
  }

  if (typeof syncAnnFlags === 'function') {
    syncAnnFlags();
  }
  const backendReinit = await reinitializeBackendAfterSparseFallbackImpl(reinitInput);
  if (backendReinit?.error) {
    return {
      ...response,
      error: backendReinit.error
    };
  }
  return {
    ...response,
    reinitialized: true,
    ...backendReinit
  };
}

import { createError, ERROR_CODES } from '../../shared/error-codes.js';

const keys = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

/** Optional persisted data cannot replace a successful current response unless
 * its envelope, requested scope and bounded hit provenance remain valid.
 */
export const isReusableFederatedCacheResult = (result, {
  manifestHash, repoSetId, selectedRepoIds, selectedReposByMode, topN, strictFailures
}) => {
  if (!isRecord(result) || result.ok !== true || result.backend !== 'federated'
    || !['complete', 'empty', 'partial', 'degraded'].includes(result.status)) return false;
  const partial = result.status === 'partial' || result.status === 'degraded';
  if (result.partialSuccess !== partial || (strictFailures && partial)) return false;
  const meta = result.meta;
  if (!isRecord(meta) || meta.manifestHash !== manifestHash || meta.repoSetId !== repoSetId
    || meta.policy?.strictFailures !== strictFailures || meta.policy?.acceptPartialResults !== !strictFailures
    || meta.policy?.responseStatus !== result.status || meta.completeness?.status !== result.status
    || meta.completeness?.strict !== strictFailures) return false;
  const selected = new Set(selectedRepoIds);
  const sameScope = entries => Array.isArray(entries) && entries.length === selected.size
    && new Set(entries).size === selected.size && entries.every(repoId => selected.has(repoId));
  if (!sameScope(meta.selection?.selectedRepoIds)
    || !Array.isArray(result.repos) || result.repos.some(repo => !isRecord(repo))
    || !sameScope(result.repos.map(repo => repo.repoId))) return false;
  for (const [mode, key] of Object.entries(keys)) {
    const eligible = new Set((selectedReposByMode[mode] || []).map(repo => repo.repoId));
    if (!Array.isArray(result[key]) || result[key].length > topN
      || result[key].some(hit => !isRecord(hit) || !eligible.has(hit.repoId) || typeof hit.globalId !== 'string')) return false;
  }
  return true;
};

/** Missing mode payloads are failed work, never evidence of a healthy no-hit call. */
export const validateFederatedModeResult = (result, modes) => {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.ok === false) {
    throw createError(result?.code || ERROR_CODES.INTERNAL, result?.message || 'Repository did not return a successful search result.');
  }
  for (const mode of modes) {
    const hits = result[keys[mode]];
    if (!Array.isArray(hits) || hits.some(hit => !hit || typeof hit !== 'object' || Array.isArray(hit))) {
      throw createError(ERROR_CODES.INTERNAL, `Repository did not fulfill the admitted ${mode} result contract.`);
    }
  }
};

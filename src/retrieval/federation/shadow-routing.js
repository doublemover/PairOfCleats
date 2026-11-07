import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../../shared/stable-json.js';
import { buildRetrievalHitKey } from '../hit-comparison.js';
import { shadowQueryRoute, simulateShadowAllocation, SHADOW_ROUTING_VERSION,
  SHADOW_ROUTING_POLICY_KEY } from '../evaluation/shadow-routing.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fields = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };
const partial = reason => ({ schemaVersion: SHADOW_ROUTING_VERSION, policyKey: SHADOW_ROUTING_POLICY_KEY,
  authoritative: false, complete: false, reason, modes: [], metrics: null });

/** Delivery is observational and never awaited by the primary request. The
 * bounded report owns all its data; callback failures cannot replace results.
 */
export const publishFederatedShadow = (context, report) => {
  if (context.shadowRouting !== true || typeof context.onShadowRouting !== 'function') return;
  try {
    const pending = [report];
    while (pending.length) {
      const value = pending.pop(); if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
      pending.push(...Object.values(value)); Object.freeze(value);
    }
    Promise.resolve(context.onShadowRouting(report)).catch(() => {});
  } catch {}
};

/** Capture only already-produced ranked heads after the existing generation
 * fence. Never reconstruct original pools from globally merged cache output.
 */
export const captureFederatedShadow = ({ query, queryAst = null, manifest, selectedByMode,
  requestedModes, perRepoResults, manifestRepos = null, queryKey, budget, signal = null }) => {
  const started = performance.now();
  if (signal?.aborted) return partial('cancelled');
  if (!perRepoResults) return partial('cache-hit-original-pools-unavailable');
  if (typeof manifest?.manifestHash !== 'string' || manifest.manifestHash.length > 256
    || typeof queryKey !== 'string' || queryKey.length > 4096 || perRepoResults.length > 32
    || !Array.isArray(requestedModes) || requestedModes.length > 4) return partial('generation-or-scope-unavailable');
  const classification = shadowQueryRoute({ query, queryAst, signal });
  if (!classification.complete) return partial(classification.reason);
  const workspaceKey = digest(['workspace-manifest', manifest.manifestHash]), pinnedQueryKey = digest(['federated-query-cache-policy', queryKey]);
  if (!(manifestRepos instanceof Map) && (!Array.isArray(manifest.repos) || manifest.repos.length > 32)) return partial('bounded-manifest-lookup-unavailable');
  const results = new Map(perRepoResults.map(row => [row.repoId, row])), manifests = manifestRepos || new Map(manifest.repos.map(row => [row.repoId, row]));
  const modes = []; let captured = 0;
  for (const mode of requestedModes) {
    const selected = selectedByMode[mode] || [];
    if (!Array.isArray(selected) || selected.length > 32 || !fields[mode]) return partial('repository-or-mode-bound');
    const groups = new Map(), expectedGenerations = {}, witnesses = [];
    for (const selectedRepo of selected) {
      if (signal?.aborted || performance.now() - started > 100) return partial(signal?.aborted ? 'cancelled' : 'deadline');
      const repoId = selectedRepo.repoId, repoManifest = manifests.get(repoId), index = repoManifest?.indexes?.[mode];
      const cohortKey = index?.cohortKey || index?.compatibilityKey;
      const buildGeneration = repoManifest?.build?.generationKey, signature = index?.indexSignatureHash;
      if (typeof cohortKey !== 'string' || !cohortKey || cohortKey.length > 4096
        || typeof buildGeneration !== 'string' || !buildGeneration || buildGeneration.length > 65536
        || typeof signature !== 'string' || !signature || signature.length > 256) return partial('cohort-or-generation-witness-unavailable');
      const groupKey = digest([mode, cohortKey]), generation = digest(['admitted-federated-mode', buildGeneration, signature]);
      expectedGenerations[repoId] = generation;
      witnesses.push({ repoId, generation, buildGenerationDigest: digest(buildGeneration), indexSignature: signature });
      if (!groups.has(groupKey)) groups.set(groupKey, { id: `${mode}:${groupKey.slice(0, 24)}`, signature: groupKey, repos: [] });
      const source = results.get(repoId)?.result?.[fields[mode]];
      if (!Array.isArray(source)) return partial('requested-repository-pool-unavailable');
      const candidates = [], seen = new Set();
      for (const hit of source.slice(0, 64)) {
        if (++captured > 2048) return partial('candidate-bound');
        const identity = buildRetrievalHitKey(hit, null, { repoScope: repoId, mode });
        if (!identity || seen.has(identity)) return partial('source-identity-unavailable-or-duplicate');
        seen.add(identity);
        candidates.push({ key: digest(identity), sourceRank: candidates.length + 1,
          sparse: Number.isFinite(hit.sparseScore), dense: Number.isFinite(hit.annScore), relevance: null });
      }
      groups.get(groupKey).repos.push({ repoId, generation, candidates });
    }
    const snapshot = { schemaVersion: SHADOW_ROUTING_VERSION, workspaceKey, queryKey: pinnedQueryKey,
      queryTextDigest: createHash('sha256').update(query).digest('hex'), cohorts: [...groups.values()] };
    const allocation = simulateShadowAllocation({ snapshot, expectedWorkspaceKey: workspaceKey, expectedQueryKey: pinnedQueryKey,
      expectedGenerations, budget: Math.min(2048, budget), queryClass: classification.label, signal });
    modes.push({ mode, allocation, witnesses, savedPoolDigest: digest(snapshot),
      scope: 'first64-existing-ranked-candidates-per-repository;unknown-live-judgments' });
  }
  const report = { schemaVersion: SHADOW_ROUTING_VERSION, policyKey: SHADOW_ROUTING_POLICY_KEY, authoritative: false,
    complete: modes.every(row => row.allocation.complete), classification, workspaceKey, queryKey: pinnedQueryKey,
    source: 'already-produced-federated-ranked-pools', extraRepositoryCalls: 0, modes, capturedCandidates: captured };
  return performance.now() - started > 100 ? partial('deadline')
    : Buffer.byteLength(JSON.stringify(report)) > 65536 ? partial('output-bytes') : report;
};

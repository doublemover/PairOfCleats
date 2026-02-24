import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { isDenseVectorPayloadAvailable } from '../../shared/dense-vector-artifacts.js';
import { ANN_PROVIDER_IDS } from '../ann/types.js';
import { isEmbeddingReady } from '../ann/utils.js';
import {
  ANN_ADAPTIVE_ROUTE,
  ANN_CANDIDATE_POLICY_REASONS,
  resolveAnnAdaptiveStrategy,
  resolveAnnCandidateSet
} from '../scoring/ann-candidate-policy.js';
import { VECTOR_REQUIRED_CODE } from './constants.js';

const normalizeAnnHits = (hits) => {
  if (!Array.isArray(hits)) return [];
  return hits
    .filter((hit) => Number.isFinite(hit?.idx) && Number.isFinite(hit?.sim))
    .sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx));
};

/**
 * Execute ANN stage (provider ANN + MinHash fallback).
 * @param {object} input
 * @returns {Promise<{annHits:Array<object>,annSource:string|null,annCandidatePolicy:object|null,candidates:Set<number>|null}>}
 */
export const runAnnStage = async ({
  idx,
  mode,
  meta,
  queryEmbedding,
  queryTokens,
  searchTopN,
  expandedTopN,
  annEnabledForMode,
  vectorOnlyProfile,
  profileId,
  annOrder,
  adaptiveProvidersEnabled,
  getAnnProviders,
  warnAnnFallback,
  providerRuntime,
  signal,
  candidatePool,
  trackReleaseSet,
  candidates,
  bmHits,
  allowedIdx,
  allowedCount,
  filtersEnabled,
  annCandidatePolicyConfig,
  minhashLimit,
  hasAllowedId,
  ensureAllowedSet,
  bitmapToSet,
  rankMinhash,
  vectorAnnState,
  hnswAnnState,
  lanceAnnState,
  annMetrics
}) => {
  let annHits = [];
  let annSource = null;
  let warned = false;
  let annAdaptiveStrategy = null;
  let effectiveRoute = ANN_ADAPTIVE_ROUTE.VECTOR;

  if (!annEnabledForMode) {
    if (vectorOnlyProfile) {
      throw createError(
        ERROR_CODES.INVALID_REQUEST,
        'Sparse-only retrieval is not allowed for indexing.profile=vector_only. ' +
          'Re-run without sparse-only mode or pass --allow-sparse-fallback to permit ANN fallback.',
        {
          reasonCode: 'retrieval_profile_mismatch',
          reason: 'sparse_requested_against_vector_only',
          mode,
          profileId
        }
      );
    }
    annMetrics.vectorActive = false;
    annMetrics.hits = 0;
    annMetrics.source = null;
    annMetrics.warned = false;
    annMetrics.candidates = null;
    annMetrics.providerAvailable = false;
    return { annHits, annSource, annCandidatePolicy: null, candidates };
  }

  const ensureCandidateBase = () => {
    if (candidates) return candidates;
    if (!bmHits.length) return null;
    const set = candidatePool.acquire();
    for (const hit of bmHits) {
      if (Number.isFinite(hit?.idx)) set.add(hit.idx);
    }
    trackReleaseSet(set);
    candidates = set;
    return set;
  };

  const annCandidateBase = ensureCandidateBase();
  const annCandidatePolicy = resolveAnnCandidateSet({
    candidates: annCandidateBase,
    allowedIds: allowedIdx,
    filtersActive: filtersEnabled,
    cap: annCandidatePolicyConfig.cap,
    minDocCount: annCandidatePolicyConfig.minDocCount,
    maxDocCount: annCandidatePolicyConfig.maxDocCount,
    toSet: ensureAllowedSet
  });
  const annCandidates = annCandidatePolicy.set;
  const shouldTryAnnFallback = filtersEnabled
    && Boolean(allowedIdx)
    && annCandidatePolicy.reason !== ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX;
  let annFallbackResolved = false;
  let annFallback = null;
  const resolveAnnFallback = () => {
    if (!shouldTryAnnFallback) return null;
    if (!annFallbackResolved) {
      annFallback = allowedIdx;
      annFallbackResolved = true;
    }
    return annFallback;
  };

  const normalizedCandidateCache = new WeakMap();
  const normalizeAnnCandidateSet = (provider, candidateSet) => {
    if (!candidateSet) return null;
    if (candidateSet instanceof Set) return candidateSet;
    const providerId = provider?.id;
    if (providerId !== ANN_PROVIDER_IDS.SQLITE_VECTOR && providerId !== ANN_PROVIDER_IDS.LANCEDB) {
      return candidateSet;
    }
    if (candidateSet && (typeof candidateSet === 'object' || typeof candidateSet === 'function')) {
      let byProvider = normalizedCandidateCache.get(candidateSet);
      if (!byProvider) {
        byProvider = new Map();
        normalizedCandidateCache.set(candidateSet, byProvider);
      }
      if (byProvider.has(providerId)) {
        return byProvider.get(providerId);
      }
      const converted = bitmapToSet(candidateSet);
      byProvider.set(providerId, converted);
      return converted;
    }
    return bitmapToSet(candidateSet);
  };

  const runAnnQuery = async (provider, candidateSet) => {
    if (!provider || typeof provider.query !== 'function') {
      return { hits: [], succeeded: false };
    }
    if (providerRuntime.isProviderCoolingDown(provider, mode)) {
      return { hits: [], succeeded: false };
    }
    const providerId = provider?.id;
    const adaptiveTopN = Number.isFinite(Number(annAdaptiveStrategy?.budget?.providerTopN?.[providerId]))
      ? Number(annAdaptiveStrategy.budget.providerTopN[providerId])
      : null;
    const resolvedTopN = Number.isFinite(adaptiveTopN) && adaptiveTopN > 0
      ? Math.max(1, Math.floor(adaptiveTopN))
      : expandedTopN;
    const normalizedCandidateSet = normalizeAnnCandidateSet(provider, candidateSet);
    const startedAtNs = process.hrtime.bigint();
    try {
      const hits = await provider.query({
        idx,
        mode,
        embedding: queryEmbedding,
        topN: resolvedTopN,
        candidateSet: normalizedCandidateSet,
        signal,
        budget: annAdaptiveStrategy?.budget || null,
        route: annAdaptiveStrategy?.route || null,
        features: annAdaptiveStrategy?.features || null
      });
      const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
      providerRuntime.recordProviderSuccess(provider, mode, { latencyMs: elapsedMs });
      return { hits: normalizeAnnHits(hits), succeeded: true };
    } catch (err) {
      providerRuntime.recordProviderFailure(provider, mode, err?.message || 'query failed');
      return { hits: [], succeeded: false };
    }
  };

  const hasVectorArtifacts = Boolean(
    isDenseVectorPayloadAvailable(idx?.denseVec)
    || typeof idx?.loadDenseVectors === 'function'
    || vectorAnnState?.[mode]?.available
    || hnswAnnState?.[mode]?.available
    || lanceAnnState?.[mode]?.available
  );
  const vectorActive = annEnabledForMode && isEmbeddingReady(queryEmbedding) && hasVectorArtifacts;
  let providerAvailable = false;

  if (annEnabledForMode && vectorActive) {
    const providers = getAnnProviders();
    const providerCount = providers instanceof Map ? providers.size : 0;
    annAdaptiveStrategy = resolveAnnAdaptiveStrategy({
      mode,
      queryTokens,
      candidatePolicy: annCandidatePolicy.explain,
      candidateSet: annCandidateBase,
      meta,
      searchTopN,
      expandedTopN,
      adaptiveProvidersEnabled,
      vectorOnlyProfile,
      filtersActive: filtersEnabled,
      providerCount,
      providerOrder: annOrder
    });
    const routedBackends = Array.isArray(annAdaptiveStrategy?.providerOrder)
      && annAdaptiveStrategy.providerOrder.length
      ? annAdaptiveStrategy.providerOrder
      : annOrder;
    const orderedBackends = providerRuntime.resolveAnnBackends(
      providers,
      mode,
      routedBackends,
      adaptiveProvidersEnabled
    );
    annMetrics.providerOrder = orderedBackends;
    annMetrics.providerAdaptive = adaptiveProvidersEnabled;
    const sparseRouteRequested = annAdaptiveStrategy.route === ANN_ADAPTIVE_ROUTE.SPARSE
      && !vectorOnlyProfile;
    const bypassToSparse = sparseRouteRequested;
    effectiveRoute = bypassToSparse ? ANN_ADAPTIVE_ROUTE.SPARSE : ANN_ADAPTIVE_ROUTE.VECTOR;
    if (!bypassToSparse) {
      for (const backend of orderedBackends) {
        const provider = providers.get(backend);
        if (!provider || typeof provider.query !== 'function') continue;
        if (typeof provider.preflight !== 'function' && providerRuntime.isProviderCoolingDown(provider, mode)) continue;
        let providerInitiallyAvailable = false;
        try {
          providerInitiallyAvailable = provider.isAvailable({ idx, mode, embedding: queryEmbedding }) === true;
        } catch {
          providerInitiallyAvailable = false;
        }
        if (!providerInitiallyAvailable) continue;
        const preflightOk = await providerRuntime.ensureProviderPreflight(provider, {
          idx,
          mode,
          embedding: queryEmbedding,
          signal
        });
        if (!preflightOk) continue;
        const resolveProviderAvailability = () => {
          try {
            return provider.isAvailable({ idx, mode, embedding: queryEmbedding }) === true;
          } catch {
            return false;
          }
        };
        const primaryResult = await runAnnQuery(provider, annCandidates);
        annHits = primaryResult.hits;
        if (primaryResult.succeeded && (annHits.length > 0 || resolveProviderAvailability())) {
          providerAvailable = true;
        }
        if (!annHits.length && shouldTryAnnFallback) {
          const fallbackCandidates = resolveAnnFallback();
          if (fallbackCandidates) {
            const fallbackResult = await runAnnQuery(provider, fallbackCandidates);
            annHits = fallbackResult.hits;
            if (fallbackResult.succeeded && (annHits.length > 0 || resolveProviderAvailability())) {
              providerAvailable = true;
            }
          }
        }
        if (annHits.length) {
          annSource = provider?.id || backend;
          break;
        }
      }
    } else {
      providerAvailable = providerCount > 0;
    }
    if (!providerAvailable && !bypassToSparse && annCandidateBase && annCandidateBase.size > 0) {
      warnAnnFallback(`Vector ANN unavailable for ${mode}.`);
      warned = true;
    }
  }

  const bypassedToSparse = effectiveRoute === ANN_ADAPTIVE_ROUTE.SPARSE;

  if (annEnabledForMode && !annHits.length && !bypassedToSparse) {
    const adaptiveTopN = Number.isFinite(Number(annAdaptiveStrategy?.budget?.topN))
      ? Math.max(1, Math.floor(Number(annAdaptiveStrategy.budget.topN)))
      : expandedTopN;
    let minhashCandidates = annCandidatePolicy.set;
    if (
      annCandidatePolicy.reason === ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX
      && annCandidateBase
      && annCandidateBase.size > 0
      && filtersEnabled
      && allowedIdx
    ) {
      const bmConstrainedCandidates = candidatePool.acquire();
      for (const candidateId of annCandidateBase) {
        if (hasAllowedId(allowedIdx, candidateId)) {
          bmConstrainedCandidates.add(candidateId);
        }
      }
      trackReleaseSet(bmConstrainedCandidates);
      const policySetSize = annCandidatePolicy.set ? annCandidatePolicy.set.size : 0;
      if (
        bmConstrainedCandidates.size > 0
        && minhashLimit
        && policySetSize > minhashLimit
        && bmConstrainedCandidates.size <= minhashLimit
      ) {
        minhashCandidates = bmConstrainedCandidates;
      }
    }
    const minhashFallback = annFallback;
    const minhashCandidatesEmpty = minhashCandidates && minhashCandidates.size === 0;
    const minhashTotal = minhashCandidates
      ? minhashCandidates.size
      : (idx.minhash?.signatures?.length || 0);
    const allowMinhashCandidates = minhashTotal > 0 && (!minhashLimit || minhashTotal <= minhashLimit);
    const minhashFallbackTotal = shouldTryAnnFallback ? allowedCount : 0;
    const allowMinhashFallback = minhashFallbackTotal > 0
      && (!minhashLimit || minhashFallbackTotal <= minhashLimit);
    if (allowMinhashCandidates && !minhashCandidatesEmpty) {
      annHits = rankMinhash(idx, queryTokens, adaptiveTopN, minhashCandidates);
      if (annHits.length) annSource = 'minhash';
    }
    if (!annHits.length && allowMinhashFallback) {
      const fallbackCandidates = minhashFallback || resolveAnnFallback();
      if (fallbackCandidates) {
        annHits = rankMinhash(idx, queryTokens, adaptiveTopN, fallbackCandidates);
        if (annHits.length) annSource = 'minhash';
      }
    }
  }

  annMetrics.vectorActive = vectorActive;
  annMetrics.hits = annHits.length;
  annMetrics.source = annSource;
  annMetrics.warned = warned;
  annMetrics.candidates = annCandidateBase ? annCandidateBase.size : null;
  annMetrics.providerAvailable = providerAvailable;
  annMetrics.profileId = profileId;
  annMetrics.vectorOnlyProfile = vectorOnlyProfile;
  annMetrics.candidatePolicyConfig = annCandidatePolicyConfig;
  annMetrics.candidatePolicy = annCandidatePolicy.explain;
  annMetrics.route = effectiveRoute;
  annMetrics.routeReason = annAdaptiveStrategy?.routeReason || null;
  annMetrics.orderReason = annAdaptiveStrategy?.orderReason || null;
  annMetrics.budget = annAdaptiveStrategy?.budget || null;
  annMetrics.features = annAdaptiveStrategy?.features || null;
  annMetrics.bypassedToSparse = bypassedToSparse;

  const annCapabilityUnavailable = !vectorActive || !providerAvailable;
  const emptyIndex = !Array.isArray(meta) || meta.length === 0;
  if (vectorOnlyProfile && !emptyIndex && annCapabilityUnavailable && !annHits.length) {
    const capabilityReason = !vectorActive ? 'ann_capability_unavailable' : 'ann_provider_unavailable';
    throw createError(
      ERROR_CODES.CAPABILITY_MISSING,
      `Vector-only search requires ANN/vector providers for mode "${mode}", but none were available. ` +
        'Rebuild embeddings and ensure at least one ANN provider is configured.',
      {
        reasonCode: VECTOR_REQUIRED_CODE,
        reason: capabilityReason,
        mode,
        profileId,
        providerAvailable,
        vectorActive
      }
    );
  }

  return { annHits, annSource, annCandidatePolicy: annCandidatePolicy.explain, candidates };
};

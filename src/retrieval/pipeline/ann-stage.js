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
import { throwIfAborted } from '../../shared/abort.js';
import { observeAnnAttemptFailure, observeRetrievalProviderFailure } from './provider-failure.js';
import { createEligibilityPlan } from './eligibility-plan.js';
import { rankDenseVectorsAsync } from '../rankers.js';
import { createCountAwareAnnWork, planCountAwareAnn, snapshotCountAwareStoredDense } from './count-aware-ann.js';

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
  annDiscovery = 'independent',
  matchesQueryAst,
  hasHardSemanticConstraints = false,
  eligibilityPlan = null,
  countAwarePolicy = null,
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
  throwIfAborted(signal);
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

  if (!['independent', 'lexical-rerank'].includes(annDiscovery)) throw new TypeError('Invalid ANN discovery mode');
  const independentDiscovery = annDiscovery === 'independent';
  if (countAwarePolicy && !independentDiscovery) throw new TypeError('Count-aware ANN planning requires independent discovery.');
  let eligibleIds = allowedIdx;
  if (hasHardSemanticConstraints) {
    const eligibility = eligibilityPlan || createEligibilityPlan({ idx, meta, mode, queryAst: null,
      allowedIdx, matchesQueryAst, throwIfAborted: () => throwIfAborted(signal) });
    eligibleIds = eligibility.evaluate({ semantic: true });
    annMetrics.eligibility = eligibility.statistics;
  }
  const eligibilityActive = filtersEnabled || hasHardSemanticConstraints;
  const annCandidateBase = independentDiscovery ? null : ensureCandidateBase();
  const annCandidatePolicy = resolveAnnCandidateSet({
    candidates: annCandidateBase,
    allowedIds: eligibleIds,
    filtersActive: eligibilityActive,
    cap: annCandidatePolicyConfig.cap,
    minDocCount: annCandidatePolicyConfig.minDocCount,
    maxDocCount: annCandidatePolicyConfig.maxDocCount,
    toSet: ensureAllowedSet
  });
  const annCandidates = annCandidatePolicy.set;
  const countPlan = countAwarePolicy ? planCountAwareAnn({ policy: countAwarePolicy,
    eligibleIds: eligibilityActive ? eligibleIds : null,
    documentCount: eligibilityActive && eligibleIds == null ? null : Number.isSafeInteger(meta?.length) ? meta.length : null,
    dims: idx?.denseVec?.dims, storedDenseAvailable: isDenseVectorPayloadAvailable(idx?.denseVec), requestedTopN: expandedTopN }) : null;
  const countWork = countPlan ? createCountAwareAnnWork({ policy: countAwarePolicy, plan: countPlan, signal }) : null;
  let countHandled = countPlan?.route === 'empty', exactStored = false;
  if (countWork) annCandidatePolicy.explain = { ...annCandidatePolicy.explain, countAwarePolicyKey: countAwarePolicy.key };
  if (independentDiscovery) {
    annCandidatePolicy.reason = 'independentDiscovery';
    annCandidatePolicy.explain = {...annCandidatePolicy.explain, reason:'independentDiscovery', discovery:annDiscovery};
  }
  const shouldTryAnnFallback = !independentDiscovery && eligibilityActive
    && Boolean(allowedIdx)
    && annCandidatePolicy.reason !== ANN_CANDIDATE_POLICY_REASONS.FILTERS_ACTIVE_ALLOWED_IDX;
  let annFallbackResolved = false;
  let annFallback = null;
  const resolveAnnFallback = () => {
    if (!shouldTryAnnFallback) return null;
    if (!annFallbackResolved) {
      annFallback = eligibleIds;
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

  /**
   * @param {import('../ann/types.js').AnnProvider|null} provider
   * @param {import('../ann/types.js').AnnCandidateSet|null} candidateSet
   * @param {number|null} [requestedTopN]
   */
  const runAnnQuery = async (provider, candidateSet, requestedTopN = null) => {
    throwIfAborted(signal);
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
    const resolvedTopN = requestedTopN ?? (Number.isFinite(adaptiveTopN) && adaptiveTopN > 0
      ? Math.max(1, Math.floor(adaptiveTopN))
      : expandedTopN);
    const reservation = countWork?.reserve(provider.id, resolvedTopN);
    if (countWork && !reservation) return { hits: [], succeeded: false, budgetEnded: true };
    const normalizedCandidateSet = normalizeAnnCandidateSet(provider, candidateSet);
    const startedAtNs = process.hrtime.bigint();
    try {
      const hits = await provider.query({
        idx,
        mode,
        embedding: queryEmbedding,
        topN: resolvedTopN,
        candidateSet: normalizedCandidateSet,
        signal: reservation?.signal || signal,
        budget: requestedTopN == null ? annAdaptiveStrategy?.budget || null : {
          ...annAdaptiveStrategy?.budget, providerTopN: { ...annAdaptiveStrategy?.budget?.providerTopN, [providerId]: resolvedTopN } },
        route: annAdaptiveStrategy?.route || null,
        features: annAdaptiveStrategy?.features || null
      });
      throwIfAborted(signal);
      if (reservation?.timeout.aborted) {
        reservation.attempt.status = 'deadline'; countWork.receipt.reasonEnded = 'deadline';
        return { hits: [], succeeded: false, budgetEnded: true };
      }
      if (reservation) { reservation.attempt.status = 'returned'; reservation.attempt.returned = hits?.length || 0; }
      const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
      providerRuntime.recordProviderSuccess(provider, mode, { latencyMs: elapsedMs });
      const admitted = normalizeAnnHits(hits);
      let accepted = admitted;
      if (countWork) {
        const distinct = new Map();
        for (const hit of admitted) {
          if (!Number.isSafeInteger(hit.idx) || hit.idx < 0 || hit.idx >= meta.length
            || eligibilityActive && eligibleIds && !hasAllowedId(eligibleIds, hit.idx) || distinct.has(hit.idx)) continue;
          distinct.set(hit.idx, hit);
          if (distinct.size === resolvedTopN) break;
        }
        accepted = [...distinct.values()];
      }
      if (reservation) reservation.attempt.accepted = accepted.length;
      return { hits: accepted, succeeded: true, topN: resolvedTopN };
    } catch (err) {
      const failure = observeAnnAttemptFailure(err, { signal, timeout: reservation?.timeout });
      if (failure.deadline) {
        reservation.attempt.status = 'deadline'; countWork.receipt.reasonEnded = 'deadline';
        return { hits: [], succeeded: false, budgetEnded: true };
      }
      if (reservation) { reservation.attempt.status = 'failed'; reservation.attempt.reason = failure.code || failure.message || 'provider-error'; }
      try { providerRuntime.recordProviderFailure(provider, mode, failure.message || 'query failed'); }
      catch (inspection) { throw failure.retain(inspection, { inspectionPresent: true }); }
      failure.requireSettled();
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
  let vectorActive = annEnabledForMode && (typeof queryEmbedding === 'function' || isEmbeddingReady(queryEmbedding)) && hasVectorArtifacts;
  let providerAvailable = countHandled;

  if (annEnabledForMode && vectorActive && !countHandled) {
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
      independentDiscovery,
      vectorOnlyProfile,
      filtersActive: eligibilityActive,
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
      if (typeof queryEmbedding === 'function') queryEmbedding = await queryEmbedding();
      vectorActive = isEmbeddingReady(queryEmbedding);
      if (vectorActive && countPlan?.route === 'stored-exhaustive'
        && queryEmbedding.length === idx.denseVec.dims && Array.from(queryEmbedding).every(Number.isFinite)) {
        const snapshot = snapshotCountAwareStoredDense({ dense: idx.denseVec, eligibleIds: eligibilityActive ? annCandidates : null,
          documentCount: meta.length, policy: countAwarePolicy, signal });
        const reservation = snapshot ? countWork.reserve(ANN_PROVIDER_IDS.DENSE, countPlan.target, { exact: true }) : null;
        if (!snapshot) { countWork.receipt.route = 'ann'; countWork.receipt.reason = 'stored-coverage-or-quantization-unqualified'; }
        else if (!reservation) { countHandled = true; providerAvailable = true; }
        else {
          const metrics = {};
          countWork.receipt.retainedVectorBytes = snapshot.retainedVectorBytes;
          try {
            // No full-corpus lazy load is authorized by a small eligible count.
            const exactHits = await rankDenseVectorsAsync(snapshot.index, Array.from(queryEmbedding),
              countPlan.target, null, { signal: reservation.signal, metrics });
            annHits = exactHits.map(hit => { hit.idx = snapshot.sourceIds[hit.idx]; return hit; });
            countWork.receipt.retainedVectorBytes = snapshot.retainedVectorBytes;
            reservation.attempt.status = 'returned'; reservation.attempt.returned = annHits.length;
            exactStored = true; countHandled = true; providerAvailable = true; annSource = ANN_PROVIDER_IDS.DENSE;
            countWork.finish({ hits: annHits, exact: true, metrics });
          } catch (error) {
            const failure = observeAnnAttemptFailure(error, { signal, timeout: reservation.timeout });
            if (failure.deadline) {
              countWork.receipt.reasonEnded = 'deadline'; reservation.attempt.status = 'deadline'; countHandled = true; providerAvailable = true;
              countWork.finish({ hits: [], metrics });
            } else {
              reservation.attempt.status = 'failed'; reservation.attempt.reason = failure.code || failure.message || 'stored-scan-error';
              countWork.receipt.route = 'ann'; countWork.receipt.reason = 'stored-scan-unavailable';
            }
          }
        }
      } else if (countPlan?.route === 'stored-exhaustive') {
        countWork.receipt.route = 'ann'; countWork.receipt.reason = 'query-vector-not-qualified-for-stored-metric';
      }
      for (const backend of vectorActive && !countHandled ? orderedBackends : []) {
        const provider = providers.get(backend);
        if (!provider || typeof provider.query !== 'function') continue;
        if (typeof provider.preflight !== 'function' && providerRuntime.isProviderCoolingDown(provider, mode)) continue;
        let providerInitiallyAvailable = false;
        try {
          providerInitiallyAvailable = provider.isAvailable({ idx, mode, embedding: queryEmbedding }) === true;
        } catch (error) {
          const failure = observeRetrievalProviderFailure(error);
          throwIfAborted(signal);
          if (failure.abort) throw error;
          failure.requireSettled();
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
          } catch (error) {
            const failure = observeRetrievalProviderFailure(error);
            throwIfAborted(signal);
            if (failure.abort) throw error;
            failure.requireSettled();
            return false;
          }
        };
        const primaryResult = await runAnnQuery(provider, annCandidates);
        annHits = primaryResult.hits;
        if (countWork && provider.capabilities?.progressiveEffort === true && primaryResult.succeeded) {
          let effort = primaryResult.topN || expandedTopN;
          while (annHits.length < countPlan.target && effort < countAwarePolicy.maxTopN) {
            const nextEffort = Math.min(countAwarePolicy.maxTopN, Math.max(effort + 1, effort * 2));
            const retry = await runAnnQuery(provider, annCandidates, nextEffort);
            if (retry.budgetEnded) break;
            const merged = new Map(annHits.map(hit => [hit.idx, hit]));
            for (const hit of retry.hits) if (!merged.has(hit.idx) || hit.sim > merged.get(hit.idx).sim) merged.set(hit.idx, hit);
            annHits = normalizeAnnHits([...merged.values()]).slice(0, countPlan.target); effort = nextEffort;
          }
        }
        if ((primaryResult.succeeded || primaryResult.budgetEnded) && (annHits.length > 0 || resolveProviderAvailability())) {
          providerAvailable = true;
        }
        if (primaryResult.budgetEnded || countWork?.receipt.reasonEnded === 'deadline') break;
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
    if (!providerAvailable && !bypassToSparse && (independentDiscovery || annCandidateBase?.size > 0)) {
      warnAnnFallback(`Vector ANN unavailable for ${mode}.`);
      warned = true;
    }
  }

  const bypassedToSparse = effectiveRoute === ANN_ADAPTIVE_ROUTE.SPARSE;

  throwIfAborted(signal);
  if (annEnabledForMode && !vectorOnlyProfile && !annHits.length && !bypassedToSparse && !countWork) {
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
  if (countWork) annMetrics.countAware = { ...countWork.finish({ hits: annHits, exact: exactStored, empty: countPlan.route === 'empty' }),
    selectedGeneration: idx.generationTag?.buildGenerationKey || idx.generationTag?.buildId || idx.state?.buildId || null,
    embeddingGeneration: idx.state?.embeddings?.embeddingGeneration || null };

  const annCapabilityUnavailable = countPlan?.route !== 'empty' && (!vectorActive || !providerAvailable);
  const emptyIndex = !Array.isArray(meta) || meta.length === 0;
  if (vectorOnlyProfile && !emptyIndex && annCapabilityUnavailable) {
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

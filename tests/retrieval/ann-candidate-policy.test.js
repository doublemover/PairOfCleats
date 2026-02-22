#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ANN_ADAPTIVE_ORDER_REASONS,
  ANN_ADAPTIVE_ROUTE,
  ANN_ADAPTIVE_ROUTE_REASONS,
  ANN_CANDIDATE_POLICY_REASONS,
  resolveAnnAdaptiveStrategy,
  resolveAnnCandidateSet
} from '../../src/retrieval/scoring/ann-candidate-policy.js';

const noCandidates = resolveAnnCandidateSet({
  candidates: null,
  filtersActive: false
});
assert.equal(noCandidates.reason, ANN_CANDIDATE_POLICY_REASONS.NO_CANDIDATES, 'unexpected no-candidates reason');
assert.equal(noCandidates.set, null, 'expected full-mode candidate path when no candidates');

const noCandidatesFilteredEmptyAllowlist = resolveAnnCandidateSet({
  candidates: null,
  allowedIds: new Set(),
  filtersActive: true
});
assert.equal(
  noCandidatesFilteredEmptyAllowlist.reason,
  ANN_CANDIDATE_POLICY_REASONS.NO_CANDIDATES,
  'unexpected no-candidates reason for empty filtered allowlist'
);
assert.equal(
  noCandidatesFilteredEmptyAllowlist.set?.size,
  0,
  'expected empty filtered allowlist to stay constrained (empty set)'
);
assert.equal(
  noCandidatesFilteredEmptyAllowlist.explain.outputMode,
  'constrained',
  'expected empty filtered allowlist to avoid full-mode fallback'
);

const tooLarge = resolveAnnCandidateSet({
  candidates: new Set(Array.from({ length: 50 }, (_, i) => i)),
  filtersActive: false,
  cap: 40,
  minDocCount: 5,
  maxDocCount: 100
});
assert.equal(tooLarge.reason, ANN_CANDIDATE_POLICY_REASONS.TOO_LARGE, 'unexpected too-large reason');
assert.equal(tooLarge.set, null, 'expected too-large candidate policy to return full mode');

const tooLargeWithFilters = resolveAnnCandidateSet({
  candidates: new Set(Array.from({ length: 50 }, (_, i) => i)),
  allowedIds: new Set(Array.from({ length: 100 }, (_, i) => i)),
  filtersActive: true,
  cap: 40,
  minDocCount: 5,
  maxDocCount: 100
});
assert.equal(
  tooLargeWithFilters.reason,
  ANN_CANDIDATE_POLICY_REASONS.TOO_LARGE,
  'expected too-large reason when filtered candidate set exceeds cap'
);
assert.equal(
  tooLargeWithFilters.set?.size,
  50,
  'expected too-large filtered candidate set to stay constrained under active filters'
);
assert.equal(
  tooLargeWithFilters.explain.outputMode,
  'constrained',
  'expected constrained output mode when filters are active'
);

const tooSmallNoFilters = resolveAnnCandidateSet({
  candidates: new Set([1, 2, 3]),
  filtersActive: false,
  minDocCount: 10,
  maxDocCount: 100
});
assert.equal(
  tooSmallNoFilters.reason,
  ANN_CANDIDATE_POLICY_REASONS.TOO_SMALL_NO_FILTERS,
  'unexpected too-small reason'
);
assert.equal(tooSmallNoFilters.set, null, 'expected too-small policy to return full mode');

const ok = resolveAnnCandidateSet({
  candidates: new Set(Array.from({ length: 16 }, (_, i) => i)),
  filtersActive: false,
  minDocCount: 10,
  maxDocCount: 100
});
assert.equal(ok.reason, ANN_CANDIDATE_POLICY_REASONS.OK, 'unexpected ok reason');
assert.equal(ok.set?.size, 16, 'expected constrained candidate set');

const adaptiveSmallIndex = resolveAnnAdaptiveStrategy({
  mode: 'code',
  queryTokens: ['alpha'],
  candidatePolicy: ok.explain,
  candidateSet: new Set([1, 2, 3]),
  meta: Array.from({ length: 12 }),
  searchTopN: 5,
  expandedTopN: 15,
  adaptiveProvidersEnabled: true,
  vectorOnlyProfile: false,
  filtersActive: false,
  providerCount: 2,
  providerOrder: ['lancedb', 'sqlite-vector', 'hnsw', 'js']
});
assert.equal(
  adaptiveSmallIndex.route,
  ANN_ADAPTIVE_ROUTE.SPARSE,
  'expected sparse bypass route for very small index'
);
assert.equal(
  adaptiveSmallIndex.routeReason,
  ANN_ADAPTIVE_ROUTE_REASONS.SMALL_INDEX_BYPASS,
  'expected small-index bypass reason'
);

const adaptiveSymbolQuery = resolveAnnAdaptiveStrategy({
  mode: 'code',
  queryTokens: ['::$$##'],
  candidatePolicy: ok.explain,
  candidateSet: new Set(Array.from({ length: 512 }, (_, i) => i)),
  meta: Array.from({ length: 20000 }),
  searchTopN: 10,
  expandedTopN: 30,
  adaptiveProvidersEnabled: true,
  vectorOnlyProfile: false,
  filtersActive: false,
  providerCount: 4,
  providerOrder: ['lancedb', 'sqlite-vector', 'hnsw', 'js']
});
assert.equal(
  adaptiveSymbolQuery.orderReason,
  ANN_ADAPTIVE_ORDER_REASONS.SYMBOL_HEAVY_QUERY,
  'expected symbol-heavy order reason'
);
assert.equal(
  adaptiveSymbolQuery.providerOrder[0],
  'hnsw',
  'expected hnsw to be preferred for symbol-heavy query class'
);
assert.ok(
  adaptiveSymbolQuery.budget.hnswEfSearch >= 24,
  'expected hnsw efSearch budget floor'
);
assert.ok(
  adaptiveSymbolQuery.budget.providerTopN.lancedb >= adaptiveSymbolQuery.budget.providerTopN.hnsw,
  'expected lancedb to receive equal/higher probe budget'
);

const adaptiveDisabled = resolveAnnAdaptiveStrategy({
  mode: 'code',
  queryTokens: ['alpha'],
  candidatePolicy: ok.explain,
  candidateSet: new Set([1, 2, 3]),
  meta: Array.from({ length: 200 }),
  searchTopN: 5,
  expandedTopN: 15,
  adaptiveProvidersEnabled: false,
  vectorOnlyProfile: false,
  filtersActive: false,
  providerCount: 4,
  providerOrder: ['lancedb', 'sqlite-vector', 'hnsw', 'js']
});
assert.equal(
  adaptiveDisabled.route,
  ANN_ADAPTIVE_ROUTE.VECTOR,
  'expected vector route when adaptive path is disabled'
);
assert.equal(
  adaptiveDisabled.routeReason,
  ANN_ADAPTIVE_ROUTE_REASONS.ADAPTIVE_DISABLED,
  'expected adaptive-disabled route reason'
);

console.log('ann candidate policy test passed');

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../../shared/stable-json.js';

export const SHADOW_ROUTING_VERSION = 1;
const hash = /^[a-f0-9]{64}$/u;
const classes = new Set(['symbol-or-path', 'explicit-boolean-or-phrase', 'natural-language', 'semantic-fact', 'unknown']);
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const policy = Object.freeze({ version: SHADOW_ROUTING_VERSION, astNodes: 256, queryChars: 4096,
  repos: 32, candidates: 2048, outputBytes: 65536, work: 200000, maxMs: 100 });
export const SHADOW_ROUTING_POLICY_KEY = digest(policy);
const incomplete = reason => ({ schemaVersion: SHADOW_ROUTING_VERSION, policyKey: SHADOW_ROUTING_POLICY_KEY,
  authoritative: false, complete: false, reason, proposal: null, metrics: null });

/** Feature-only heuristic proposal. No raw query/source is retained in reports,
 * and explicit syntax never becomes fuzzy structural/type/literal evidence.
 */
export const shadowQueryRoute = ({ query, queryAst = null, requestKind = 'text', signal = null } = {}) => {
  if (signal?.aborted) return incomplete('cancelled');
  if (typeof query !== 'string' || query.length > policy.queryChars) return incomplete('query-bound');
  const started = performance.now(), stack = [queryAst], seen = new WeakSet();
  const features = { explicitBoolean: false, phrase: false, path: false, symbol: false,
    naturalLanguageTokens: 0, structuralRequest: requestKind === 'semantic-find', visitedAstNodes: 0 };
  while (stack.length) {
    if (signal?.aborted || performance.now() - started > policy.maxMs) return incomplete(signal?.aborted ? 'cancelled' : 'deadline');
    const node = stack.pop(); if (node == null) continue;
    if (typeof node !== 'object' || seen.has(node) || ++features.visitedAstNodes > policy.astNodes) return incomplete('ast-bound-or-cycle');
    seen.add(node);
    if (['type', 'grouped', 'implicit', 'left', 'right', 'child'].some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      return descriptor && !Object.hasOwn(descriptor, 'value');
    })) return incomplete('unsupported-ast-accessor');
    if (node.type === 'phrase') features.phrase = true;
    if (node.grouped || node.type === 'or' || node.type === 'not' || node.type === 'and' && node.implicit !== true) features.explicitBoolean = true;
    for (const key of ['left', 'right', 'child']) {
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) return incomplete('unsupported-ast-accessor');
      if (descriptor?.value != null) stack.push(descriptor.value);
    }
  }
  const text = query.trim();
  features.path = /^(?:[\w.@-]+[\\/])+[^\s]+$/u.test(text) || /^[\w.@-]+\.[A-Za-z0-9]{1,12}$/u.test(text);
  features.symbol = /^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:::|\.)[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(text);
  features.naturalLanguageTokens = text.split(/\s+/u).filter(token => /^[A-Za-z][A-Za-z'-]*$/u.test(token)).length;
  const label = features.structuralRequest ? 'semantic-fact' : features.explicitBoolean || features.phrase ? 'explicit-boolean-or-phrase'
    : features.path || features.symbol ? 'symbol-or-path' : features.naturalLanguageTokens >= 3 ? 'natural-language' : 'unknown';
  const proposal = label === 'semantic-fact' ? 'existing-semantic-find-request-only'
    : label === 'explicit-boolean-or-phrase' ? 'existing-hybrid-with-explicit-constraints'
      : label === 'symbol-or-path' ? 'shadow-lexical-effort-preference'
        : label === 'natural-language' ? 'shadow-dense-effort-preference' : 'existing-hybrid-abstain';
  return Object.freeze({ schemaVersion: SHADOW_ROUTING_VERSION, policyKey: SHADOW_ROUTING_POLICY_KEY,
    authoritative: false, complete: true, label, abstained: label === 'unknown', proposal,
    calibration: 'unqualified-heuristic;not-production-confidence', features: Object.freeze(features),
    privacy: 'bounded-features-only;no-raw-query-or-source', executionChanged: false });
};

/** Frozen saved candidates only. Compatibility cohorts and expected generation
 * witnesses must be explicit; no retrieval, native provider or extra repo call.
 */
export const simulateShadowAllocation = ({ snapshot, expectedWorkspaceKey, expectedQueryKey, expectedGenerations,
  queryClass = 'unknown', budget, floor = 1, signal = null } = {}) => {
  const started = performance.now(); let work = 0;
  const stop = () => signal?.aborted ? 'cancelled' : performance.now() - started > policy.maxMs ? 'deadline' : work > policy.work ? 'work' : null;
  if (stop()) return incomplete(stop());
  if (!snapshot || snapshot.schemaVersion !== SHADOW_ROUTING_VERSION || !hash.test(expectedWorkspaceKey || '')
    || snapshot.workspaceKey !== expectedWorkspaceKey || !hash.test(expectedQueryKey || '') || snapshot.queryKey !== expectedQueryKey
    || !classes.has(queryClass) || !Array.isArray(snapshot.cohorts) || snapshot.cohorts.length > 16
    || !Number.isSafeInteger(budget) || budget < 0 || budget > policy.candidates
    || !Number.isSafeInteger(floor) || floor < 1 || floor > 64) return incomplete('snapshot-or-policy-admission');
  const cohorts = [], seenRepos = new Set(), seenCohorts = new Set(); let candidateCount = 0;
  for (const cohort of snapshot.cohorts) {
    if (!cohort || typeof cohort.id !== 'string' || !cohort.id || cohort.id.length > 128 || seenCohorts.has(cohort.id)
      || !hash.test(cohort.signature || '') || !Array.isArray(cohort.repos)) return incomplete('cohort-admission');
    seenCohorts.add(cohort.id);
    const repos = [];
    for (const row of cohort.repos) {
      if (stop()) return incomplete(stop());
      if (!row || typeof row.repoId !== 'string' || !row.repoId || row.repoId.length > 256 || seenRepos.has(row.repoId)
        || seenRepos.size >= policy.repos || !hash.test(row.generation || '') || expectedGenerations?.[row.repoId] !== row.generation
        || !Array.isArray(row.candidates) || row.candidates.length > 64) return incomplete('repository-generation-admission');
      seenRepos.add(row.repoId); const keys = new Set(); let sparse = 0, dense = 0;
      const candidates = [];
      for (const [index, candidate] of row.candidates.entries()) {
        work++; candidateCount++;
        if (candidateCount > policy.candidates || !candidate || !hash.test(candidate.key || '') || keys.has(candidate.key)
          || candidate.sourceRank !== index + 1 || typeof candidate.sparse !== 'boolean' || typeof candidate.dense !== 'boolean'
          || candidate.relevance !== null && (!Number.isInteger(candidate.relevance) || candidate.relevance < 0 || candidate.relevance > 4)) return incomplete('candidate-admission');
        keys.add(candidate.key); sparse += Number(candidate.sparse); dense += Number(candidate.dense);
        candidates.push({ key: candidate.key, sourceRank: candidate.sourceRank, relevance: candidate.relevance });
      }
      const evidence = queryClass === 'natural-language' ? sparse + dense * 2
        : queryClass === 'symbol-or-path' ? sparse * 2 + dense : sparse + dense;
      repos.push({ repoId: row.repoId, generation: row.generation, candidates, weight: 1 + Math.log2(1 + evidence) });
    }
    repos.sort((a, b) => a.repoId.localeCompare(b.repoId));
    cohorts.push({ id: cohort.id, signature: cohort.signature, repos });
  }
  cohorts.sort((a, b) => a.id.localeCompare(b.id));
  const repos = cohorts.flatMap(cohort => cohort.repos), available = repos.reduce((sum, repo) => sum + repo.candidates.length, 0);
  const target = Math.min(budget, available), minimum = repos.reduce((sum, repo) => sum + Math.min(floor, repo.candidates.length), 0);
  if (minimum > target) return incomplete('exploration-floor-exceeds-budget');
  const allocate = weighted => {
    const quotas = new Map(repos.map(repo => [repo.repoId, Math.min(floor, repo.candidates.length)]));
    let assigned = minimum;
    while (assigned < target) {
      if (stop()) return null;
      let best = null, priority = -Infinity;
      for (const repo of repos) {
        work++; const count = quotas.get(repo.repoId); if (count >= repo.candidates.length) continue;
        const score = (weighted ? repo.weight : 1) / (count + 1);
        if (score > priority) { best = repo; priority = score; }
      }
      if (!best) break;
      quotas.set(best.repoId, quotas.get(best.repoId) + 1); assigned++;
    }
    return quotas;
  };
  const fixed = allocate(false), proposed = fixed ? allocate(true) : null;
  if (!fixed || !proposed || stop()) return incomplete(stop() || 'allocation-incomplete');
  const summarize = quotas => {
    let relevantRepos = 0, coveredRepos = 0, gain = 0, unknown = 0;
    for (const repo of repos) {
      const selected = repo.candidates.slice(0, quotas.get(repo.repoId));
      if (repo.candidates.some(candidate => candidate.relevance > 0)) relevantRepos++;
      if (selected.some(candidate => candidate.relevance > 0)) coveredRepos++;
      for (const candidate of repo.candidates) if (candidate.relevance === null) unknown++;
      gain += selected.reduce((sum, candidate) => sum + (candidate.relevance || 0), 0);
    }
    return { gradedGain: unknown ? null : gain, relevantRepositoryCoverage: unknown || !relevantRepos ? null : coveredRepos / relevantRepos,
      knownRelevantRepos: relevantRepos, selectedKnownRelevantRepos: coveredRepos, unknownJudgments: unknown };
  };
  const controlMetrics = summarize(fixed), proposalMetrics = summarize(proposed);
  const body = { schemaVersion: SHADOW_ROUTING_VERSION, policyKey: SHADOW_ROUTING_POLICY_KEY, authoritative: false,
    complete: true, workspaceKey: expectedWorkspaceKey, queryKey: expectedQueryKey, queryClass, budget, floor, target, available,
    cohorts: cohorts.map(cohort => ({ id: cohort.id, signature: cohort.signature, repos: cohort.repos.map(repo => ({ repoId: repo.repoId,
      generation: repo.generation, fixedQuota: fixed.get(repo.repoId), proposedQuota: proposed.get(repo.repoId),
      selectedKeys: repo.candidates.slice(0, proposed.get(repo.repoId)).map(row => row.key) })) })),
    metrics: { control: controlMetrics, proposed: proposalMetrics,
      gradedGainDifference: controlMetrics.gradedGain === null ? null : proposalMetrics.gradedGain - controlMetrics.gradedGain },
    work: { units: work, repositories: repos.length, savedCandidates: candidateCount },
    cost: 'saved-pool-simulation;native-retrieval-latency-unmeasured', promotion: 'none' };
  return Buffer.byteLength(JSON.stringify(body)) > policy.outputBytes ? incomplete('output-bytes') : body;
};

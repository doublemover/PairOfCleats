import { normalizeArchitectureRules, architectureRuleInputError } from '../contracts/architecture-rules.js';
import { normalizeCrossFileCoverage, crossFileCoverageWarning } from '../index/cross-file-fidelity.js';
import picomatch from 'picomatch';
import { compareStrings } from '../shared/sort.js';
import { normalizeCap } from '../shared/limits.js';
import { normalizePathForRepo } from '../shared/path-normalize.js';
import { resolveProvenance } from '../shared/provenance.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import { performance } from 'node:perf_hooks';
import { ARCHITECTURE_REPORT_VERSION, architecturePolicyReceipt, architectureViolationEvidence } from '../contracts/architecture-evidence.js';
import { architectureNeighbors, createArchitectureMatchOwner, createArchitectureWork } from './architecture-work.js';

const compiledRuleCache = new Map();
let compiledPolicyBytes = 0;
const orderedNodeCache = new WeakMap();

const buildMatcherSet = (patterns, identity, field) => patterns.map((pattern, index) => {
  try { return picomatch(pattern, { dot: true }); }
  catch (cause) { throw architectureRuleInputError({ ...identity, propertyPath: `${identity.propertyPath}.${field}[${index}]`,
    message: 'glob compilation failed', cause }); }
});

const compilePathSelector = (selector, identity) => {
  const anyOf = selector.anyOf || [], noneOf = selector.noneOf || [];
  const anyMatchers = buildMatcherSet(anyOf, identity, 'anyOf');
  const noneMatchers = buildMatcherSet(noneOf, identity, 'noneOf');
  return { anyOf, noneOf, matches: (target, work = null) => {
    if (work) work.selectorCalls++;
    if (!target) return false;
    const value = String(target);
    const match = matcher => { if (work) work.predicateCalls++; return matcher(value); };
    if (anyMatchers.length && !anyMatchers.some(match)) return false;
    if (noneMatchers.some(match)) return false;
    return true;
  } };
};

const compileRules = rules => rules.map((rule, ruleIndex) => {
  const base = { id: rule.id, ruleIndex, type: rule.type, severity: rule.severity, message: rule.message };
  const identity = { ruleId: rule.id, ruleIndex };
  if (rule.type === 'layering') return { ...base, layers: rule.layers.map((layer, index) => ({ name: layer.name,
    matcher: compilePathSelector(layer.match, { ...identity, propertyPath: `rules[${ruleIndex}].layers[${index}].match` }) })) };
  return { ...base, from: compilePathSelector(rule.from, { ...identity, propertyPath: `rules[${ruleIndex}].from` }),
    to: compilePathSelector(rule.to, { ...identity, propertyPath: `rules[${ruleIndex}].to` }) };
});

const buildNodeIndex = (graph) => {
  const map = new Map();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!node?.id) continue;
    map.set(node.id, node);
  }
  return map;
};

const buildOrderedNodes = (nodeIndex) => {
  const nodes = Array.from(nodeIndex.values());
  nodes.sort((a, b) => compareStrings(String(a?.id || ''), String(b?.id || '')));
  return nodes;
};

const resolveCompiledRules = (rules, policy, work) => {
  const cached = compiledRuleCache.get(policy.receipt.digest);
  if (cached) {
    compiledRuleCache.delete(policy.receipt.digest); compiledRuleCache.set(policy.receipt.digest, cached);
    work.policyCompilationHits++; return cached.compiled;
  }
  work.policyCompilations++;
  const compiled = compileRules(rules), bytes = policy.encoded.length * 2;
  if (bytes <= 4 * 1024 * 1024) {
    while (compiledRuleCache.size && (compiledRuleCache.size >= 16 || compiledPolicyBytes + bytes > 4 * 1024 * 1024)) {
      const oldest = compiledRuleCache.keys().next().value;
      compiledPolicyBytes -= compiledRuleCache.get(oldest).bytes; compiledRuleCache.delete(oldest);
    }
    compiledRuleCache.set(policy.receipt.digest, { compiled, bytes }); compiledPolicyBytes += bytes;
  }
  return compiled;
};

const resolveOrderedNodes = (graphRelations, work) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  if (orderedNodeCache.has(graphRelations)) { work.graphPreparationHits++; return orderedNodeCache.get(graphRelations); }
  work.graphPreparations++;
  const callGraph = graphRelations.callGraph || null;
  const importGraph = graphRelations.importGraph || null;
  const callNodeIndex = buildNodeIndex(callGraph);
  const importNodeIndex = buildNodeIndex(importGraph);
  const callNodes = buildOrderedNodes(callNodeIndex);
  const importNodes = buildOrderedNodes(importNodeIndex);
  const cached = {
    callGraph,
    importGraph,
    callNodeIndex,
    importNodeIndex,
    callNodes,
    importNodes
  };
  orderedNodeCache.set(graphRelations, cached);
  return cached;
};

const resolveNodeRef = (graphType, node, fallbackId, repoRoot) => {
  if (graphType === 'import') {
    const pathValue = normalizePathForRepo(node?.file || fallbackId, repoRoot);
    if (!pathValue) return null;
    return { type: 'file', path: pathValue };
  }
  const chunkUid = String(node?.id || fallbackId || '').trim();
  if (!chunkUid) return null;
  return { type: 'chunk', chunkUid };
};

const resolveNodePath = (node, fallbackId, repoRoot) => {
  const raw = node?.file || fallbackId || null;
  return normalizePathForRepo(raw, repoRoot);
};

export const parseArchitectureRules = payload => normalizeArchitectureRules(payload);

export const buildArchitectureReport = ({
  rules = [],
  graphRelations,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  repoRoot = null,
  metrics = null,
  now = () => new Date().toISOString()
} = {}) => {
  const started = performance.now(), work = createArchitectureWork();
  const normalizedRules = normalizeArchitectureRules(rules, { allowArray: true }).rules;
  const policy = architecturePolicyReceipt(normalizedRules);
  const phaseMs = { policyAdmission: performance.now() - started, evidenceProjection: 0 };
  let phaseStarted = performance.now(), execution;
  const finishMetrics = () => {
    phaseMs.edgeEvaluationInclusive = performance.now() - phaseStarted;
    execution = { schemaVersion: 1, scope: 'policy-and-graph-evaluation', excluded: ['input-loading', 'rendering'],
      work: { ...work }, phaseMs: { ...phaseMs }, totalMs: performance.now() - started };
    if (metrics) Object.assign(metrics, work, { phaseMs: { ...phaseMs }, totalMs: performance.now() - started });
  };
  const warnings = [];
  const upstreamCoverage = normalizeCrossFileCoverage(graphRelations?.upstreamCoverage);
  const upstreamWarning = crossFileCoverageWarning(upstreamCoverage);
  if (upstreamWarning) warnings.push(upstreamWarning);
  const truncation = createTruncationRecorder({ scope: 'architecture' });
  const recordTruncation = (cap, detail) => truncation.record(cap, detail);

  const maxViolations = caps.maxViolations == null ? null : normalizeCap(caps.maxViolations);
  const maxEdgesExamined = caps.maxEdgesExamined == null ? null : normalizeCap(caps.maxEdgesExamined);
  const capsUsed = {
    architecture: {
      maxViolations,
      maxEdgesExamined
    }
  };

  const resolvedProvenance = resolveProvenance({
    provenance,
    indexSignature,
    indexCompatKey,
    capsUsed,
    repo,
    indexDir,
    now,
    label: 'Architecture report'
  });

  phaseStarted = performance.now();
  const compiledRules = resolveCompiledRules(normalizedRules, policy, work);
  phaseMs.policyCompilation = performance.now() - phaseStarted; phaseStarted = performance.now();
  const summaries = compiledRules.map((rule) => ({
    id: rule.id,
    type: rule.type,
    severity: rule.severity ?? null,
    summary: { violations: 0 }
  }));
  const summaryById = new Map(summaries.map((entry) => [entry.id, entry]));
  const violations = [];

  if (!graphRelations || typeof graphRelations !== 'object') {
    if (compiledRules.length) {
      warnings.push({
        code: 'GRAPH_RELATIONS_MISSING',
        message: 'Graph relations artifact is missing; architecture rules were skipped.',
        data: null
      });
    }
    finishMetrics();
    return {
      policy: policy.receipt,
      execution,
      version: ARCHITECTURE_REPORT_VERSION,
      upstreamCoverage,
      provenance: resolvedProvenance,
      rules: summaries,
      violations,
      summary: { detectedViolations: 0, retainedViolations: 0, omittedViolations: 0,
        edgesExamined: 0, complete: compiledRules.length === 0 },
      truncation: truncation.list.length ? truncation.list : null,
      warnings: warnings.length ? warnings : null
    };
  }

  const cachedNodes = resolveOrderedNodes(graphRelations, work);
  phaseMs.graphPreparation = performance.now() - phaseStarted; phaseStarted = performance.now();
  const matches = createArchitectureMatchOwner(work);
  const selectedIndex = { indexSignature: resolvedProvenance.indexSignature || null,
    indexCompatKey: resolvedProvenance.indexCompatKey || null, indexDir: resolvedProvenance.indexDir || null,
    generation: null, generationAvailability: 'not-provided' };
  const callGraph = cachedNodes?.callGraph || null;
  const importGraph = cachedNodes?.importGraph || null;
  const callNodeIndex = cachedNodes?.callNodeIndex || new Map();
  const importNodeIndex = cachedNodes?.importNodeIndex || new Map();
  const callNodes = cachedNodes?.callNodes || [];
  const importNodes = cachedNodes?.importNodes || [];

  const callRules = compiledRules.filter((rule) => rule.type === 'forbiddenCall');
  const importRules = compiledRules.filter((rule) => rule.type === 'forbiddenImport' || rule.type === 'layering');
  const layeringRules = importRules.filter((rule) => rule.type === 'layering');
  const forbiddenImportRules = importRules.filter((rule) => rule.type === 'forbiddenImport');

  let edgesExamined = 0;
  let detectedViolations = 0;
  let stop = false;

  const shouldStop = () => {
    if (maxEdgesExamined != null && edgesExamined >= maxEdgesExamined) {
      recordTruncation('maxEdgesExamined', {
        limit: maxEdgesExamined,
        observed: edgesExamined,
        omitted: null
      });
      return true;
    }
    return false;
  };

  const recordViolation = (rule, edgeType, fromRef, toRef, note = null, details = {}) => {
    if (!fromRef || !toRef) return;
    detectedViolations += 1;
    const summary = summaryById.get(rule.id);
    if (summary) summary.summary.violations += 1;
    if (maxViolations != null && violations.length >= maxViolations) {
      return;
    }
    work.evidenceProjections++;
    const projectedAt = performance.now();
    violations.push({
      ruleId: rule.id,
      edge: {
        edgeType,
        from: fromRef,
        to: toRef
      },
      evidence: { note, details: architectureViolationEvidence({
        rule: normalizedRules[rule.ruleIndex], ruleIndex: rule.ruleIndex, policyDigest: policy.receipt.digest,
        edgeType, fromRef, toRef, index: selectedIndex, ...details }) }
    });
    phaseMs.evidenceProjection += performance.now() - projectedAt;
  };

  const layerResolvers = layeringRules.map(rule => ({ rule,
    resolve: targetPath => {
      if (!targetPath) return null;
      const index = matches.layer(rule, targetPath);
      return index === null ? null : { index, name: rule.layers[index].name };
    } }));

  const walkEdges = (nodes, nodeIndex, edgeType, handler) => {
    for (const node of nodes) {
      const outRaw = Array.isArray(node?.out) ? node.out : [];
      if (!outRaw.length) continue;
      if (maxEdgesExamined !== null && edgesExamined >= maxEdgesExamined) {
        // Empty normalized entries are not observed edges. Prove only whether
        // an edge remains; do not allocate/sort the capped adjacency tail.
        const hasEdge = outRaw.some(entry => { work.adjacencyAdmissionEntries++; return Boolean(String(entry)); });
        if (hasEdge && shouldStop()) { stop = true; return; }
        continue;
      }
      const out = architectureNeighbors(outRaw, maxEdgesExamined === null ? Infinity : maxEdgesExamined - edgesExamined, work);
      for (const toId of out) {
        if (shouldStop()) {
          stop = true;
          return;
        }
        edgesExamined += 1;
        const toNode = nodeIndex.get(toId) || null;
        handler(node, toId, toNode, edgeType);
        if (stop) return;
      }
      if (stop) return;
    }
  };

  if (callRules.length && callNodes.length) {
    walkEdges(callNodes, callNodeIndex, 'call', (fromNode, toId, toNode, edgeType) => {
      const fromPath = matches.path(fromNode, fromNode.id, () => resolveNodePath(fromNode, fromNode.id, repoRoot));
      const toPath = matches.path(toNode || callGraph, toId, () => resolveNodePath(toNode, toId, repoRoot));
      if (!fromPath || !toPath) return;
      const fromRef = resolveNodeRef('call', fromNode, fromNode?.id, repoRoot);
      const toRef = resolveNodeRef('call', toNode, toId, repoRoot);
      if (!fromRef || !toRef) return;
      for (const rule of callRules) {
        if (!matches.matches(rule.from, fromPath)) continue;
        if (!matches.matches(rule.to, toPath)) continue;
        recordViolation(rule, edgeType, fromRef, toRef, rule.message || null, { fromNode, toNode, fromPath, toPath });
        if (stop) return;
      }
    });
  }

  if (importRules.length && importNodes.length && !stop) {
    walkEdges(importNodes, importNodeIndex, 'import', (fromNode, toId, toNode, edgeType) => {
      const fromPath = matches.path(fromNode, fromNode.id, () => resolveNodePath(fromNode, fromNode.id, repoRoot));
      const toPath = matches.path(toNode || importGraph, toId, () => resolveNodePath(toNode, toId, repoRoot));
      if (!fromPath || !toPath) return;
      const fromRef = resolveNodeRef('import', fromNode, fromNode?.id, repoRoot);
      const toRef = resolveNodeRef('import', toNode, toId, repoRoot);
      if (!fromRef || !toRef) return;

      for (const rule of forbiddenImportRules) {
        if (!matches.matches(rule.from, fromPath)) continue;
        if (!matches.matches(rule.to, toPath)) continue;
        recordViolation(rule, edgeType, fromRef, toRef, rule.message || null, { fromNode, toNode, fromPath, toPath });
        if (stop) return;
      }

      if (!layerResolvers.length) return;
      for (const resolver of layerResolvers) {
        const fromLayer = resolver.resolve(fromPath);
        const toLayer = resolver.resolve(toPath);
        if (!fromLayer || !toLayer) continue;
        if (fromLayer.index < toLayer.index) {
          const note = `Layering violation: ${fromLayer.name} -> ${toLayer.name}`;
          recordViolation(resolver.rule, edgeType, fromRef, toRef, note, { fromNode, toNode, fromPath, toPath, layers: { from: fromLayer.index, to: toLayer.index } });
          if (stop) return;
        }
      }
    });
  }

  if (detectedViolations > violations.length) recordTruncation('maxViolations', {
    limit: maxViolations, observed: detectedViolations, omitted: detectedViolations - violations.length
  });
  finishMetrics();
  return {
    policy: policy.receipt,
    execution,
    version: ARCHITECTURE_REPORT_VERSION,
    upstreamCoverage,
    provenance: resolvedProvenance,
    rules: summaries,
    violations,
    summary: { detectedViolations, retainedViolations: violations.length,
      omittedViolations: detectedViolations - violations.length, edgesExamined,
      complete: !upstreamWarning && !truncation.list.some(entry => entry.cap === 'maxEdgesExamined') },
    truncation: truncation.list.length ? truncation.list : null,
    warnings: warnings.length ? warnings : null
  };
};

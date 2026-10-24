import { normalizeArchitectureRules, architectureRuleInputError } from '../contracts/architecture-rules.js';
import { normalizeCrossFileCoverage, crossFileCoverageWarning } from '../index/cross-file-fidelity.js';
import picomatch from 'picomatch';
import { compareStrings } from '../shared/sort.js';
import { normalizeCap } from '../shared/limits.js';
import { normalizePathForRepo } from '../shared/path-normalize.js';
import { resolveProvenance } from '../shared/provenance.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import { sha1 } from '../shared/hash.js';

const compiledRuleCache = new Map();
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
  return { anyOf, noneOf, matches: target => {
    if (!target) return false;
    const value = String(target);
    if (anyMatchers.length && !anyMatchers.some(matcher => matcher(value))) return false;
    if (noneMatchers.some(matcher => matcher(value))) return false;
    return true;
  } };
};

const compileRules = rules => rules.map((rule, ruleIndex) => {
  const base = { id: rule.id, type: rule.type, severity: rule.severity, message: rule.message };
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

const resolveCompiledRules = rules => {
  const rulesHash = sha1(JSON.stringify({ version: 1, rules }));
  const cached = compiledRuleCache.get(rulesHash);
  if (cached) return cached;
  const compiled = compileRules(rules);
  compiledRuleCache.set(rulesHash, compiled);
  return compiled;
};

const resolveOrderedNodes = (graphRelations) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  if (orderedNodeCache.has(graphRelations)) return orderedNodeCache.get(graphRelations);
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
  now = () => new Date().toISOString()
} = {}) => {
  const normalizedRules = normalizeArchitectureRules(rules, { allowArray: true }).rules;
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

  const compiledRules = resolveCompiledRules(normalizedRules);
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
    return {
      version: '1.0.0',
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

  const cachedNodes = resolveOrderedNodes(graphRelations);
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

  const recordViolation = (rule, edgeType, fromRef, toRef, note = null) => {
    if (!fromRef || !toRef) return;
    detectedViolations += 1;
    const summary = summaryById.get(rule.id);
    if (summary) summary.summary.violations += 1;
    if (maxViolations != null && violations.length >= maxViolations) {
      return;
    }
    violations.push({
      ruleId: rule.id,
      edge: {
        edgeType,
        from: fromRef,
        to: toRef
      },
      evidence: note ? { note } : null
    });
  };

  const layerResolvers = layeringRules.map((rule) => {
    const cache = new Map();
    const resolve = (targetPath) => {
      if (!targetPath) return null;
      if (cache.has(targetPath)) return cache.get(targetPath);
      let matched = null;
      const layers = rule.layers || [];
      for (let idx = 0; idx < layers.length; idx += 1) {
        if (layers[idx].matcher.matches(targetPath)) {
          matched = { index: idx, name: layers[idx].name };
          break;
        }
      }
      cache.set(targetPath, matched);
      return matched;
    };
    return { rule, resolve };
  });

  const walkEdges = (nodes, nodeIndex, edgeType, handler) => {
    for (const node of nodes) {
      const outRaw = Array.isArray(node?.out) ? node.out : [];
      const out = outRaw.map((entry) => String(entry)).filter(Boolean);
      out.sort(compareStrings);
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
      const fromPath = resolveNodePath(fromNode, fromNode?.id, repoRoot);
      const toPath = resolveNodePath(toNode, toId, repoRoot);
      if (!fromPath || !toPath) return;
      const fromRef = resolveNodeRef('call', fromNode, fromNode?.id, repoRoot);
      const toRef = resolveNodeRef('call', toNode, toId, repoRoot);
      if (!fromRef || !toRef) return;
      for (const rule of callRules) {
        if (!rule.from.matches(fromPath)) continue;
        if (!rule.to.matches(toPath)) continue;
        recordViolation(rule, edgeType, fromRef, toRef, rule.message || null);
        if (stop) return;
      }
    });
  }

  if (importRules.length && importNodes.length && !stop) {
    walkEdges(importNodes, importNodeIndex, 'import', (fromNode, toId, toNode, edgeType) => {
      const fromPath = resolveNodePath(fromNode, fromNode?.id, repoRoot);
      const toPath = resolveNodePath(toNode, toId, repoRoot);
      if (!fromPath || !toPath) return;
      const fromRef = resolveNodeRef('import', fromNode, fromNode?.id, repoRoot);
      const toRef = resolveNodeRef('import', toNode, toId, repoRoot);
      if (!fromRef || !toRef) return;

      for (const rule of forbiddenImportRules) {
        if (!rule.from.matches(fromPath)) continue;
        if (!rule.to.matches(toPath)) continue;
        recordViolation(rule, edgeType, fromRef, toRef, rule.message || null);
        if (stop) return;
      }

      if (!layerResolvers.length) return;
      for (const resolver of layerResolvers) {
        const fromLayer = resolver.resolve(fromPath);
        const toLayer = resolver.resolve(toPath);
        if (!fromLayer || !toLayer) continue;
        if (fromLayer.index < toLayer.index) {
          const note = `Layering violation: ${fromLayer.name} -> ${toLayer.name}`;
          recordViolation(resolver.rule, edgeType, fromRef, toRef, note);
          if (stop) return;
        }
      }
    });
  }

  if (detectedViolations > violations.length) recordTruncation('maxViolations', {
    limit: maxViolations, observed: detectedViolations, omitted: detectedViolations - violations.length
  });
  return {
    version: '1.0.0',
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

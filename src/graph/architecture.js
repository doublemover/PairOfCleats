import picomatch from 'picomatch';
import { compareStrings } from '../shared/sort.js';
import { normalizeCap } from '../shared/limits.js';
import { normalizePathForRepo } from '../shared/path-normalize.js';
import { resolveProvenance } from '../shared/provenance.js';
import { createTruncationRecorder } from '../shared/truncation.js';

const buildMatcherSet = (patterns) => patterns.map((pattern) => picomatch(pattern, { dot: true }));

const compilePathSelector = (selector) => {
  const anyOf = Array.isArray(selector?.anyOf)
    ? selector.anyOf.map((entry) => String(entry)).filter(Boolean)
    : [];
  const noneOf = Array.isArray(selector?.noneOf)
    ? selector.noneOf.map((entry) => String(entry)).filter(Boolean)
    : [];
  const anyMatchers = buildMatcherSet(anyOf);
  const noneMatchers = buildMatcherSet(noneOf);
  return {
    anyOf,
    noneOf,
    matches: (target) => {
      if (!target) return false;
      const value = String(target);
      if (anyMatchers.length && !anyMatchers.some((matcher) => matcher(value))) return false;
      if (noneMatchers.length && noneMatchers.some((matcher) => matcher(value))) return false;
      return true;
    }
  };
};

const normalizeRulesInput = (rules) => {
  if (Array.isArray(rules)) return rules;
  if (rules && typeof rules === 'object' && Array.isArray(rules.rules)) {
    return rules.rules;
  }
  return [];
};

const compileRules = (rules, warnings) => {
  const compiled = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    const id = String(rule.id || '').trim();
    const type = String(rule.type || '').trim();
    if (!id || !type) continue;
    const base = {
      id,
      type,
      severity: rule.severity ?? null,
      message: rule.message ?? null
    };
    if (type === 'forbiddenImport' || type === 'forbiddenCall') {
      compiled.push({
        ...base,
        from: compilePathSelector(rule.from || {}),
        to: compilePathSelector(rule.to || {})
      });
      continue;
    }
    if (type === 'layering') {
      const layers = Array.isArray(rule.layers) ? rule.layers : [];
      const normalizedLayers = layers.map((layer) => ({
        name: String(layer?.name || '').trim(),
        matcher: compilePathSelector(layer?.match || {})
      })).filter((layer) => layer.name);
      if (!normalizedLayers.length) {
        warnings.push({
          code: 'INVALID_RULE',
          message: `Layering rule ${id} has no valid layers.`,
          data: { ruleId: id }
        });
        continue;
      }
      compiled.push({ ...base, layers: normalizedLayers });
      continue;
    }
    warnings.push({
      code: 'UNKNOWN_RULE_TYPE',
      message: `Unknown rule type ${type} (${id}).`,
      data: { ruleId: id }
    });
  }
  return compiled;
};

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

export const parseArchitectureRules = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Rules payload must be an object.');
  }
  const version = Number(payload.version);
  if (!Number.isFinite(version) || version !== 1) {
    throw new Error('Architecture rules version must be 1.');
  }
  if (!Array.isArray(payload.rules)) {
    throw new Error('Architecture rules must include a rules array.');
  }
  return payload;
};

export const buildArchitectureReport = ({
  rules,
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
  const warnings = [];
  const truncation = createTruncationRecorder({ scope: 'architecture' });
  const recordTruncation = (cap, detail) => truncation.record(cap, detail);

  const maxViolations = normalizeCap(caps.maxViolations);
  const maxEdgesExamined = normalizeCap(caps.maxEdgesExamined);
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

  const normalizedRules = normalizeRulesInput(rules);
  const compiledRules = compileRules(normalizedRules, warnings);
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
      provenance: resolvedProvenance,
      rules: summaries,
      violations,
      truncation: truncation.list.length ? truncation.list : null,
      warnings: warnings.length ? warnings : null
    };
  }

  const callGraph = graphRelations.callGraph || null;
  const importGraph = graphRelations.importGraph || null;
  const callNodeIndex = buildNodeIndex(callGraph);
  const importNodeIndex = buildNodeIndex(importGraph);
  const callNodes = buildOrderedNodes(callNodeIndex);
  const importNodes = buildOrderedNodes(importNodeIndex);

  const callRules = compiledRules.filter((rule) => rule.type === 'forbiddenCall');
  const importRules = compiledRules.filter((rule) => rule.type === 'forbiddenImport' || rule.type === 'layering');
  const layeringRules = importRules.filter((rule) => rule.type === 'layering');
  const forbiddenImportRules = importRules.filter((rule) => rule.type === 'forbiddenImport');

  let edgesExamined = 0;
  let stop = false;

  const shouldStop = () => {
    if (maxViolations != null && violations.length >= maxViolations) {
      recordTruncation('maxViolations', {
        limit: maxViolations,
        observed: violations.length,
        omitted: null
      });
      return true;
    }
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
    if (maxViolations != null && violations.length >= maxViolations) {
      stop = true;
      recordTruncation('maxViolations', {
        limit: maxViolations,
        observed: violations.length,
        omitted: null
      });
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
    const summary = summaryById.get(rule.id);
    if (summary) summary.summary.violations += 1;
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

  return {
    version: '1.0.0',
    provenance: resolvedProvenance,
    rules: summaries,
    violations,
    truncation: truncation.list.length ? truncation.list : null,
    warnings: warnings.length ? warnings : null
  };
};

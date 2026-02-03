import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { normalizeCap } from '../shared/limits.js';
import { normalizePathForRepo } from '../shared/path-normalize.js';
import { resolveProvenance } from '../shared/provenance.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import { toPosix } from '../shared/files.js';
import { compareStrings } from '../shared/sort.js';

const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.testCache',
  '.testLogs',
  '.diagnostics',
  '.venv',
  'dist',
  'build',
  'out'
]);

const TEST_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx']);

const isTestFileName = (relPath) => {
  const normalized = toPosix(relPath || '');
  const base = path.basename(normalized);
  const ext = path.extname(base).toLowerCase();
  if (!TEST_EXTENSIONS.has(ext)) return false;
  if (base.includes('.test.')) return true;
  if (base.includes('_test.')) return true;
  if (normalized.includes('/__tests__/')) return true;
  if (normalized.includes('/tests/')) return true;
  return false;
};

const compileTestMatchers = (patterns) => {
  const list = Array.isArray(patterns) ? patterns : [];
  const normalized = list.map((entry) => String(entry).trim()).filter(Boolean);
  if (!normalized.length) return null;
  return normalized.map((pattern) => picomatch(pattern, { dot: true }));
};

const matchesTestPatterns = (relPath, matchers) => {
  if (!matchers || !matchers.length) return true;
  return matchers.some((matcher) => matcher(relPath));
};

const discoverCandidateTests = ({
  repoRoot,
  maxCandidates,
  recordTruncation,
  testMatchers
}) => {
  const results = [];
  const stack = [{ dir: repoRoot, rel: '' }];
  while (stack.length) {
    const entry = stack.pop();
    const entries = fs.readdirSync(entry.dir, { withFileTypes: true });
    for (const dirent of entries) {
      const relPath = entry.rel ? `${entry.rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRS.has(dirent.name)) continue;
        stack.push({ dir: path.join(entry.dir, dirent.name), rel: relPath });
        continue;
      }
      if (!dirent.isFile()) continue;
      if (!isTestFileName(relPath)) continue;
      const normalized = toPosix(relPath);
      if (!matchesTestPatterns(normalized, testMatchers)) continue;
      results.push(normalized);
      if (maxCandidates != null && results.length >= maxCandidates) {
        recordTruncation('maxCandidates', {
          limit: maxCandidates,
          observed: results.length,
          omitted: null
        });
        return results;
      }
    }
  }
  results.sort(compareStrings);
  return results;
};

const buildImportGraphIndex = (graphRelations, repoRoot) => {
  const outgoing = new Map();
  const incoming = new Map();
  const importGraph = graphRelations?.importGraph || null;
  const nodes = Array.isArray(importGraph?.nodes) ? importGraph.nodes : [];
  const index = new Map();
  for (const node of nodes) {
    if (!node?.id) continue;
    index.set(node.id, node);
  }
  const addEdge = (fromPath, toPath) => {
    if (!fromPath || !toPath) return;
    const out = outgoing.get(fromPath) || [];
    out.push(toPath);
    outgoing.set(fromPath, out);
    const inc = incoming.get(toPath) || [];
    inc.push(fromPath);
    incoming.set(toPath, inc);
  };
  for (const node of nodes) {
    const fromPath = normalizePathForRepo(node.file || node.id, repoRoot);
    const out = Array.isArray(node?.out) ? node.out : [];
    for (const toId of out) {
      const toNode = index.get(toId);
      const toPath = normalizePathForRepo(toNode?.file || toId, repoRoot);
      addEdge(fromPath, toPath);
    }
  }
  for (const list of outgoing.values()) list.sort(compareStrings);
  for (const list of incoming.values()) list.sort(compareStrings);
  return { outgoing, incoming };
};

const scoreFromDistance = (distance) => 1 / (distance + 1);

const buildWitnessPath = (trail) => {
  if (!Array.isArray(trail) || !trail.length) return null;
  return {
    to: { type: 'file', path: trail[trail.length - 1] },
    distance: Math.max(0, trail.length - 1),
    nodes: trail.map((entry) => ({ type: 'file', path: entry }))
  };
};

const buildFallbackSuggestions = (changed, tests) => {
  const changedMeta = changed.map((entry) => {
    const ext = path.extname(entry);
    const base = ext ? entry.slice(0, -ext.length) : entry;
    return {
      path: entry,
      base: path.basename(base),
      dir: path.dirname(entry)
    };
  });
  const suggestions = [];
  for (const testPath of tests) {
    let best = null;
    for (const change of changedMeta) {
      if (change.base && testPath.includes(change.base)) {
        best = { score: 0.5, reason: `name match: ${change.base}` };
        break;
      }
      if (change.dir && testPath.startsWith(`${change.dir}/`)) {
        best = { score: 0.25, reason: `path proximity: ${change.dir}` };
      }
    }
    if (!best) continue;
    suggestions.push({
      testPath,
      score: best.score,
      reason: best.reason,
      witnessPath: null
    });
  }
  return suggestions;
};

export const buildSuggestTestsReport = ({
  changed = [],
  graphRelations = null,
  tests = null,
  repoRoot = null,
  testPatterns = null,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  now = () => new Date().toISOString()
} = {}) => {
  const truncation = createTruncationRecorder({ scope: 'suggestTests' });
  const warnings = [];
  const recordTruncation = (cap, detail) => truncation.record(cap, detail);

  const capsNormalized = {
    maxDepth: normalizeCap(caps.maxDepth),
    maxNodes: normalizeCap(caps.maxNodes),
    maxEdges: normalizeCap(caps.maxEdges),
    maxWorkUnits: normalizeCap(caps.maxWorkUnits),
    maxCandidates: normalizeCap(caps.maxCandidates),
    maxSuggestions: normalizeCap(caps.maxSuggestions),
    maxSeeds: normalizeCap(caps.maxSeeds)
  };

  const capsUsed = {
    suggestTests: {
      maxDepth: capsNormalized.maxDepth,
      maxNodes: capsNormalized.maxNodes,
      maxEdges: capsNormalized.maxEdges,
      maxWorkUnits: capsNormalized.maxWorkUnits,
      maxCandidates: capsNormalized.maxCandidates,
      maxSuggestions: capsNormalized.maxSuggestions,
      maxSeeds: capsNormalized.maxSeeds
    }
  };

  const normalizedChanged = Array.from(new Set(
    (Array.isArray(changed) ? changed : []).map((entry) => normalizePathForRepo(entry, repoRoot)).filter(Boolean)
  ));
  normalizedChanged.sort(compareStrings);
  let seeds = normalizedChanged;
  if (capsNormalized.maxSeeds != null && seeds.length > capsNormalized.maxSeeds) {
    recordTruncation('maxSeeds', {
      limit: capsNormalized.maxSeeds,
      observed: seeds.length,
      omitted: seeds.length - capsNormalized.maxSeeds
    });
    seeds = seeds.slice(0, capsNormalized.maxSeeds);
  }

  const testMatchers = compileTestMatchers(testPatterns);
  if (!Array.isArray(tests) && !repoRoot) {
    throw new Error('Suggest-tests requires repoRoot when tests are not provided.');
  }
  const testList = Array.isArray(tests)
    ? tests.map((entry) => normalizePathForRepo(entry, repoRoot)).filter(Boolean)
    : discoverCandidateTests({
      repoRoot,
      maxCandidates: capsNormalized.maxCandidates,
      recordTruncation,
      testMatchers
    });
  const changedEntries = seeds.map((entry) => ({ path: entry }));

  if (!testList.length) {
    warnings.push({
      code: 'NO_TESTS_FOUND',
      message: 'No tests were discovered for suggestion.',
      data: null
    });
  }

  let suggestions = [];
  const graphAvailable = Boolean(graphRelations && graphRelations.importGraph);

  if (graphAvailable && seeds.length && testList.length) {
    const { incoming } = buildImportGraphIndex(graphRelations, repoRoot);
    const queue = [];
    const visited = new Map();
    for (const seed of seeds) {
      const trail = [seed];
      visited.set(seed, { distance: 0, trail });
      queue.push({ path: seed, distance: 0, trail });
    }
    let queueIndex = 0;
    let edgesVisited = 0;
    let workUnits = 0;
    let stopTraversal = false;
    while (queueIndex < queue.length && !stopTraversal) {
      const current = queue[queueIndex];
      queueIndex += 1;
      const distance = current.distance;
      if (capsNormalized.maxDepth != null && distance >= capsNormalized.maxDepth) continue;
      const neighbors = incoming.get(current.path) || [];
      for (const neighbor of neighbors) {
        if (capsNormalized.maxEdges != null && edgesVisited >= capsNormalized.maxEdges) {
          recordTruncation('maxEdges', {
            limit: capsNormalized.maxEdges,
            observed: edgesVisited,
            omitted: null
          });
          stopTraversal = true;
          break;
        }
        if (capsNormalized.maxWorkUnits != null && workUnits >= capsNormalized.maxWorkUnits) {
          recordTruncation('maxWorkUnits', {
            limit: capsNormalized.maxWorkUnits,
            observed: workUnits,
            omitted: null
          });
          stopTraversal = true;
          break;
        }
        edgesVisited += 1;
        workUnits += 1;
        if (visited.has(neighbor)) continue;
        const trail = current.trail.concat([neighbor]);
        const nextDistance = distance + 1;
        visited.set(neighbor, { distance: nextDistance, trail });
        queue.push({ path: neighbor, distance: nextDistance, trail });
        if (capsNormalized.maxNodes != null && visited.size >= capsNormalized.maxNodes) {
          recordTruncation('maxNodes', {
            limit: capsNormalized.maxNodes,
            observed: visited.size,
            omitted: null
          });
          stopTraversal = true;
          break;
        }
      }
    }

    for (const testPath of testList) {
      const entry = visited.get(testPath);
      if (!entry) continue;
      const score = scoreFromDistance(entry.distance);
      suggestions.push({
        testPath,
        score,
        reason: `graph distance ${entry.distance}`,
        witnessPath: buildWitnessPath(entry.trail)
      });
    }
  }

  if (!suggestions.length && testList.length) {
    if (!graphAvailable) {
      warnings.push({
        code: 'GRAPH_RELATIONS_MISSING',
        message: 'Graph relations missing; falling back to path heuristics.',
        data: null
      });
    } else {
      warnings.push({
        code: 'GRAPH_NO_MATCHES',
        message: 'No graph-based suggestions; falling back to path heuristics.',
        data: null
      });
    }
    suggestions = buildFallbackSuggestions(seeds, testList);
  }

  suggestions.sort((a, b) => {
    const scoreCompare = b.score - a.score;
    if (scoreCompare !== 0) return scoreCompare;
    return compareStrings(a.testPath, b.testPath);
  });

  if (capsNormalized.maxSuggestions != null && suggestions.length > capsNormalized.maxSuggestions) {
    recordTruncation('maxSuggestions', {
      limit: capsNormalized.maxSuggestions,
      observed: suggestions.length,
      omitted: suggestions.length - capsNormalized.maxSuggestions
    });
    suggestions = suggestions.slice(0, capsNormalized.maxSuggestions);
  }

  const resolvedProvenance = resolveProvenance({
    provenance,
    indexSignature,
    indexCompatKey,
    capsUsed,
    repo,
    indexDir,
    now,
    label: 'Suggest-tests report'
  });

  return {
    version: '1.0.0',
    provenance: resolvedProvenance,
    changed: changedEntries,
    suggestions,
    truncation: truncation.list.length ? truncation.list : null,
    warnings: warnings.length ? warnings : null
  };
};

import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import { normalizeCap } from '../shared/limits.js';
import { normalizePathForRepo } from '../shared/path-normalize.js';
import { resolveProvenance } from '../shared/provenance.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import { toPosix } from '../shared/file-paths.js';
import { compareStrings } from '../shared/sort.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { sha1 } from '../shared/hash.js';
import { createGraphNeighborResolver } from './neighborhood/walker.js';

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
const TEST_MATCHER_CACHE_MAX = 8;
const TEST_DISCOVERY_CACHE_MAX = 4;
const SUGGEST_TESTS_FIDELITY_SCHEMA_VERSION = 1;
const SUGGEST_TESTS_REASON_CODES = Object.freeze({
  GRAPH_MISSING: 'graph_missing',
  GRAPH_NO_MATCHES: 'graph_no_matches',
  TRAVERSAL_CAPPED: 'traversal_capped',
  CANDIDATE_TRUNCATED: 'candidate_truncated'
});
const TRAVERSAL_TRUNCATION_CAPS = new Set(['maxNodes', 'maxEdges', 'maxWorkUnits']);
const testMatcherCache = new Map();
const testDiscoveryCache = new Map();

const getCachedValue = (cache, key) => {
  if (!key) return null;
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const setCachedValue = (cache, key, value, max) => {
  if (!key) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

const isTestFileName = (relPath) => {
  const normalized = toPosix(relPath || '');
  const base = path.basename(normalized);
  const ext = path.extname(base).toLowerCase();
  if (!TEST_EXTENSIONS.has(ext)) return false;
  if (base.includes('.test.')) return true;
  if (base.includes('_test.')) return true;
  if (normalized.split('/').some((segment) => segment === '__tests__' || segment === 'tests')) return true;
  return false;
};

const normalizeTestPatterns = (patterns) => {
  const list = Array.isArray(patterns) ? patterns : [];
  const normalized = list.map((entry) => String(entry).trim()).filter(Boolean);
  normalized.sort(compareStrings);
  return normalized;
};

const compileTestMatchers = (patterns) => {
  const normalized = normalizeTestPatterns(patterns);
  if (!normalized.length) {
    return { matchers: null, key: '' };
  }
  const cacheKeyInfo = buildLocalCacheKey({
    namespace: 'test-matcher',
    payload: normalized
  });
  const cached = getCachedValue(testMatcherCache, cacheKeyInfo.key);
  if (cached) return { matchers: cached, key: cacheKeyInfo.key };
  const matchers = normalized.map((pattern) => picomatch(pattern, { dot: true }));
  setCachedValue(testMatcherCache, cacheKeyInfo.key, matchers, TEST_MATCHER_CACHE_MAX);
  return { matchers, key: cacheKeyInfo.key };
};

const matchesTestPatterns = (relPath, matchers) => {
  if (!matchers || !matchers.length) return true;
  return matchers.some((matcher) => matcher(relPath));
};

const discoverCandidateTests = ({ repoRoot, testMatchers, maxCandidates }) => {
  const tests = [];
  const stack = [{ dir: repoRoot, rel: '' }];
  // Candidate discovery is incidental work. Bound even candidate-free trees and
  // huge single directories, without retaining a complete repository inventory.
  const maxScanEntries = maxCandidates === null ? Infinity : Math.max(64, maxCandidates * 32);
  let scanned = 0;
  let observed = 0;
  let capped = false;
  while (stack.length && !capped) {
    if (scanned >= maxScanEntries) { capped = true; break; }
    const entry = stack.pop();
    let directory;
    const entries = [];
    try {
      directory = fs.opendirSync(entry.dir, { bufferSize: 1 });
      scanned += 1;
      while (scanned < maxScanEntries) {
        const dirent = directory.readSync();
        if (!dirent) break;
        scanned += 1;
        entries.push(dirent);
      }
      if (scanned >= maxScanEntries) capped = true;
    } catch {
      continue;
    } finally {
      directory?.closeSync();
    }
    // Filesystem enumeration order is unspecified. An incomplete directory
    // cannot supply deterministic candidates or child directories, even after
    // sorting its prefix. Keep only earlier, fully inventoried selections.
    if (capped) break;
    entries.sort((a, b) => compareStrings(a.name, b.name));
    const directories = [];
    for (const dirent of entries) {
      const relPath = entry.rel ? `${entry.rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (!DEFAULT_EXCLUDED_DIRS.has(dirent.name)) {
          directories.push({ dir: path.join(entry.dir, dirent.name), rel: relPath });
        }
        continue;
      }
      if (!dirent.isFile() || !TEST_EXTENSIONS.has(path.extname(relPath).toLowerCase())) continue;
      const normalized = toPosix(relPath);
      if (testMatchers?.length ? !matchesTestPatterns(normalized, testMatchers) : !isTestFileName(normalized)) continue;
      observed += 1;
      if (maxCandidates !== null && tests.length >= maxCandidates) {
        capped = true;
        break;
      }
      tests.push(normalized);
    }
    for (let i = directories.length - 1; i >= 0; i -= 1) stack.push(directories[i]);
  }
  return {
    tests: tests.sort(compareStrings),
    truncation: capped ? { limit: maxCandidates, observed, omitted: null } : null
  };
};

const resolveCachedTests = ({ repoRoot, maxCandidates, recordTruncation, testMatchers, patternKey, indexSignature }) => {
  // Revisit the bounded live inventory on every request, including cache hits.
  // This observes additions/deletions without introducing another watcher.
  const inventory = discoverCandidateTests({ repoRoot, testMatchers, maxCandidates });
  const cacheKeyInfo = buildLocalCacheKey({
    namespace: 'test-discovery',
    payload: { repoRoot, patternKey, maxCandidates: maxCandidates ?? 'all',
      indexSignature: indexSignature || null, inventoryIdentity: sha1(JSON.stringify(inventory)) }
  });
  let envelope = getCachedValue(testDiscoveryCache, cacheKeyInfo.key);
  if (!envelope) {
    envelope = inventory;
    setCachedValue(testDiscoveryCache, cacheKeyInfo.key, envelope, TEST_DISCOVERY_CACHE_MAX);
  }
  if (envelope.truncation) recordTruncation('maxCandidates', { ...envelope.truncation });
  return envelope.tests;
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
      if (change.base && testPath.split('/').some((segment) => (
        segment === change.base || ['.', '-', '_'].some((separator) => segment.startsWith(`${change.base}${separator}`))
      ))) {
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
      witnessPath: null,
      fidelity: {
        source: 'heuristic',
        state: 'fallback',
        reasonCodes: [],
        matchKind: best.reason.startsWith('name match:') ? 'name' : 'path-proximity',
        graphDistance: null
      }
    });
  }
  return suggestions;
};

const buildSuggestTestsFidelity = ({
  graphAvailable = false,
  graphUsed = false,
  graphSuggestions = 0,
  heuristicUsed = false,
  visitedNodes = 0,
  edgesVisited = 0,
  workUnits = 0,
  traversalCapsHit = [],
  candidateTruncated = false
} = {}) => {
  const reasonCodes = [];
  if (!graphAvailable) reasonCodes.push(SUGGEST_TESTS_REASON_CODES.GRAPH_MISSING);
  if (graphAvailable && graphUsed && graphSuggestions === 0) {
    reasonCodes.push(SUGGEST_TESTS_REASON_CODES.GRAPH_NO_MATCHES);
  }
  if (Array.isArray(traversalCapsHit) && traversalCapsHit.length) {
    reasonCodes.push(SUGGEST_TESTS_REASON_CODES.TRAVERSAL_CAPPED);
  }
  if (candidateTruncated) {
    reasonCodes.push(SUGGEST_TESTS_REASON_CODES.CANDIDATE_TRUNCATED);
  }
  const source = heuristicUsed
    ? 'heuristic'
    : graphSuggestions > 0
      ? 'graph'
      : 'none';
  const state = source === 'graph'
    ? reasonCodes.some((code) => (
      code === SUGGEST_TESTS_REASON_CODES.TRAVERSAL_CAPPED
      || code === SUGGEST_TESTS_REASON_CODES.CANDIDATE_TRUNCATED
    ))
      ? 'partial'
      : 'complete'
    : source === 'heuristic'
      ? 'fallback'
      : 'missing';
  return {
    schemaVersion: SUGGEST_TESTS_FIDELITY_SCHEMA_VERSION,
    source,
    state,
    reasonCodes,
    graph: {
      available: graphAvailable,
      used: graphUsed,
      matchedSuggestions: graphSuggestions,
      visitedNodes,
      edgesVisited,
      workUnits,
      traversalCapsHit: Array.isArray(traversalCapsHit) ? traversalCapsHit.slice() : [],
      candidateTruncated
    },
    heuristic: {
      used: heuristicUsed
    }
  };
};

export const buildSuggestTestsReport = ({
  changed = [],
  graphRelations = null,
  graphIndex = null,
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
  if (capsNormalized.maxNodes != null && seeds.length > capsNormalized.maxNodes) {
    recordTruncation('maxNodes', {
      limit: capsNormalized.maxNodes,
      observed: seeds.length,
      omitted: seeds.length - capsNormalized.maxNodes
    });
    seeds = seeds.slice(0, capsNormalized.maxNodes);
  }

  const { matchers: testMatchers, key: testMatcherKey } = compileTestMatchers(testPatterns);
  if (!Array.isArray(tests) && !repoRoot) {
    throw new Error('Suggest-tests requires repoRoot when tests are not provided.');
  }
  const testList = Array.isArray(tests)
    ? tests.map((entry) => normalizePathForRepo(entry, repoRoot)).filter(Boolean)
    : resolveCachedTests({
      repoRoot,
      maxCandidates: capsNormalized.maxCandidates,
      recordTruncation,
      testMatchers,
      patternKey: testMatcherKey,
      indexSignature
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
  const indexedImports = graphIndex && (graphIndex.importGraphIndex instanceof Map || graphIndex.graphRelationsCsr?.importGraph);
  const effectiveGraphRelations = graphIndex?.graphRelations || graphRelations;
  const graphAvailable = indexedImports
    ? Boolean(graphIndex.graphRelations?.importGraph || graphIndex.graphRelationsCsr?.importGraph || graphIndex.importGraphIndex?.size)
    : Boolean(effectiveGraphRelations?.importGraph);
  let graphUsed = false;
  let edgesVisited = 0;
  let workUnits = 0;
  let visitedNodeCount = 0;

  if (graphAvailable && seeds.length && testList.length) {
    graphUsed = true;
    const incoming = indexedImports ? null : buildImportGraphIndex(effectiveGraphRelations, repoRoot).incoming;
    const resolveNeighbors = indexedImports ? createGraphNeighborResolver({ graphIndex, iterableCsr: true }) : null;
    const normalizeNeighbor = graphIndex?.normalizeImportPath || (value => normalizePathForRepo(value, repoRoot));
    const indexedNodes = graphIndex?.importGraphIndex || new Map();
    const queue = [];
    const visited = new Map();
    for (const seed of seeds) {
      const trail = [seed];
      visited.set(seed, { distance: 0, trail });
      queue.push({ path: seed, distance: 0, trail });
    }
    let queueIndex = 0;
    let stopTraversal = false;
    while (queueIndex < queue.length && !stopTraversal) {
      const current = queue[queueIndex];
      queueIndex += 1;
      const distance = current.distance;
      if (capsNormalized.maxDepth != null && distance >= capsNormalized.maxDepth) continue;
      const neighbors = indexedImports
        ? resolveNeighbors(indexedNodes, current.path, 'in', normalizeNeighbor, graphIndex.importGraphAdjacency, 'importGraph')
        : incoming.get(current.path) || [];
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
        if (capsNormalized.maxNodes != null && visited.size >= capsNormalized.maxNodes) {
          recordTruncation('maxNodes', {
            limit: capsNormalized.maxNodes,
            observed: visited.size + 1,
            omitted: null
          });
          stopTraversal = true;
          break;
        }
        const trail = current.trail.concat([neighbor]);
        const nextDistance = distance + 1;
        visited.set(neighbor, { distance: nextDistance, trail });
        queue.push({ path: neighbor, distance: nextDistance, trail });
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
        witnessPath: buildWitnessPath(entry.trail),
        fidelity: {
          source: 'graph',
          state: 'complete',
          reasonCodes: [],
          matchKind: 'graph-distance',
          graphDistance: entry.distance
        }
      });
    }
    visitedNodeCount = visited.size;
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

  const truncationCaps = new Set(truncation.list.map((entry) => entry.cap));
  const traversalCapsHit = Array.from(new Set(
    truncation.list
      .map((entry) => String(entry?.cap || '').trim())
      .filter((cap) => TRAVERSAL_TRUNCATION_CAPS.has(cap))
  ));
  const candidateTruncated = truncationCaps.has('maxCandidates');
  const heuristicUsed = suggestions.some((entry) => entry?.fidelity?.source === 'heuristic');
  const fidelity = buildSuggestTestsFidelity({
    graphAvailable,
    graphUsed,
    graphSuggestions: suggestions.filter((entry) => entry?.fidelity?.source === 'graph').length,
    heuristicUsed,
    visitedNodes: visitedNodeCount,
    edgesVisited,
    workUnits,
    traversalCapsHit,
    candidateTruncated
  });

  if (fidelity.source === 'graph' && fidelity.state === 'partial') {
    const graphReasonCodes = fidelity.reasonCodes.filter((code) => (
      code === SUGGEST_TESTS_REASON_CODES.TRAVERSAL_CAPPED
      || code === SUGGEST_TESTS_REASON_CODES.CANDIDATE_TRUNCATED
    ));
    suggestions = suggestions.map((entry) => (
      entry?.fidelity?.source === 'graph'
        ? {
          ...entry,
          fidelity: {
            ...entry.fidelity,
            state: 'partial',
            reasonCodes: graphReasonCodes
          }
        }
        : entry
    ));
  } else if (heuristicUsed && fidelity.reasonCodes.length) {
    suggestions = suggestions.map((entry) => (
      entry?.fidelity?.source === 'heuristic'
        ? {
          ...entry,
          fidelity: {
            ...entry.fidelity,
            reasonCodes: fidelity.reasonCodes.slice()
          }
        }
        : entry
    ));
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
    fidelity,
    truncation: truncation.list.length ? truncation.list : null,
    warnings: warnings.length ? warnings : null
  };
};

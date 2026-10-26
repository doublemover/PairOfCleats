import { admitSuggestionWallClockMs, createSuggestionBudget } from './suggest-tests-budget.js';
import { readSuggestionDirectory } from './suggest-tests-directory.js';
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
  '.cache',
  '.tmp',
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
  CANDIDATE_TRUNCATED: 'candidate_truncated',
  DEADLINE_EXHAUSTED: 'deadline_exhausted'
});
const TRAVERSAL_TRUNCATION_CAPS = new Set(['maxNodes', 'maxEdges', 'maxWorkUnits', 'maxWallClockMs']);
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

const discoverCandidateTests = ({ repoRoot, testMatchers, maxCandidates, budget, runtime }) => {
  const tests = [];
  const stack = [{ dir: repoRoot, rel: '' }];
  // Candidate discovery is incidental work. Bound even candidate-free trees and
  // huge single directories, without retaining a complete repository inventory.
  const maxScanEntries = maxCandidates === null ? Infinity : Math.max(64, maxCandidates * 32);
  let scanned = 0;
  let observed = 0;
  let capped = false;
  while (stack.length && !capped && budget.check('discovery')) {
    if (scanned >= maxScanEntries) { capped = true; break; }
    const entry = stack.pop();
    const inventory = readSuggestionDirectory({ directoryPath: entry.dir, maxEntries: maxScanEntries - scanned,
      budget, openDirectory: runtime?.openDirectory });
    scanned += inventory.scanned;
    if (!inventory.complete) { capped = !budget.stopped(); break; }
    const entries = inventory.entries;
    entries.sort((a, b) => compareStrings(a.name, b.name));
    const directories = [];
    for (const dirent of entries) {
      if (!budget.check('discovery')) break;
      const relPath = entry.rel ? `${entry.rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (!DEFAULT_EXCLUDED_DIRS.has(dirent.name)) {
          directories.push({ dir: path.join(entry.dir, dirent.name), rel: relPath });
        }
        continue;
      }
      if (!dirent.isFile()) continue;
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
  if (!stack.length && !capped && !budget.stopped()) budget.complete('discovery');
  return {
    tests: tests.sort(compareStrings),
    truncation: capped ? { limit: maxCandidates, observed, omitted: null } : null
  };
};

const resolveCachedTests = ({ repoRoot, maxCandidates, recordTruncation, testMatchers, patternKey, indexSignature, budget, runtime }) => {
  // Revisit the bounded live inventory on every request, including cache hits.
  // This observes additions/deletions without introducing another watcher.
  const inventory = discoverCandidateTests({ repoRoot, testMatchers, maxCandidates, budget, runtime });
  if (budget.stopped()) return inventory.tests;
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

const buildImportGraphIndex = (graphRelations, repoRoot, budget) => {
  const incoming = new Map();
  const importGraph = graphRelations?.importGraph || null;
  const nodes = Array.isArray(importGraph?.nodes) ? importGraph.nodes : [];
  const index = new Map();
  for (const node of nodes) {
    if (!budget.check('import-preparation')) break;
    budget.count('graphNodes');
    if (!node?.id) continue;
    index.set(node.id, node);
  }
  const addEdge = (fromPath, toPath) => {
    if (!fromPath || !toPath) return;
    const inc = incoming.get(toPath) || [];
    inc.push(fromPath);
    incoming.set(toPath, inc);
  };
  for (const node of nodes) {
    if (!budget.check('import-preparation')) break;
    const fromPath = normalizePathForRepo(node.file || node.id, repoRoot);
    const out = Array.isArray(node?.out) ? node.out : [];
    for (const toId of out) {
      if (!budget.check('import-preparation')) break;
      budget.count('graphEdges');
      const toNode = index.get(toId);
      const toPath = normalizePathForRepo(toNode?.file || toId, repoRoot);
      addEdge(fromPath, toPath);
    }
  }
  for (const list of incoming.values()) { if (!budget.check('import-preparation')) break; list.sort(compareStrings); }
  if (budget.check('import-preparation')) budget.complete('import-preparation');
  return { incoming };
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

const buildFallbackSuggestions = (changed, tests, budget) => {
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
    if (!budget.check('fallback')) break;
    let best = null;
    for (const change of changedMeta) {
      if (!budget.check('fallback')) break;
      budget.count('fallbackChecks');
      if (change.base && testPath.split('/').some((segment) => (
        segment === change.base || ['.', '-', '_'].some((separator) => segment.startsWith(`${change.base}${separator}`))
        || segment === `test_${change.base}` || segment.startsWith(`test_${change.base}.`)
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
  candidateTruncated = false,
  deadlineExhausted = false
} = {}) => {
  const reasonCodes = [];
  if (!graphAvailable) reasonCodes.push(SUGGEST_TESTS_REASON_CODES.GRAPH_MISSING);
  if (graphAvailable && graphUsed && graphSuggestions === 0 && !deadlineExhausted) {
    reasonCodes.push(SUGGEST_TESTS_REASON_CODES.GRAPH_NO_MATCHES);
  }
  if (Array.isArray(traversalCapsHit) && traversalCapsHit.length) {
    reasonCodes.push(SUGGEST_TESTS_REASON_CODES.TRAVERSAL_CAPPED);
  }
  if (candidateTruncated) {
    reasonCodes.push(SUGGEST_TESTS_REASON_CODES.CANDIDATE_TRUNCATED);
  }
  if (deadlineExhausted) reasonCodes.push(SUGGEST_TESTS_REASON_CODES.DEADLINE_EXHAUSTED);
  const source = heuristicUsed
    ? 'heuristic'
    : graphSuggestions > 0
      ? 'graph'
      : 'none';
  const state = deadlineExhausted ? 'partial' : source === 'graph'
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
  now = () => new Date().toISOString(),
  runtime = null
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
    maxSeeds: normalizeCap(caps.maxSeeds),
    maxWallClockMs: admitSuggestionWallClockMs(caps.maxWallClockMs)
  };

  const budget = createSuggestionBudget({ limitMs: capsNormalized.maxWallClockMs, clock: runtime?.clock,
    preparationElapsedMs: runtime?.preparationElapsedMs ?? null,
    onStop: ({ phase, elapsedMs, limitMs }) => {
      recordTruncation('maxWallClockMs', { limit: limitMs, observed: elapsedMs, omitted: null, note: `suggestion-computation:${phase}` });
      warnings.push({ code: 'SUGGEST_TESTS_DEADLINE', message: 'Suggestion computation exhausted its cooperative time allowance; returned coverage is partial.',
        data: { phase, elapsedMs, limitMs } });
    } });
  budget.check('admission');
  const capsUsed = {
    suggestTests: {
      maxDepth: capsNormalized.maxDepth,
      maxNodes: capsNormalized.maxNodes,
      maxEdges: capsNormalized.maxEdges,
      maxWorkUnits: capsNormalized.maxWorkUnits,
      maxCandidates: capsNormalized.maxCandidates,
      maxSuggestions: capsNormalized.maxSuggestions,
      maxSeeds: capsNormalized.maxSeeds,
      maxWallClockMs: capsNormalized.maxWallClockMs
    }
  };

  const changedSet = new Set();
  for (const entry of Array.isArray(changed) ? changed : []) {
    if (!budget.check('admission')) break;
    const normalized = normalizePathForRepo(entry, repoRoot);
    if (normalized) changedSet.add(normalized);
  }
  const normalizedChanged = [...changedSet];
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

  if (budget.check('admission')) budget.complete('admission');
  const { matchers: testMatchers, key: testMatcherKey } = budget.check('candidate-admission')
    ? compileTestMatchers(testPatterns) : { matchers: null, key: '' };
  if (!Array.isArray(tests) && !repoRoot) {
    throw new Error('Suggest-tests requires repoRoot when tests are not provided.');
  }
  let testList = [];
  if (Array.isArray(tests)) {
    for (const entry of tests) {
      if (!budget.check('candidate-admission')) break;
      budget.count('candidateChecks');
      const normalized = normalizePathForRepo(entry, repoRoot);
      if (normalized) testList.push(normalized);
    }
  } else {
    testList = resolveCachedTests({ repoRoot, maxCandidates: capsNormalized.maxCandidates, recordTruncation,
      testMatchers, patternKey: testMatcherKey, indexSignature, budget, runtime });
  }
  if (!budget.stopped()) budget.complete('candidate-admission');
  const changedEntries = seeds.map((entry) => ({ path: entry }));

  if (!testList.length && !budget.stopped()) {
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
  let predecessors = null;

  if (graphAvailable && seeds.length && testList.length && budget.check('traversal')) {
    graphUsed = true;
    const incoming = indexedImports ? null : buildImportGraphIndex(effectiveGraphRelations, repoRoot, budget).incoming;
    const resolveNeighbors = indexedImports ? createGraphNeighborResolver({ graphIndex, iterableCsr: true }) : null;
    const normalizeNeighbor = graphIndex?.normalizeImportPath || (value => normalizePathForRepo(value, repoRoot));
    const indexedNodes = graphIndex?.importGraphIndex || new Map();
    const queue = [];
    const visited = new Map();
    predecessors = visited;
    for (const seed of seeds) {
      if (!budget.check('traversal')) break;
      visited.set(seed, { distance: 0, parent: null });
      queue.push({ path: seed, distance: 0 });
    }
    let queueIndex = 0;
    let stopTraversal = false;
    while (queueIndex < queue.length && !stopTraversal && budget.check('traversal')) {
      const current = queue[queueIndex];
      queueIndex += 1;
      const distance = current.distance;
      if (capsNormalized.maxDepth != null && distance >= capsNormalized.maxDepth) continue;
      const getNeighbors = () => indexedImports
        ? resolveNeighbors(indexedNodes, current.path, 'in', normalizeNeighbor, graphIndex.importGraphAdjacency, 'importGraph')
        : incoming.get(current.path) || [];
      const neighbors = runtime?.neighbors ? runtime.neighbors({ path: current.path, getNeighbors }) : getNeighbors();
      const iterator = neighbors[Symbol.iterator]();
      try {
        while (budget.check('traversal')) {
          budget.count('neighborReads');
          const next = iterator.next();
          if (next.done) break;
          if (!budget.check('traversal')) break;
          const neighbor = next.value;
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
          const nextDistance = distance + 1;
          visited.set(neighbor, { distance: nextDistance, parent: current.path });
          queue.push({ path: neighbor, distance: nextDistance });
        }
      } finally { iterator.return?.(); }
    }
    if (budget.check('traversal')) budget.complete('traversal');

    for (const testPath of testList) {
      if (!budget.check('selection')) break;
      budget.count('candidateChecks');
      const entry = visited.get(testPath);
      if (!entry) continue;
      const score = scoreFromDistance(entry.distance);
      suggestions.push({
        testPath,
        score,
        reason: `graph distance ${entry.distance}`,
        witnessPath: null,
        fidelity: {
          source: 'graph',
          state: 'complete',
          reasonCodes: [],
          matchKind: 'graph-distance',
          graphDistance: entry.distance
        }
      });
    }
    if (budget.check('selection')) budget.complete('selection');
    visitedNodeCount = visited.size;
  }

  if (!suggestions.length && testList.length && budget.check('fallback')) {
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
    suggestions = buildFallbackSuggestions(seeds, testList, budget);
    if (budget.check('fallback')) budget.complete('fallback');
  }

  // Sorting/admitting already retained results is bounded settlement work.
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

  for (const suggestion of suggestions) {
    if (!budget.check('witnesses')) break;
    if (suggestion.fidelity?.source !== 'graph') continue;
    const trail = [];
    let current = suggestion.testPath;
    while (current != null && budget.check('witnesses')) {
      budget.count('witnessLinks');
      trail.push(current);
      current = predecessors.get(current)?.parent ?? null;
    }
    if (budget.stopped()) break;
    trail.reverse();
    suggestion.witnessPath = buildWitnessPath(trail);
  }

  if (budget.check('witnesses')) budget.complete('witnesses');
  const execution = budget.finish();
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
    candidateTruncated,
    deadlineExhausted: budget.stopped()
  });

  if (fidelity.source === 'graph' && fidelity.state === 'partial') {
    const graphReasonCodes = fidelity.reasonCodes.filter((code) => (
      code === SUGGEST_TESTS_REASON_CODES.TRAVERSAL_CAPPED
      || code === SUGGEST_TESTS_REASON_CODES.CANDIDATE_TRUNCATED
      || code === SUGGEST_TESTS_REASON_CODES.DEADLINE_EXHAUSTED
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
            state: budget.stopped() ? 'partial' : entry.fidelity.state,
            reasonCodes: fidelity.reasonCodes.slice()
          }
        }
        : entry
    ));
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
    ...(execution ? { execution } : {}),
    provenance: resolvedProvenance,
    changed: changedEntries,
    suggestions,
    fidelity,
    truncation: truncation.list.length ? truncation.list : null,
    warnings: warnings.length ? warnings : null
  };
};

import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { loadChunkMeta } from '../shared/artifact-io/loaders.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { stableStringify } from '../shared/stable-json.js';
import {
  DEFAULT_LEGEND,
  DEFAULT_LIMITS,
  DEFAULT_EDGE_WEIGHTS,
  MAP_MODEL_VERSION,
  VIEWER_DEFAULTS
} from './constants.js';
import { sortBy, unique } from './utils.js';
import {
  hydrateChunkMeta,
  readGraphRelationsOptional,
  readJsonArrayOptional,
  readMapFileMeta,
  createMapSectionGuards,
  createSpillSorter,
  resolveJsonBytes,
  writeMapJsonStream
} from './build-map/io.js';
import {
  createStringInterner
} from './build-map/normalize.js';
import { buildMemberIndex } from './build-map/symbols.js';
import { buildMapMembers } from './build-map/members.js';
import { removePathWithRetry } from '../shared/io/remove-path-with-retry.js';
import { getCacheTempRoot } from '../shared/cache-roots.js';
import {
  buildAliasEdges,
  buildEdgesFromCallSummaries,
  buildEdgesFromCalls,
  buildEdgesFromGraph,
  buildEdgesFromUsage,
  buildExportEdges,
  buildImportEdges
} from './build-map/edges.js';
import { createCollapseTransform, createScopeFilters, normalizeIncludeList, resolveFocus } from './build-map/filters.js';
import { buildFileNodesIterable } from './build-map/nodes.js';
import { createMapBuildTimer } from './build-map/timing.js';

const normalizeMemberId = (value) => (value === 0 || value ? String(value) : null);

const createSectionHasher = () => {
  const hash = createHash('sha1');
  let hasAny = false;
  return {
    add(value) {
      hash.update(stableStringify(value));
      hash.update('\n');
      hasAny = true;
    },
    digest() {
      if (!hasAny) return hash.digest('hex');
      return hash.digest('hex');
    }
  };
};


const compareNodes = (a, b) => String(a.path || '').localeCompare(String(b.path || ''));
const edgeSortKey = (edge) => {
  const from = edge.from?.member || edge.from?.file || '';
  const to = edge.to?.member || edge.to?.file || '';
  return `${edge.type}:${from}->${to}:${edge.label || ''}`;
};
const compareEdges = (a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b));

const createTempDir = async () => {
  const base = path.join(getCacheTempRoot('map-build'), 'pairofcleats-map-');
  await fsPromises.mkdir(path.dirname(base), { recursive: true });
  return fsPromises.mkdtemp(base);
};

const cleanupTempDir = async (dir) => {
  if (!dir) return;
  await removePathWithRetry(dir, { recursive: true, force: true });
};

const buildEdgeIteratorFactory = ({
  includes,
  fileRelations,
  graphRelations,
  chunkMeta,
  memberIndex,
  memberById,
  memberByChunkUid,
  aliasById,
  membersByFile,
  intern
}) => {
  const resolveGraphEdges = ({ graph, type, fallback }) => {
    if (!graph) return fallback();
    const iterator = buildEdgesFromGraph({
      graph,
      type,
      memberById,
      memberByChunkUid,
      aliasById,
      intern
    });
    const first = iterator.next();
    if (first.done) return fallback();
    return (function* () {
      yield first.value;
      for (const edge of iterator) yield edge;
    })();
  };

  const factories = [];
  if (includes.includes('imports')) {
    factories.push(() => buildImportEdges({ fileRelations, intern }));
  }
  if (includes.includes('exports')) {
    factories.push(() => buildExportEdges({ membersByFile, intern }));
  }
  if (includes.includes('calls')) {
    factories.push(() => resolveGraphEdges({
      graph: graphRelations?.callGraph,
      type: 'call',
      fallback: () => buildEdgesFromCalls({
        chunkMeta,
        memberIndex,
        memberById,
        memberByChunkUid,
        aliasById,
        intern
      })
    }));
  }
  if (includes.includes('usages')) {
    factories.push(() => resolveGraphEdges({
      graph: graphRelations?.usageGraph,
      type: 'usage',
      fallback: () => buildEdgesFromUsage({
        chunkMeta,
        memberIndex,
        memberById,
        memberByChunkUid,
        aliasById,
        intern
      })
    }));
  }
  if (includes.includes('dataflow')) {
    factories.push(() => buildEdgesFromCallSummaries({
      chunkMeta,
      memberById,
      memberByChunkUid,
      intern
    }));
  }
  if (includes.includes('aliases')) {
    factories.push(() => buildAliasEdges({ membersByFile, intern }));
  }

  return () => (function* () {
    for (const factory of factories) {
      const edges = factory();
      for (const edge of edges) yield edge;
    }
  })();
};

export async function buildCodeMap({ repoRoot, indexDir, options = {} }) {
  const warnings = [];
  const strict = options.strict !== false;
  const includes = normalizeIncludeList(options.include);
  const limits = {
    maxFiles: Number.isFinite(Number(options.maxFiles))
      ? Math.max(1, Number(options.maxFiles))
      : DEFAULT_LIMITS.maxFiles,
    maxMembersPerFile: Number.isFinite(Number(options.maxMembersPerFile))
      ? Math.max(1, Number(options.maxMembersPerFile))
      : DEFAULT_LIMITS.maxMembersPerFile,
    maxEdges: Number.isFinite(Number(options.maxEdges))
      ? Math.max(1, Number(options.maxEdges))
      : DEFAULT_LIMITS.maxEdges
  };

  const guards = createMapSectionGuards({
    maxNodeBytes: options.maxNodeBytes ?? MAX_JSON_BYTES,
    maxEdgeBytes: options.maxEdgeBytes ?? MAX_JSON_BYTES,
    maxSymbolBytes: options.maxSymbolBytes ?? MAX_JSON_BYTES
  });

  const timer = createMapBuildTimer();
  const intern = createStringInterner();

  const {
    repoMap,
    fileRelations,
    graphRelations,
    chunkMeta,
    fileMeta,
    fileInventoryStatus
  } = await timer.track('load-artifacts', async () => {
    const repo = readJsonArrayOptional(indexDir, 'repo_map', warnings) || [];
    const relations = readJsonArrayOptional(indexDir, 'file_relations', warnings) || [];
    const graphs = readGraphRelationsOptional(indexDir, warnings, { strict }) || null;
    const inventory = await readMapFileMeta(indexDir, warnings, { strict });
    let meta = [];
    try {
      meta = await loadChunkMeta(indexDir, { strict });
    } catch (err) {
      if (strict && err.code !== 'ERR_MANIFEST_ENTRY_MISSING') throw err;
      warnings.push(`chunk_meta missing: ${err?.message || err}`);
    }
    return {
      repoMap: repo,
      fileRelations: relations,
      graphRelations: graphs,
      chunkMeta: hydrateChunkMeta(meta, inventory.rows),
      fileMeta: inventory.rows,
      fileInventoryStatus: inventory.status
    };
  });

  const {
    membersByFile, memberById, aliasById, memberByChunkUid,
    hasDataflow, hasControlFlow, identitySummary
  } = await timer.track('build-members', async () => buildMapMembers({
    repoMap, chunkMeta, fileMeta, fileRelations, intern, strict, warnings
  }));

  if (!hasDataflow) warnings.push('dataflow metadata missing; map is limited');
  if (!hasControlFlow) warnings.push('controlFlow metadata missing; map is limited');

  const includeExportedOnly = options.onlyExported === true;
  if (includeExportedOnly) {
    for (const [file, members] of membersByFile.entries()) {
      membersByFile.set(
        file,
        (members || []).filter((member) => member.exported === true)
      );
    }
  }

  const tempDir = await createTempDir();
  let nodeSorter = null;
  let edgeSorter = null;
  let scope = null;
  let focus = null;
  let collapse = 'none';
  let topKByDegree = false;
  let dropped = { files: 0, members: 0, edges: 0 };
  const omittedEndpoints = { unavailable: 0, displayFiltered: 0 };
  const inventoryFiles = new Set(membersByFile.keys());
  const unavailableEndpoint = endpoint => !endpoint
    || (!endpoint.file && endpoint.member == null)
    || (endpoint.file && !inventoryFiles.has(endpoint.file))
    || (endpoint.member != null && !memberById.has(String(endpoint.member)));
  let limitedNodes = [];
  let limitedEdges = [];
  const edgeAggregateMap = new Map();
  try {
    nodeSorter = createSpillSorter({
      label: 'nodes',
      compare: compareNodes,
      maxInMemory: options.nodeSpillThreshold || 5000,
      tempDir
    });
    await timer.track('build-nodes', async () => {
      for (const node of buildFileNodesIterable(membersByFile, { intern })) {
        await nodeSorter.push(node);
      }
    });
    const nodeFinalize = await nodeSorter.finalize();
    const nodeItems = nodeFinalize.items;

    const memberIndex = buildMemberIndex(memberById);
    const edgeIteratorFactory = buildEdgeIteratorFactory({
      includes,
      fileRelations,
      graphRelations,
      chunkMeta,
      memberIndex,
      memberById,
      memberByChunkUid,
      aliasById,
      membersByFile,
      intern
    });

    ({ scope, focus } = resolveFocus(options));
    collapse = options.collapse || 'none';
    topKByDegree = options.topKByDegree === true;
    const scopeFilters = createScopeFilters({
      scope,
      focus,
      edgeIteratorFactory,
      normalizeMemberId
    });
    const scopedNodes = await timer.track('apply-scope', async () => {
      const list = [];
      for await (const node of nodeItems) {
        const next = scopeFilters.nodeFilter(node);
        if (next) list.push(next);
      }
      return list;
    });

    let nodes = scopedNodes;
    let edgeFilter = scopeFilters.edgeFilter;
    const collapseResult = createCollapseTransform({ collapse, nodes });
    nodes = collapseResult.nodes;
    const transformEdge = collapseResult.edgeTransform;

    const degreeMap = topKByDegree
      ? await timer.track('edge-degree', async () => {
        const degree = new Map();
        for (const edge of edgeIteratorFactory()) {
          if (!edgeFilter(edge)) continue;
          if ([edge.from, edge.to].some(unavailableEndpoint)) continue;
          const next = transformEdge(edge);
          const fromFile = next.from?.file || null;
          const toFile = next.to?.file || null;
          if (fromFile) degree.set(fromFile, (degree.get(fromFile) || 0) + 1);
          if (toFile) degree.set(toFile, (degree.get(toFile) || 0) + 1);
        }
        return degree;
      })
      : null;

    const fileList = topKByDegree
      ? nodes.slice().sort((a, b) => {
        const scoreA = degreeMap?.get(a.path) || 0;
        const scoreB = degreeMap?.get(b.path) || 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return String(a.path).localeCompare(String(b.path));
      })
      : nodes.slice().sort(compareNodes);

    dropped = { files: 0, members: 0, edges: 0 };
    limitedNodes = [];
    for (const node of fileList.slice(0, limits.maxFiles)) {
      const members = Array.isArray(node.members) ? node.members : [];
      const memberList = members.slice().sort((a, b) => (
        String(a.name || '').localeCompare(String(b.name || ''))
        || (Number(a.range?.startLine || 0) - Number(b.range?.startLine || 0))
      ));
      const keptMembers = memberList.slice(0, limits.maxMembersPerFile);
      dropped.members += Math.max(0, memberList.length - keptMembers.length);
      const nextNode = { ...node, members: keptMembers };
      guards.nodes.add(resolveJsonBytes(nextNode));
      for (const member of keptMembers) {
        guards.symbols.add(resolveJsonBytes(member));
      }
      limitedNodes.push(nextNode);
    }
    dropped.files = Math.max(0, fileList.length - limitedNodes.length);

    const fileSet = new Set(limitedNodes.map((node) => node.path));
    const memberSet = new Set();
    for (const node of limitedNodes) {
      for (const member of node.members || []) {
        const id = normalizeMemberId(member.id);
        if (id) memberSet.add(id);
      }
    }

    const edgeLimitFilter = (edge) => {
      if (!edge.from || !edge.to) return false;
      const fromMember = normalizeMemberId(edge.from?.member);
      const toMember = normalizeMemberId(edge.to?.member);
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      if (fromMember && !memberSet.has(fromMember)) return false;
      if (toMember && !memberSet.has(toMember)) return false;
      if (fromFile && !fileSet.has(fromFile)) return false;
      if (toFile && !fileSet.has(toFile)) return false;
      return true;
    };

    const edgeWeights = DEFAULT_EDGE_WEIGHTS;
    edgeSorter = createSpillSorter({
      label: 'edges',
      compare: compareEdges,
      maxInMemory: options.edgeSpillThreshold || 5000,
      tempDir
    });
    let keptEdges = 0;
    await timer.track('build-edges', async () => {
      for (const edge of edgeIteratorFactory()) {
        if (!edgeFilter(edge)) continue;
        // Classify against the admitted generation before collapsing file IDs
        // to directory labels. Unknown targets must not become null endpoints
        // that bypass filters or collide with a legitimate directory node.
        if ([edge.from, edge.to].some(unavailableEndpoint)) {
          omittedEndpoints.unavailable += 1;
          continue;
        }
        const next = transformEdge(edge);
        if (!edgeLimitFilter(next)) {
          omittedEndpoints.displayFiltered += 1;
          continue;
        }
        if (keptEdges >= limits.maxEdges) {
          dropped.edges += 1;
          continue;
        }
        const fromFile = next.from?.file || null;
        const toFile = next.to?.file || null;
        if (fromFile && toFile) {
          const key = `${next.type}:${fromFile}->${toFile}`;
          let bucket = edgeAggregateMap.get(key);
          if (!bucket) {
            bucket = {
              type: next.type,
              fromFile,
              toFile,
              count: 0,
              weight: 0,
              minWeight: Infinity,
              maxWeight: -Infinity
            };
            edgeAggregateMap.set(key, bucket);
          }
          const edgeWeight = edgeWeights[next.type] || 1;
          bucket.count += 1;
          bucket.weight += edgeWeight;
          bucket.minWeight = Math.min(bucket.minWeight, edgeWeight);
          bucket.maxWeight = Math.max(bucket.maxWeight, edgeWeight);
        }
        guards.edges.add(resolveJsonBytes(next));
        await edgeSorter.push(next);
        keptEdges += 1;
      }
    });

    const edgeFinalize = await edgeSorter.finalize();
    const edgeItems = edgeFinalize.items;
    limitedEdges = Array.isArray(edgeItems)
      ? edgeItems
      : await (async () => {
        const list = [];
        for await (const edge of edgeItems) list.push(edge);
        return list;
      })();
  } finally {
    try {
      if (nodeSorter?.cleanup) await nodeSorter.cleanup();
    } catch {}
    try {
      if (edgeSorter?.cleanup) await edgeSorter.cleanup();
    } catch {}
    try {
      await cleanupTempDir(tempDir);
    } catch {}
  }

  const sortedNodes = sortBy(limitedNodes, (node) => node.path);
  const sortedEdges = sortBy(limitedEdges, (edge) => {
    const from = edge.from?.member || edge.from?.file || '';
    const to = edge.to?.member || edge.to?.file || '';
    return `${edge.type}:${from}->${to}:${edge.label || ''}`;
  });
  const edgeAggregates = sortBy(
    Array.from(edgeAggregateMap.values()).map((entry) => ({
      ...entry,
      minWeight: Number.isFinite(entry.minWeight) ? entry.minWeight : null,
      maxWeight: Number.isFinite(entry.maxWeight) ? entry.maxWeight : null
    })),
    (entry) => `${entry.type}:${entry.fromFile}->${entry.toFile}`
  );

  const nodeHasher = createSectionHasher();
  const symbolHasher = createSectionHasher();
  for (const node of sortedNodes) {
    nodeHasher.add(node);
    for (const member of node.members || []) {
      symbolHasher.add(member);
    }
  }
  const edgeHasher = createSectionHasher();
  for (const edge of sortedEdges) edgeHasher.add(edge);
  const edgeAggregateHasher = createSectionHasher();
  for (const entry of edgeAggregates) edgeAggregateHasher.add(entry);

  const sectionHashes = {
    nodes: nodeHasher.digest(),
    symbols: symbolHasher.digest(),
    edges: edgeHasher.digest(),
    edgeAggregates: edgeAggregateHasher.digest()
  };

  const summary = {
    counts: {
      files: sortedNodes.length,
      members: sortedNodes.reduce((acc, node) => acc + (node.members?.length || 0), 0),
      edges: sortedEdges.length
    },
    dropped,
    inventory: { status: fileInventoryStatus, files: inventoryFiles.size },
    identity: identitySummary,
    omittedEndpoints,
    truncated: dropped.files > 0 || dropped.members > 0 || dropped.edges > 0,
    limits,
    include: includes,
    scope,
    focus: focus || null,
    collapse: collapse || 'none',
    topKByDegree
  };

  const viewer = {
    ...VIEWER_DEFAULTS,
    ...options.viewer,
    controls: {
      ...VIEWER_DEFAULTS.controls,
      ...(options.viewer?.controls || {}),
      wasd: {
        ...VIEWER_DEFAULTS.controls.wasd,
        ...(options.viewer?.controls?.wasd || {})
      }
    }
  };

  const buildMetrics = {
    generatedAt: new Date().toISOString(),
    stages: timer.stages,
    peak: timer.peak,
    observedBoundaryMax: timer.observedBoundaryMax,
    memoryObservation: timer.memoryObservation,
    counts: summary.counts
  };

  const model = {
    version: MAP_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    root: { path: repoRoot, id: null },
    mode: options.mode || null,
    options: {
      scope,
      focus: focus || null,
      include: includes,
      onlyExported: includeExportedOnly,
      collapse,
      limits,
      topKByDegree
    },
    legend: DEFAULT_LEGEND,
    nodes: sortedNodes,
    edges: sortedEdges,
    edgeAggregates,
    sectionHashes,
    viewer,
    summary,
    buildMetrics,
    warnings: unique(warnings)
  };
  timer.complete();
  return model;
}

export async function buildCodeMapStream({ repoRoot, indexDir, options = {}, outPath }) {
  const mapModel = await buildCodeMap({ repoRoot, indexDir, options });
  if (!outPath) return mapModel;
  const mapBase = { ...mapModel };
  delete mapBase.nodes;
  delete mapBase.edges;
  await writeMapJsonStream({
    filePath: outPath,
    mapBase,
    nodes: mapModel.nodes || [],
    edges: mapModel.edges || []
  });
  return mapModel;
}

export function buildNodeList(mapModel) {
  const nodes = [];
  for (const file of mapModel.nodes || []) {
    nodes.push({
      id: file.path,
      label: `file: ${file.path}`,
      file: file.path,
      kind: 'file',
      startLine: 1,
      endLine: null
    });
    for (const member of file.members || []) {
      const line = member.range?.startLine || null;
      nodes.push({
        id: member.id,
        label: `${member.name} (${file.path}:${line || 1})`,
        file: file.path,
        kind: member.kind || member.type || 'symbol',
        startLine: line,
        endLine: member.range?.endLine || null
      });
    }
  }
  const sorted = sortBy(nodes, (entry) => entry.label);
  return {
    generatedAt: mapModel.generatedAt,
    root: mapModel.root?.path || null,
    nodes: sorted
  };
}

export function buildMapCacheKey({ buildId, indexIdentity, options }) {
  const payload = { producerVersion: 6, modelVersion: MAP_MODEL_VERSION,
    buildId: buildId || null, indexIdentity: indexIdentity || null, options: options || null };
  return buildLocalCacheKey({
    namespace: 'code-map',
    payload
  }).key;
}


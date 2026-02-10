import path from 'node:path';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { loadChunkMeta, MAX_JSON_BYTES } from '../shared/artifact-io.js';
import { buildLocalCacheKey } from '../shared/cache-key.js';
import { stableStringify } from '../shared/stable-json.js';
import {
  DEFAULT_LEGEND,
  DEFAULT_LIMITS,
  DEFAULT_EDGE_WEIGHTS,
  MAP_MODEL_VERSION,
  VIEWER_DEFAULTS
} from './constants.js';
import { normalizePath, sortBy, unique } from './utils.js';
import {
  hydrateChunkMeta,
  readGraphRelationsOptional,
  readJsonArrayOptional,
  readJsonOptional,
  createMapSectionGuards,
  createSpillSorter,
  resolveJsonBytes,
  writeMapJsonStream
} from './build-map/io.js';
import {
  createStringInterner,
  normalizeArray,
  normalizeControlFlow,
  normalizeDataflow,
  normalizeModifiers
} from './build-map/normalize.js';
import { buildSymbolId, buildMemberIndex, upsertMember } from './build-map/symbols.js';
import { resolveChunkId } from '../index/chunk-id.js';
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

const normalizeMemberId = (value) => (value === 0 || value ? String(value) : null);

const createBuildTimer = () => {
  const stages = [];
  const peak = { heapUsed: 0, rss: 0, external: 0, arrayBuffers: 0 };
  const updatePeak = (mem) => {
    peak.heapUsed = Math.max(peak.heapUsed, mem.heapUsed || 0);
    peak.rss = Math.max(peak.rss, mem.rss || 0);
    peak.external = Math.max(peak.external, mem.external || 0);
    peak.arrayBuffers = Math.max(peak.arrayBuffers, mem.arrayBuffers || 0);
  };
  const track = async (stage, fn) => {
    const startMem = process.memoryUsage();
    updatePeak(startMem);
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    const endMem = process.memoryUsage();
    updatePeak(endMem);
    stages.push({
      stage,
      elapsedMs: Math.round((end - start) * 100) / 100,
      memory: {
        heapUsed: endMem.heapUsed,
        rss: endMem.rss,
        external: endMem.external,
        arrayBuffers: endMem.arrayBuffers
      }
    });
    return result;
  };
  return { stages, peak, track };
};

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
  const base = path.join(os.tmpdir(), 'pairofcleats-map-');
  return fsPromises.mkdtemp(base);
};

const cleanupTempDir = async (dir) => {
  if (!dir) return;
  await fsPromises.rm(dir, { recursive: true, force: true });
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

  const timer = createBuildTimer();
  const intern = createStringInterner();
  const internPath = (value) => intern(normalizePath(value));

  const {
    repoMap,
    fileRelations,
    graphRelations,
    chunkMeta
  } = await timer.track('load-artifacts', async () => {
    const repo = readJsonArrayOptional(indexDir, 'repo_map', warnings) || [];
    const relations = readJsonArrayOptional(indexDir, 'file_relations', warnings) || [];
    const graphs = readGraphRelationsOptional(indexDir, warnings, { strict }) || null;
    const fileMetaRaw = readJsonOptional(path.join(indexDir, 'file_meta.json'), warnings) || null;
    let meta = [];
    try {
      meta = await loadChunkMeta(indexDir, { strict });
    } catch (err) {
      warnings.push(`chunk_meta missing: ${err?.message || err}`);
    }
    return {
      repoMap: repo,
      fileRelations: relations,
      graphRelations: graphs,
      chunkMeta: hydrateChunkMeta(meta, fileMetaRaw)
    };
  });

  const membersByFile = new Map();
  const memberById = new Map();
  const aliasById = new Map();
  const memberByChunkUid = new Map();
  let hasDataflow = false;
  let hasControlFlow = false;
  const sourceRanks = {
    repoMap: 1,
    chunkMeta: 2
  };

  await timer.track('build-members', async () => {
    for (const entry of repoMap) {
      if (!entry?.file || !entry?.name) continue;
      const file = internPath(entry.file);
      const name = intern(entry.name);
      const kind = intern(entry.kind || null);
      const signature = intern(entry.signature || null);
      const symbolId = buildSymbolId({
        file,
        name,
        kind,
        startLine: entry.startLine,
        chunkId: null
      });
      upsertMember(membersByFile, memberById, file, symbolId, {
        name,
        kind,
        signature,
        exported: entry.exported === true,
        range: {
          startLine: Number.isFinite(entry.startLine) ? entry.startLine : null,
          endLine: Number.isFinite(entry.endLine) ? entry.endLine : null
        },
        sourceRank: sourceRanks.repoMap
      });
    }

    for (const chunk of chunkMeta) {
      const meta = chunk?.metaV2 || null;
      const file = internPath(meta?.file || chunk?.file || '');
      const name = intern(meta?.name || chunk?.name || null);
      if (!file || !name) continue;
      const resolvedChunkId = resolveChunkId(chunk);
      const chunkUid = meta?.chunkUid || chunk?.chunkUid || null;
      if (!chunkUid) {
        const message = `chunkUid missing for ${file}::${name}`;
        if (strict) throw new Error(message);
        warnings.push(message);
        continue;
      }
      const symbolIdentity = meta?.symbol || null;
      const kind = intern(meta?.kind || chunk?.kind || null);
      const symbolId = buildSymbolId({
        symbolId: symbolIdentity?.symbolId || null,
        chunkUid,
        file,
        name,
        kind,
        startLine: meta?.range?.startLine || chunk?.startLine,
        chunkId: resolvedChunkId || meta?.chunkId || null
      });
      if (chunkUid) {
        memberByChunkUid.set(chunkUid, symbolId);
        if (chunkUid !== symbolId) aliasById.set(chunkUid, symbolId);
      }
      if (resolvedChunkId && resolvedChunkId !== symbolId) {
        aliasById.set(resolvedChunkId, symbolId);
      }
      const legacyKey = `${file}::${name}`;
      if (legacyKey && legacyKey !== symbolId) aliasById.set(legacyKey, symbolId);
      const dataflow = normalizeDataflow(meta?.dataflow || chunk?.docmeta?.dataflow, intern);
      const controlFlow = normalizeControlFlow(meta?.controlFlow || chunk?.docmeta?.controlFlow);
      if (dataflow) hasDataflow = true;
      if (controlFlow) hasControlFlow = true;
      const params = normalizeArray(meta?.params || chunk?.docmeta?.params, intern);
      const modifiers = normalizeModifiers(meta?.modifiers || chunk?.docmeta?.modifiers);
      const returns = meta?.returns || chunk?.docmeta?.returns || null;
      upsertMember(membersByFile, memberById, file, symbolId, {
        name,
        kind,
        signature: intern(meta?.signature || chunk?.docmeta?.signature || null),
        params,
        returns,
        modifiers,
        dataflow,
        controlFlow,
        range: {
          startLine: Number.isFinite(meta?.range?.startLine)
            ? meta.range.startLine
            : (Number.isFinite(chunk?.startLine) ? chunk.startLine : null),
          endLine: Number.isFinite(meta?.range?.endLine)
            ? meta.range.endLine
            : (Number.isFinite(chunk?.endLine) ? chunk.endLine : null)
        },
        sourceRank: sourceRanks.chunkMeta
      });
    }
  });

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
        const next = transformEdge(edge);
        if (!edgeLimitFilter(next)) continue;
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
    counts: summary.counts
  };

  return {
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

export function buildMapCacheKey({ buildId, options }) {
  const payload = { buildId: buildId || null, options: options || null };
  return buildLocalCacheKey({
    namespace: 'code-map',
    payload
  }).key;
}


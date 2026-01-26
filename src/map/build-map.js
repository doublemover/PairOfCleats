import path from 'node:path';
import { loadChunkMeta } from '../shared/artifact-io.js';
import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import {
  DEFAULT_LEGEND,
  DEFAULT_LIMITS,
  MAP_MODEL_VERSION,
  VIEWER_DEFAULTS
} from './constants.js';
import { normalizePath, sortBy, unique } from './utils.js';
import {
  hydrateChunkMeta,
  readGraphRelationsOptional,
  readJsonArrayOptional,
  readJsonOptional
} from './build-map/io.js';
import {
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
import { applyCollapse, applyLimits, applyScopeFilter, normalizeIncludeList, resolveFocus } from './build-map/filters.js';
import { buildFileNodes } from './build-map/nodes.js';
export async function buildCodeMap({ repoRoot, indexDir, options = {} }) {
  const warnings = [];
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

  const repoMap = readJsonArrayOptional(indexDir, 'repo_map', warnings) || [];
  const fileRelations = readJsonArrayOptional(indexDir, 'file_relations', warnings) || [];
  const graphRelations = readGraphRelationsOptional(indexDir, warnings) || null;
  const fileMeta = readJsonOptional(path.join(indexDir, 'file_meta.json'), warnings) || null;

  let chunkMeta = [];
  try {
    chunkMeta = await loadChunkMeta(indexDir);
  } catch (err) {
    warnings.push(`chunk_meta missing: ${err?.message || err}`);
  }
  chunkMeta = hydrateChunkMeta(chunkMeta, fileMeta);

  const membersByFile = new Map();
  const memberById = new Map();
  const aliasById = new Map();
  let hasDataflow = false;
  let hasControlFlow = false;

  for (const entry of repoMap) {
    if (!entry?.file || !entry?.name) continue;
    const file = normalizePath(entry.file);
    const symbolId = buildSymbolId({
      file,
      name: entry.name,
      kind: entry.kind,
      startLine: entry.startLine,
      chunkId: null
    });
    upsertMember(membersByFile, memberById, file, symbolId, {
      name: entry.name,
      kind: entry.kind,
      signature: entry.signature || null,
      exported: entry.exported === true,
      range: {
        startLine: Number.isFinite(entry.startLine) ? entry.startLine : null,
        endLine: Number.isFinite(entry.endLine) ? entry.endLine : null
      }
    });
  }

  for (const chunk of chunkMeta) {
    const meta = chunk?.metaV2 || null;
    const file = normalizePath(meta?.file || chunk?.file || '');
    const name = meta?.name || chunk?.name || null;
    if (!file || !name) continue;
    const resolvedChunkId = resolveChunkId(chunk);
    const symbolId = buildSymbolId({
      file,
      name,
      kind: meta?.kind || chunk?.kind || null,
      startLine: meta?.range?.startLine || chunk?.startLine,
      chunkId: resolvedChunkId || meta?.chunkId || null
    });
    if (resolvedChunkId && resolvedChunkId !== symbolId) {
      aliasById.set(resolvedChunkId, symbolId);
    }
    const dataflow = normalizeDataflow(meta?.dataflow || chunk?.docmeta?.dataflow);
    const controlFlow = normalizeControlFlow(meta?.controlFlow || chunk?.docmeta?.controlFlow);
    if (dataflow) hasDataflow = true;
    if (controlFlow) hasControlFlow = true;
    upsertMember(membersByFile, memberById, file, symbolId, {
      name,
      kind: meta?.kind || chunk?.kind || null,
      signature: meta?.signature || chunk?.docmeta?.signature || null,
      params: normalizeArray(meta?.params || chunk?.docmeta?.params),
      returns: meta?.returns || chunk?.docmeta?.returns || null,
      modifiers: normalizeModifiers(meta?.modifiers || chunk?.docmeta?.modifiers),
      dataflow,
      controlFlow,
      range: {
        startLine: Number.isFinite(meta?.range?.startLine)
          ? meta.range.startLine
          : (Number.isFinite(chunk?.startLine) ? chunk.startLine : null),
        endLine: Number.isFinite(meta?.range?.endLine)
          ? meta.range.endLine
          : (Number.isFinite(chunk?.endLine) ? chunk.endLine : null)
      }
    });
  }

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

  let nodes = buildFileNodes(membersByFile);
  let edges = [];

  const memberIndex = buildMemberIndex(memberById);

  if (includes.includes('imports')) {
    edges.push(...buildImportEdges({ fileRelations }));
  }
  if (includes.includes('exports')) {
    edges.push(...buildExportEdges({ membersByFile }));
  }

  const callEdges = graphRelations?.callGraph
    ? buildEdgesFromGraph({ graph: graphRelations.callGraph, type: 'call', memberById, aliasById })
    : [];
  if (includes.includes('calls')) {
    edges.push(...callEdges);
    if (!callEdges.length) {
      edges.push(...buildEdgesFromCalls({ chunkMeta, memberIndex, memberById }));
    }
  }

  const usageEdges = graphRelations?.usageGraph
    ? buildEdgesFromGraph({ graph: graphRelations.usageGraph, type: 'usage', memberById, aliasById })
    : [];
  if (includes.includes('usages')) {
    edges.push(...usageEdges);
    if (!usageEdges.length) {
      edges.push(...buildEdgesFromUsage({ chunkMeta, memberIndex, memberById }));
    }
  }

  if (includes.includes('dataflow')) {
    edges.push(...buildEdgesFromCallSummaries({ chunkMeta, memberById }));
  }

  if (includes.includes('aliases')) {
    edges.push(...buildAliasEdges({ membersByFile }));
  }

  const { scope, focus } = resolveFocus(options);
  ({ nodes, edges } = applyScopeFilter({ nodes, edges, scope, focus }));
  ({ nodes, edges } = applyCollapse({ nodes, edges, collapse: options.collapse }));

  const { nodes: limitedNodes, edges: limitedEdges, dropped } = applyLimits({
    nodes,
    edges,
    limits,
    topKByDegree: options.topKByDegree === true
  });

  const summary = {
    counts: {
      files: limitedNodes.length,
      members: limitedNodes.reduce((acc, node) => acc + (node.members?.length || 0), 0),
      edges: limitedEdges.length
    },
    dropped,
    truncated: dropped.files > 0 || dropped.members > 0 || dropped.edges > 0,
    limits,
    include: includes,
    scope,
    focus: focus || null,
    collapse: options.collapse || 'none',
    topKByDegree: options.topKByDegree === true
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
      collapse: options.collapse || 'none',
      limits,
      topKByDegree: options.topKByDegree === true
    },
    legend: DEFAULT_LEGEND,
    nodes: sortBy(limitedNodes, (node) => node.path),
    edges: sortBy(limitedEdges, (edge) => {
      const from = edge.from?.member || edge.from?.file || '';
      const to = edge.to?.member || edge.to?.file || '';
      return `${edge.type}:${from}->${to}:${edge.label || ''}`;
    }),
    viewer,
    summary,
    warnings: unique(warnings)
  };
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
  return sha1(stableStringify(payload));
}

